'use strict';

/**
 * Service Utilisateur SHUGO
 * 
 * Gère le CRUD utilisateurs, la recherche phonétique, le chiffrement.
 * 
 * @see Document Technique V7.0 - Section 2.5, 5.5
 */

const { Op } = require('sequelize');
const config = require('../config');
const crypto = require('../utils/crypto');

/**
 * Service de gestion des utilisateurs
 */
class UserService {
  constructor(models) {
    this.models = models;
    this.User = models.User;
    this.Group = models.Group;
    this.GroupMembership = models.GroupMembership;
    this.UserMission = models.UserMission;
    this.AuditLog = models.AuditLog;
  }

  // =========================================
  // LECTURE
  // =========================================

  /**
   * Récupère un utilisateur par son member_id
   * @param {number} memberId
   * @param {Object} options - Options de requête
   * @returns {Promise<Object|null>}
   */
  async getById(memberId, options = {}) {
    const user = await this.User.findByPk(memberId, {
      attributes: { exclude: options.excludeFields || ['password_hash', 'totp_secret_encrypted', 'totp_backup_codes'] }
    });

    if (!user) return null;

    return this._decryptUserFields(user, options);
  }

  /**
   * Récupère un utilisateur par email
   * @param {string} email
   * @param {Object} options
   * @returns {Promise<Object|null>}
   */
  async getByEmail(email, options = {}) {
    const emailHash = crypto.hashForSearch(email);
    
    const user = await this.User.findOne({
      where: { email_hash: emailHash },
      attributes: { exclude: options.excludeFields || ['password_hash', 'totp_secret_encrypted', 'totp_backup_codes'] }
    });

    if (!user) return null;

    return this._decryptUserFields(user, options);
  }

