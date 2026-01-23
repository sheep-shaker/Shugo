'use strict';

/**
 * Seeder 002 - Scénarios de garde par défaut
 * 
 * Crée les 3 scénarios standard: NORMAL, EARLY, LATE
 * 
 * @see Document Technique V7.0 - Section 4.1.2
 */

const { v4: uuidv4 } = require('uuid');

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const scenarios = [
      {
        scenario_id: uuidv4(),
        name: 'Journée Standard',
        description: 'Scénario pour une journée normale d\'activité avec ouverture 10h-17h.',
        geo_id: null, // Applicable à tous les locaux par défaut
        scenario_type: 'daily',
        code: 'NORMAL',
        cancellation_window_hours: 72,
        template_data: JSON.stringify({
          slots: [
            { start: '08:00', end: '10:00', type: 'preparation', label: 'Préparation' },
            { start: '10:00', end: '12:00', type: 'standard', label: 'Accueil matin' },
            { start: '12:00', end: '14:00', type: 'standard', label: 'Pause déjeuner' },
            { start: '14:00', end: '17:00', type: 'standard', label: 'Accueil après-midi' },
            { start: '17:00', end: '19:00', type: 'closure', label: 'Fermeture' }
          ],
          minParticipants: 1,
          maxParticipants: 2,
          dayOfWeek: [1, 2, 3, 4, 5] // Lundi à vendredi
        }),
        is_default: true,
        is_active: true,
        created_by_member_id: 1, // Admin système
        created_at: now,
        updated_at: now
      },
      {
        scenario_id: uuidv4(),
        name: 'Journée Anticipée',
        description: 'Scénario pour ouverture matinale avec fermeture standard.',
        geo_id: null,
        scenario_type: 'daily',
        code: 'EARLY',
        cancellation_window_hours: 72,
        template_data: JSON.stringify({
          slots: [
            { start: '06:00', end: '08:00', type: 'preparation', label: 'Préparation matinale' },
            { start: '08:00', end: '12:00', type: 'standard', label: 'Accueil matin anticipé' },
            { start: '12:00', end: '14:00', type: 'standard', label: 'Pause déjeuner' },
            { start: '14:00', end: '17:00', type: 'standard', label: 'Accueil après-midi' },
            { start: '17:00', end: '18:00', type: 'closure', label: 'Fermeture' }
          ],
          minParticipants: 1,
          maxParticipants: 2,
          dayOfWeek: [1, 2, 3, 4, 5]
        }),
        is_default: false,
        is_active: true,
        created_by_member_id: 1,
        created_at: now,
        updated_at: now
      },
      {
        scenario_id: uuidv4(),
        name: 'Journée Prolongée',
        description: 'Scénario pour journée avec fermeture tardive ou soirée.',
        geo_id: null,
        scenario_type: 'daily',
        code: 'LATE',
        cancellation_window_hours: 72,
        template_data: JSON.stringify({
          slots: [
            { start: '10:00', end: '12:00', type: 'preparation', label: 'Préparation' },
            { start: '12:00', end: '14:00', type: 'standard', label: 'Accueil midi' },
            { start: '14:00', end: '18:00', type: 'standard', label: 'Accueil après-midi' },
            { start: '18:00', end: '21:00', type: 'standard', label: 'Accueil soirée' },
            { start: '21:00', end: '23:00', type: 'closure', label: 'Fermeture tardive' }
          ],
          minParticipants: 2,
          maxParticipants: 3,
          dayOfWeek: [5, 6] // Vendredi, samedi
        }),
        is_default: false,
        is_active: true,
        created_by_member_id: 1,
        created_at: now,
        updated_at: now
      },
      {
        scenario_id: uuidv4(),
        name: 'Weekend',
        description: 'Scénario pour les week-ends avec horaires réduits.',
        geo_id: null,
        scenario_type: 'daily',
        code: 'CUSTOM',
        cancellation_window_hours: 48,
        template_data: JSON.stringify({
          slots: [
            { start: '10:00', end: '12:00', type: 'standard', label: 'Matin weekend' },
            { start: '14:00', end: '18:00', type: 'standard', label: 'Après-midi weekend' }
          ],
          minParticipants: 1,
          maxParticipants: 2,
          dayOfWeek: [0, 6] // Dimanche, samedi
        }),
        is_default: false,
        is_active: true,
        created_by_member_id: 1,
        created_at: now,
        updated_at: now
      },
      {
        scenario_id: uuidv4(),
        name: 'Garde de Nuit',
        description: 'Scénario pour les gardes nocturnes de 20h à 7h.',
        geo_id: null,
        scenario_type: 'special',
        code: 'CUSTOM',
        cancellation_window_hours: 168, // 7 jours
        template_data: JSON.stringify({
          slots: [
            { start: '20:00', end: '00:00', type: 'special', label: 'Garde soirée' },
            { start: '00:00', end: '07:00', type: 'special', label: 'Garde nuit' }
          ],
          minParticipants: 2,
          maxParticipants: 3,
          dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
          requiresSpecialPermission: true
        }),
        is_default: false,
        is_active: true,
        created_by_member_id: 1,
        created_at: now,
        updated_at: now
      }
    ];

    await queryInterface.bulkInsert('guard_scenarios', scenarios);
    console.log(`✅ Seeder 002: ${scenarios.length} scénarios de garde insérés`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('guard_scenarios', null, {});
    console.log('⬇️ Seeder 002: Scénarios supprimés');
  }
};
