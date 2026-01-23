// services/ScenarioService.js
// Service de gestion des scénarios de garde

const { GuardScenario, Guard, Location, AuditLog } = require('../models');
const { Op } = require('sequelize');

class ScenarioService {
  async listScenarios({ geo_id, active_only, page, limit, user }) {
    try {
      const where = {};
      if (geo_id) where.geo_id = geo_id;
      if (active_only) where.is_active = true;

      const offset = (page - 1) * limit;

      const { count, rows } = await GuardScenario.findAndCountAll({
        where,
        limit,
        offset,
        order: [['created_at', 'DESC']],
        include: [{
          model: Location,
          as: 'location',
          attributes: ['name', 'type']
        }]
      });

      return {
        data: rows,
        total: count,
        page,
        pages: Math.ceil(count / limit),
        limit
      };
    } catch (error) {
      console.error('List scenarios error:', error);
      throw error;
    }
  }

  async getScenario({ scenario_id, user, include_stats }) {
    try {
      const scenario = await GuardScenario.findByPk(scenario_id, {
        include: [{
          model: Location,
          as: 'location'
        }]
      });

      if (!scenario) return null;

      if (include_stats) {
        scenario.dataValues.stats = await this.getScenarioStats(scenario_id);
      }

      return scenario;
    } catch (error) {
      console.error('Get scenario error:', error);
      throw error;
    }
  }

  async createScenario({ name, description, geo_id, template_data, is_active, created_by }) {
    const transaction = await GuardScenario.sequelize.transaction();

    try {
      const scenario = await GuardScenario.create({
        name,
        description,
        geo_id,
        template_data,
        is_active,
        created_by,
        created_at: new Date()
      }, { transaction });

      await AuditLog.create({
        action_type: 'scenario.create',
        member_id: created_by,
        entity_type: 'scenario',
        entity_id: scenario.scenario_id,
        details: { name, geo_id }
      }, { transaction });

      await transaction.commit();
      return scenario;

    } catch (error) {
      await transaction.rollback();
      console.error('Create scenario error:', error);
      throw error;
    }
  }

  async updateScenario({ scenario_id, updates, user }) {
    const transaction = await GuardScenario.sequelize.transaction();

    try {
      const scenario = await GuardScenario.findByPk(scenario_id);
      if (!scenario) throw new Error('Scénario non trouvé');

      await scenario.update(updates, { transaction });

      await AuditLog.create({
        action_type: 'scenario.update',
        member_id: user.member_id,
        entity_type: 'scenario',
        entity_id: scenario_id,
        details: { updates }
      }, { transaction });

      await transaction.commit();
      return scenario;

    } catch (error) {
      await transaction.rollback();
      console.error('Update scenario error:', error);
      throw error;
    }
  }

  async deleteScenario({ scenario_id, user, force }) {
    const transaction = await GuardScenario.sequelize.transaction();

    try {
      const scenario = await GuardScenario.findByPk(scenario_id);
      if (!scenario) throw new Error('Scénario non trouvé');

      // Vérifier s'il y a des gardes liées
      const guardCount = await Guard.count({
        where: { scenario_id }
      });

      if (guardCount > 0 && !force) {
        throw new Error(`Ce scénario est lié à ${guardCount} garde(s)`);
      }

      if (force) {
        // Dissocier les gardes
        await Guard.update(
          { scenario_id: null },
          { where: { scenario_id }, transaction }
        );
      }

      await scenario.destroy({ transaction });

      await AuditLog.create({
        action_type: 'scenario.delete',
        member_id: user.member_id,
        entity_type: 'scenario',
        entity_id: scenario_id,
        severity: 'warning',
        details: { force, guards_affected: guardCount }
      }, { transaction });

      await transaction.commit();

    } catch (error) {
      await transaction.rollback();
      console.error('Delete scenario error:', error);
      throw error;
    }
  }