  /**
   * Liste les utilisateurs avec pagination et filtres
   * @param {Object} filters - Filtres de recherche
   * @param {Object} pagination - Options de pagination
   * @returns {Promise<Object>}
   */
  async list(filters = {}, pagination = {}) {
    const {
      geoId,
      role,
      status,
      groupId,
      search,
      scope
    } = filters;

    const {
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = pagination;

    // Construction des conditions
    const where = {};

    if (geoId) {
      where.geo_id = geoId;
    }

    if (role) {
      where.role = Array.isArray(role) ? { [Op.in]: role } : role;
    }

    if (status) {
      where.status = status;
    } else {
      // Par défaut, exclure les supprimés
      where.status = { [Op.ne]: 'deleted' };
    }

    if (groupId) {
      where.group_id = groupId;
    }

    if (scope) {
      where.scope = { [Op.like]: `${scope}%` };
    }

    // Recherche par nom (phonétique ou hash exact)
    if (search) {
      const searchHash = crypto.hashForSearch(search);
      const searchPhonetic = this._generatePhonetic(search);

      where[Op.or] = [
        { first_name_hash: searchHash },
        { last_name_hash: searchHash },
        { first_name_phonetic: searchPhonetic },
        { last_name_phonetic: searchPhonetic }
      ];
    }

    // Requête
    const { count, rows } = await this.User.findAndCountAll({
      where,
      attributes: { exclude: ['password_hash', 'totp_secret_encrypted', 'totp_backup_codes'] },
      order: [[sortBy, sortOrder]],
      limit: Math.min(limit, 100),
      offset: (page - 1) * limit
    });

    // Déchiffrer les données
    const users = await Promise.all(
      rows.map(user => this._decryptUserFields(user, { minimal: true }))
    );

    return {
      users,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  /**
   * Recherche phonétique d'utilisateurs
   * @param {string} query - Terme de recherche
   * @param {Object} options
   * @returns {Promise<Object[]>}
   */
  async searchPhonetic(query, options = {}) {
    const { geoId, limit = 20 } = options;

    if (!query || query.length < 2) {
      return [];
    }

    const phonetic = this._generatePhonetic(query);
    const hash = crypto.hashForSearch(query);

    const where = {
      status: { [Op.ne]: 'deleted' },
      [Op.or]: [
        { first_name_hash: hash },
        { last_name_hash: hash },
        { first_name_phonetic: { [Op.like]: `${phonetic}%` } },
        { last_name_phonetic: { [Op.like]: `${phonetic}%` } }
      ]
    };

    if (geoId) {
      where.geo_id = geoId;
    }

    const users = await this.User.findAll({
      where,
      attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted', 'role', 'geo_id', 'status'],
      limit: Math.min(limit, 50)
    });

    return Promise.all(
      users.map(user => this._decryptUserFields(user, { minimal: true }))
    );
  }

  // =========================================
  // CRÉATION
  // =========================================

  /**
   * Crée un utilisateur (utilisé en interne, l'inscription passe par AuthService)
   * @param {Object} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const {
      memberId,
      email,
      firstName,
      lastName,
      phone,
      role,
      geoId,
      groupId,
      scope,
      preferredLanguage,
      notificationChannel,
      createdBy
    } = data;

    // Vérifier l'unicité de l'email
    const emailHash = crypto.hashForSearch(email);
    const existing = await this.User.findOne({ where: { email_hash: emailHash } });
    if (existing) {
      throw new UserError('EMAIL_EXISTS', 'Cette adresse email est déjà utilisée');
    }

    // Chiffrer les données
    const user = await this.User.create({
      member_id: memberId,
      email_encrypted: crypto.encryptToBuffer(email.toLowerCase().trim()),
      email_hash: emailHash,
      first_name_encrypted: crypto.encryptToBuffer(firstName),
      last_name_encrypted: crypto.encryptToBuffer(lastName),
      first_name_hash: crypto.hashForSearch(firstName),
      last_name_hash: crypto.hashForSearch(lastName),
      first_name_phonetic: this._generatePhonetic(firstName),
      last_name_phonetic: this._generatePhonetic(lastName),
      phonetic_algo: 'dm_fr',
      phone_encrypted: phone ? crypto.encryptToBuffer(phone) : null,
      role: role || 'Silver',
      geo_id: geoId,
      group_id: groupId,
      scope: scope || `local:${geoId}`,
      preferred_language: preferredLanguage || config.geo.defaultLanguage,
      notification_channel: notificationChannel || 'email',
      status: 'active',
      enc_key_id: 1
    });

    await this._logAudit(createdBy, 'user.create', 'success', {
      targetMemberId: user.member_id,
      role,
      geoId
    });

    return this._decryptUserFields(user);
  }

  // =========================================
  // MISE À JOUR
  // =========================================

  /**
   * Met à jour un utilisateur
   * @param {number} memberId
   * @param {Object} updates
   * @param {number} updatedBy - member_id de l'admin
   * @returns {Promise<Object>}
   */
  async update(memberId, updates, updatedBy) {
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new UserError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    const allowedFields = [
      'firstName', 'lastName', 'phone', 'preferredLanguage',
      'notificationChannel', 'matrixId', 'role', 'geoId', 'groupId', 'scope', 'status'
    ];

    const updateData = {};
    const oldValues = {};

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        switch (field) {
          case 'firstName':
            oldValues.first_name = await this._decryptField(user.first_name_encrypted);
            updateData.first_name_encrypted = crypto.encryptToBuffer(updates.firstName);
            updateData.first_name_hash = crypto.hashForSearch(updates.firstName);
            updateData.first_name_phonetic = this._generatePhonetic(updates.firstName);
            break;

          case 'lastName':
            oldValues.last_name = await this._decryptField(user.last_name_encrypted);
            updateData.last_name_encrypted = crypto.encryptToBuffer(updates.lastName);
            updateData.last_name_hash = crypto.hashForSearch(updates.lastName);
            updateData.last_name_phonetic = this._generatePhonetic(updates.lastName);
            break;

          case 'phone':
            updateData.phone_encrypted = updates.phone ? crypto.encryptToBuffer(updates.phone) : null;
            break;

          case 'preferredLanguage':
            oldValues.preferred_language = user.preferred_language;
            updateData.preferred_language = updates.preferredLanguage;
            break;

          case 'notificationChannel':
            oldValues.notification_channel = user.notification_channel;
            updateData.notification_channel = updates.notificationChannel;
            break;

          case 'matrixId':
            updateData.matrix_id = updates.matrixId;
            break;

          case 'role':
            oldValues.role = user.role;
            updateData.role = updates.role;
            break;

          case 'geoId':
            oldValues.geo_id = user.geo_id;
            updateData.geo_id = updates.geoId;
            break;

          case 'groupId':
            oldValues.group_id = user.group_id;
            updateData.group_id = updates.groupId;
            break;

          case 'scope':
            oldValues.scope = user.scope;
            updateData.scope = updates.scope;
            break;

          case 'status':
            oldValues.status = user.status;
            updateData.status = updates.status;
            break;
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      return this._decryptUserFields(user);
    }

    await user.update(updateData);

    await this._logAudit(updatedBy, 'user.update', 'success', {
      targetMemberId: memberId,
      changes: Object.keys(updateData),
      oldValues
    });

    return this._decryptUserFields(user);
  }

  /**
   * Met à jour l'email d'un utilisateur (avec vérification)
   * @param {number} memberId
   * @param {string} newEmail
   * @param {number} updatedBy
   * @returns {Promise<Object>}
   */
  async updateEmail(memberId, newEmail, updatedBy) {
    // Vérifier l'unicité
    const emailHash = crypto.hashForSearch(newEmail);
    const existing = await this.User.findOne({
      where: { email_hash: emailHash, member_id: { [Op.ne]: memberId } }
    });

    if (existing) {
      throw new UserError('EMAIL_EXISTS', 'Cette adresse email est déjà utilisée');
    }

    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new UserError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    await user.update({
      email_encrypted: crypto.encryptToBuffer(newEmail.toLowerCase().trim()),
      email_hash: emailHash
    });

    await this._logAudit(updatedBy, 'user.update_email', 'success', {
      targetMemberId: memberId
    });

    return this._decryptUserFields(user);
  }

  // =========================================
  // GESTION DU STATUT
  // =========================================

  /**
   * Suspend un utilisateur
   * @param {number} memberId
   * @param {string} reason
   * @param {number} suspendedBy
   * @returns {Promise<void>}
   */
  async suspend(memberId, reason, suspendedBy) {
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new UserError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    await user.update({ status: 'suspended' });

    await this._logAudit(suspendedBy, 'user.suspend', 'success', {
      targetMemberId: memberId,
      reason
    });
  }

  /**
   * Réactive un utilisateur suspendu
   * @param {number} memberId
   * @param {number} reactivatedBy
   * @returns {Promise<void>}
   */
  async reactivate(memberId, reactivatedBy) {
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new UserError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    if (user.status !== 'suspended' && user.status !== 'inactive') {
      throw new UserError('INVALID_STATUS', 'L\'utilisateur n\'est pas suspendu');
    }

    await user.update({ status: 'active' });

    await this._logAudit(reactivatedBy, 'user.reactivate', 'success', {
      targetMemberId: memberId
    });
  }

  /**
   * Désactive un utilisateur (soft delete)
   * @param {number} memberId
   * @param {number} deactivatedBy
   * @returns {Promise<void>}
   */
  async deactivate(memberId, deactivatedBy) {
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new UserError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    await user.update({
      status: 'inactive',
      deleted_at: new Date()
    });

    await this._logAudit(deactivatedBy, 'user.deactivate', 'success', {
      targetMemberId: memberId
    });
  }

  // =========================================
  // GESTION DES GROUPES
  // =========================================

  /**
   * Assigne un utilisateur à un groupe
   * @param {number} memberId
   * @param {string} groupId
   * @param {string} roleInGroup
   * @param {number} assignedBy
   * @returns {Promise<void>}
   */
  async assignToGroup(memberId, groupId, roleInGroup = 'member', assignedBy) {
    const user = await this.User.findByPk(memberId);
    if (!user) {
      throw new UserError('USER_NOT_FOUND', 'Utilisateur non trouvé');
    }

    const group = await this.Group.findByPk(groupId);
    if (!group) {
      throw new UserError('GROUP_NOT_FOUND', 'Groupe non trouvé');
    }

    // Vérifier si déjà membre
    const existingMembership = await this.GroupMembership.findOne({
      where: { member_id: memberId, group_id: groupId, is_active: true }
    });

    if (existingMembership) {
      // Mettre à jour le rôle
      await existingMembership.update({ role_in_group: roleInGroup });
    } else {
      await this.GroupMembership.create({
        member_id: memberId,
        group_id: groupId,
        role_in_group: roleInGroup,
        is_active: true
      });
    }

    // Mettre à jour le groupe principal si pas défini
    if (!user.group_id) {
      await user.update({ group_id: groupId });
    }

    await this._logAudit(assignedBy, 'user.assign_group', 'success', {
      targetMemberId: memberId,
      groupId,
      roleInGroup
    });
  }

  /**
   * Retire un utilisateur d'un groupe
   * @param {number} memberId
   * @param {string} groupId
   * @param {number} removedBy
   * @returns {Promise<void>}
   */
  async removeFromGroup(memberId, groupId, removedBy) {
    const membership = await this.GroupMembership.findOne({
      where: { member_id: memberId, group_id: groupId, is_active: true }
    });

    if (!membership) {
      throw new UserError('NOT_IN_GROUP', 'L\'utilisateur n\'est pas membre de ce groupe');
    }

    await membership.update({
      is_active: false,
      left_at: new Date()
    });

    // Si c'était le groupe principal, le retirer
    const user = await this.User.findByPk(memberId);
    if (user && user.group_id === groupId) {
      await user.update({ group_id: null });
    }

    await this._logAudit(removedBy, 'user.remove_group', 'success', {
      targetMemberId: memberId,
      groupId
    });
  }

  /**
   * Liste les groupes d'un utilisateur
   * @param {number} memberId
   * @returns {Promise<Object[]>}
   */
  async getUserGroups(memberId) {
    const memberships = await this.GroupMembership.findAll({
      where: { member_id: memberId, is_active: true },
      include: [{
        model: this.Group,
        attributes: ['group_id', 'name', 'geo_id', 'status']
      }]
    });

    return memberships.map(m => ({
      groupId: m.group_id,
      groupName: m.Group?.name,
      geoId: m.Group?.geo_id,
      roleInGroup: m.role_in_group,
      joinedAt: m.joined_at
    }));
  }

  // =========================================
  // MISSIONS
  // =========================================

  /**
   * Liste les missions actives d'un utilisateur
   * @param {number} memberId
   * @returns {Promise<Object[]>}
   */
  async getUserMissions(memberId) {
    const missions = await this.UserMission.findAll({
      where: {
        member_id: memberId,
        is_active: true,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      }
    });

    return missions.map(m => ({
      missionId: m.mission_id,
      missionType: m.mission_type,
      missionName: m.mission_name,
      privileges: m.privileges_granted,
      scopeGeoId: m.scope_geo_id,
      scopeGroupId: m.scope_group_id,
      expiresAt: m.expires_at
    }));
  }

  /**
   * Vérifie si un utilisateur a une mission spécifique
   * @param {number} memberId
   * @param {string} missionType
   * @returns {Promise<boolean>}
   */
  async hasMission(memberId, missionType) {
    const mission = await this.UserMission.findOne({
      where: {
        member_id: memberId,
        mission_type: missionType,
        is_active: true,
        [Op.or]: [
          { expires_at: null },
          { expires_at: { [Op.gt]: new Date() } }
        ]
      }
    });

    return !!mission;
  }

  // =========================================
  // STATISTIQUES
  // =========================================

  /**
   * Compte les utilisateurs par critères
   * @param {Object} filters
   * @returns {Promise<number>}
   */
  async count(filters = {}) {
    const where = { status: { [Op.ne]: 'deleted' } };

    if (filters.geoId) where.geo_id = filters.geoId;
    if (filters.role) where.role = filters.role;
    if (filters.status) where.status = filters.status;

    return this.User.count({ where });
  }

  /**
   * Statistiques par rôle pour un geo_id
   * @param {string} geoId
   * @returns {Promise<Object>}
   */
  async getStatsByRole(geoId) {
    const users = await this.User.findAll({
      where: { geo_id: geoId, status: { [Op.ne]: 'deleted' } },
      attributes: ['role']
    });

    const stats = { Silver: 0, Gold: 0, Platinum: 0, Admin: 0, Admin_N1: 0, total: 0 };
    users.forEach(u => {
      stats[u.role] = (stats[u.role] || 0) + 1;
      stats.total++;
    });

    return stats;
  }

  // =========================================
  // UTILITAIRES PRIVÉS
  // =========================================

  /**
   * Déchiffre les champs d'un utilisateur
   * @param {Object} user
   * @param {Object} options
   * @returns {Promise<Object>}
   */
  async _decryptUserFields(user, options = {}) {
    if (!user) return null;

    const data = user.toJSON ? user.toJSON() : { ...user };

    // Déchiffrer les champs essentiels
    if (data.email_encrypted) {
      data.email = crypto.decryptFromBuffer(Buffer.from(data.email_encrypted)).toString('utf8');
      delete data.email_encrypted;
    }

    if (data.first_name_encrypted) {
      data.firstName = crypto.decryptFromBuffer(Buffer.from(data.first_name_encrypted)).toString('utf8');
      delete data.first_name_encrypted;
    }

    if (data.last_name_encrypted) {
      data.lastName = crypto.decryptFromBuffer(Buffer.from(data.last_name_encrypted)).toString('utf8');
      delete data.last_name_encrypted;
    }

    if (!options.minimal && data.phone_encrypted) {
      data.phone = crypto.decryptFromBuffer(Buffer.from(data.phone_encrypted)).toString('utf8');
      delete data.phone_encrypted;
    } else {
      delete data.phone_encrypted;
    }

    // Nettoyer les champs techniques
    delete data.email_hash;
    delete data.first_name_hash;
    delete data.last_name_hash;
    delete data.first_name_phonetic;
    delete data.last_name_phonetic;
    delete data.phonetic_algo;
    delete data.enc_key_id;

    // Convertir snake_case en camelCase
    return this._toCamelCase(data);
  }

  /**
   * Déchiffre un champ unique
   * @param {Buffer} encrypted
   * @returns {string}
   */
  _decryptField(encrypted) {
    if (!encrypted) return null;
    return crypto.decryptFromBuffer(Buffer.from(encrypted)).toString('utf8');
  }

  /**
   * Génère l'empreinte phonétique
   * @param {string} name
   * @returns {string}
   */
  _generatePhonetic(name) {
    if (!name) return null;
    return name.toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z]/g, '');
  }

  /**
   * Convertit snake_case en camelCase
   * @param {Object} obj
   * @returns {Object}
   */
  _toCamelCase(obj) {
    const result = {};
    for (const key in obj) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = obj[key];
    }
    return result;
  }

  /**
   * Log une action d'audit
   * @param {number} memberId
   * @param {string} action
   * @param {string} result
   * @param {Object} details
   */
  async _logAudit(memberId, action, result, details = {}) {
    try {
      await this.AuditLog.create({
        member_id: memberId,
        action,
        action_category: 'user',
        result,
        metadata: details
      });
    } catch (err) {
      console.error('Erreur audit log:', err);
    }
  }
}

/**
 * Classe d'erreur utilisateur
 */
class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.statusCode = this._getStatusCode(code);
  }

  _getStatusCode(code) {
    const codes = {
      USER_NOT_FOUND: 404,
      EMAIL_EXISTS: 409,
      GROUP_NOT_FOUND: 404,
      NOT_IN_GROUP: 400,
      INVALID_STATUS: 400,
      PERMISSION_DENIED: 403
    };
    return codes[code] || 500;
  }
}

module.exports = UserService;
module.exports.UserError = UserError;