  async applyScenario({ scenario_id, geo_id, start_date, end_date, override_existing, auto_assign_priorities, applied_by }) {
    const transaction = await GuardScenario.sequelize.transaction();

    try {
      const scenario = await GuardScenario.findByPk(scenario_id);
      if (!scenario) throw new Error('Scénario non trouvé');

      const guards_created = await this.createGuardsFromScenario({
        scenario,
        geo_id,
        start_date,
        end_date,
        override_existing,
        transaction
      });

      await AuditLog.create({
        action_type: 'scenario.apply',
        member_id: applied_by,
        entity_type: 'scenario',
        entity_id: scenario_id,
        details: {
          geo_id,
          start_date,
          end_date,
          guards_created
        }
      }, { transaction });

      await transaction.commit();

      return { guards_created, scenario_id };

    } catch (error) {
      await transaction.rollback();
      console.error('Apply scenario error:', error);
      throw error;
    }
  }

  async cloneScenario({ scenario_id, new_name, target_geo_id, include_inactive_slots, cloned_by }) {
    const transaction = await GuardScenario.sequelize.transaction();

    try {
      const original = await GuardScenario.findByPk(scenario_id);
      if (!original) throw new Error('Scénario original non trouvé');

      const templateData = { ...original.template_data };
      
      if (!include_inactive_slots && templateData.slots) {
        templateData.slots = templateData.slots.filter(s => s.is_active !== false);
      }

      const newScenario = await GuardScenario.create({
        name: new_name,
        description: `Clone de: ${original.description || original.name}`,
        geo_id: target_geo_id || original.geo_id,
        template_data: templateData,
        is_active: true,
        created_by: cloned_by,
        created_at: new Date()
      }, { transaction });

      await AuditLog.create({
        action_type: 'scenario.clone',
        member_id: cloned_by,
        entity_type: 'scenario',
        entity_id: newScenario.scenario_id,
        details: {
          original_id: scenario_id,
          target_geo_id
        }
      }, { transaction });

      await transaction.commit();
      return newScenario;

    } catch (error) {
      await transaction.rollback();
      console.error('Clone scenario error:', error);
      throw error;
    }
  }

  async previewScenario({ scenario_id, start_date, end_date, user }) {
    try {
      const scenario = await GuardScenario.findByPk(scenario_id);
      if (!scenario) throw new Error('Scénario non trouvé');

      const slots = this.generateSlotsFromTemplate({
        template: scenario.template_data,
        start_date: new Date(start_date),
        end_date: new Date(end_date)
      });

      return {
        scenario_name: scenario.name,
        period: { start_date, end_date },
        total_slots: slots.length,
        slots: slots.slice(0, 20), // Limiter la preview
        by_day: this.groupSlotsByDay(slots)
      };

    } catch (error) {
      console.error('Preview scenario error:', error);
      throw error;
    }
  }

  async getTemplates({ category, geo_scope }) {
    try {
      // Templates prédéfinis
      const templates = [
        {
          id: 'standard_week',
          name: 'Semaine standard',
          category: 'basic',
          geo_scope: 'all',
          template_data: {
            slots: this.generateStandardWeekTemplate()
          }
        },
        {
          id: 'weekend_only',
          name: 'Weekends uniquement',
          category: 'basic',
          geo_scope: 'all',
          template_data: {
            slots: this.generateWeekendTemplate()
          }
        }
      ];

      return templates.filter(t => {
        if (category && t.category !== category) return false;
        if (geo_scope && t.geo_scope !== 'all' && t.geo_scope !== geo_scope) return false;
        return true;
      });

    } catch (error) {
      console.error('Get templates error:', error);
      throw error;
    }
  }

  async validateScenario({ scenario_id, strict_mode }) {
    try {
      const scenario = await GuardScenario.findByPk(scenario_id);
      if (!scenario) throw new Error('Scénario non trouvé');

      const issues = [];
      const warnings = [];

      // Validations
      if (!scenario.template_data?.slots || scenario.template_data.slots.length === 0) {
        issues.push('Aucun créneau défini');
      }

      scenario.template_data?.slots?.forEach((slot, index) => {
        if (!slot.day || !slot.shift) {
          issues.push(`Créneau ${index + 1}: jour ou shift manquant`);
        }
        if (!slot.time_start || !slot.time_end) {
          issues.push(`Créneau ${index + 1}: horaires manquants`);
        }
        if (slot.min_guards > slot.max_guards) {
          issues.push(`Créneau ${index + 1}: min > max`);
        }
        if (strict_mode && slot.min_guards < 1) {
          warnings.push(`Créneau ${index + 1}: aucun garde minimum requis`);
        }
      });

      return {
        valid: issues.length === 0,
        issues,
        warnings
      };

    } catch (error) {
      console.error('Validate scenario error:', error);
      throw error;
    }
  }

  // Méthodes privées

  async getScenarioStats(scenario_id) {
    const guardCount = await Guard.count({
      where: { scenario_id }
    });

    const lastApplied = await AuditLog.findOne({
      where: {
        action_type: 'scenario.apply',
        entity_id: scenario_id
      },
      order: [['timestamp', 'DESC']]
    });

    return {
      total_guards_created: guardCount,
      last_applied: lastApplied?.timestamp,
      times_applied: await AuditLog.count({
        where: {
          action_type: 'scenario.apply',
          entity_id: scenario_id
        }
      })
    };
  }

  async createGuardsFromScenario({ scenario, geo_id, start_date, end_date, override_existing, transaction }) {
    const slots = this.generateSlotsFromTemplate({
      template: scenario.template_data,
      start_date: new Date(start_date),
      end_date: new Date(end_date)
    });

    let created = 0;
    
    for (const slot of slots) {
      // Vérifier l'existence
      if (!override_existing) {
        const existing = await Guard.findOne({
          where: {
            geo_id,
            date: slot.date,
            shift: slot.shift
          }
        });
        
        if (existing) continue;
      }

      await Guard.create({
        geo_id,
        scenario_id: scenario.scenario_id,
        date: slot.date,
        shift: slot.shift,
        time_start: slot.time_start,
        time_end: slot.time_end,
        min_guards: slot.min_guards,
        max_guards: slot.max_guards,
        points: slot.points || 1,
        status: 'open',
        created_at: new Date()
      }, { transaction });

      created++;
    }

    return created;
  }

  generateSlotsFromTemplate({ template, start_date, end_date }) {
    const slots = [];
    const current = new Date(start_date);
    const dayMap = {
      'lundi': 1, 'mardi': 2, 'mercredi': 3,
      'jeudi': 4, 'vendredi': 5, 'samedi': 6, 'dimanche': 0
    };

    while (current <= end_date) {
      const dayOfWeek = current.getDay();
      
      template.slots?.forEach(slotTemplate => {
        if (dayMap[slotTemplate.day] === dayOfWeek) {
          slots.push({
            date: new Date(current),
            day: slotTemplate.day,
            shift: slotTemplate.shift,
            time_start: slotTemplate.time_start,
            time_end: slotTemplate.time_end,
            min_guards: slotTemplate.min_guards,
            max_guards: slotTemplate.max_guards,
            points: slotTemplate.points
          });
        }
      });

      current.setDate(current.getDate() + 1);
    }

    return slots;
  }

  generateStandardWeekTemplate() {
    const shifts = ['matin', 'après-midi', 'soir'];
    const days = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'];
    const slots = [];

    days.forEach(day => {
      shifts.forEach(shift => {
        slots.push({
          day,
          shift,
          time_start: shift === 'matin' ? '08:00' : shift === 'après-midi' ? '14:00' : '20:00',
          time_end: shift === 'matin' ? '14:00' : shift === 'après-midi' ? '20:00' : '02:00',
          min_guards: 1,
          max_guards: 3,
          points: shift === 'soir' ? 2 : 1
        });
      });
    });

    return slots;
  }

  generateWeekendTemplate() {
    return [
      {
        day: 'samedi',
        shift: 'matin',
        time_start: '08:00',
        time_end: '14:00',
        min_guards: 2,
        max_guards: 4,
        points: 2
      },
      {
        day: 'samedi',
        shift: 'après-midi',
        time_start: '14:00',
        time_end: '20:00',
        min_guards: 2,
        max_guards: 4,
        points: 2
      },
      {
        day: 'dimanche',
        shift: 'matin',
        time_start: '08:00',
        time_end: '14:00',
        min_guards: 2,
        max_guards: 4,
        points: 2
      },
      {
        day: 'dimanche',
        shift: 'après-midi',
        time_start: '14:00',
        time_end: '20:00',
        min_guards: 2,
        max_guards: 4,
        points: 2
      }
    ];
  }

  groupSlotsByDay(slots) {
    const grouped = {};
    
    slots.forEach(slot => {
      const dateKey = slot.date.toISOString().split('T')[0];
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    });

    return grouped;
  }
}

module.exports = new ScenarioService();
