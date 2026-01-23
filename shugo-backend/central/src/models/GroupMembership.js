// src/models/GroupMembership.js
// Modèle pour l'appartenance aux groupes

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

/**
 * Modèle GroupMembership - Appartenance des membres aux groupes
 */
const GroupMembership = sequelize.define('GroupMembership', {
    membership_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    group_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'groups',
            key: 'group_id'
        },
        comment: 'Référence vers le groupe'
    },
    
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'ID du membre'
    },
    
    role_in_group: {
        type: DataTypes.ENUM('member', 'deputy', 'leader'),
        defaultValue: 'member',
        comment: 'Rôle dans le groupe'
    },
    
    joined_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        comment: 'Date d\'adhésion'
    },
    
    left_at: {
        type: DataTypes.DATE,
        comment: 'Date de départ'
    },
    
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Membre actif'
    },
    
    added_by_member_id: {
        type: DataTypes.BIGINT,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Ajouté par'
    },
    
    removed_by_member_id: {
        type: DataTypes.BIGINT,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Retiré par'
    },
    
    removal_reason: {
        type: DataTypes.TEXT,
        comment: 'Raison du retrait'
    },
    
    permissions: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Permissions spécifiques dans le groupe'
    },
    
    notes: {
        type: DataTypes.TEXT,
        comment: 'Notes additionnelles'
    }
}, {
    tableName: 'group_memberships',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['group_id'] },
        { fields: ['member_id'] },
        { fields: ['is_active'] },
        {
            unique: true,
            fields: ['group_id', 'member_id', 'is_active'],
            where: { is_active: true },
            name: 'unique_active_membership'
        }
    ]
});

// Hooks
GroupMembership.beforeCreate(async (membership) => {
    // Vérifier qu'il n'y a pas déjà une appartenance active
    const existing = await GroupMembership.findOne({
        where: {
            group_id: membership.group_id,
            member_id: membership.member_id,
            is_active: true
        }
    });
    
    if (existing) {
        throw new Error('Member already in this group');
    }
});

GroupMembership.afterCreate(async (membership) => {
    // Incrémenter le compteur du groupe
    const Group = require('./Group');
    const group = await Group.findByPk(membership.group_id);
    if (group) {
        await group.incrementMembers();
    }
});

GroupMembership.afterUpdate(async (membership) => {
    const previous = membership._previousDataValues;
    
    // Si le membre quitte le groupe
    if (previous.is_active && !membership.is_active) {
        membership.left_at = new Date();
        
        const Group = require('./Group');
        const group = await Group.findByPk(membership.group_id);
        if (group) {
            await group.decrementMembers();
        }
    }
});

// Méthodes d'instance
GroupMembership.prototype.leave = async function(reason = null, removedBy = null) {
    this.is_active = false;
    this.left_at = new Date();
    this.removal_reason = reason;
    this.removed_by_member_id = removedBy;
    return this.save();
};

GroupMembership.prototype.setRole = async function(role) {
    this.role_in_group = role;
    return this.save();
};

GroupMembership.prototype.grantPermission = async function(permission, value = true) {
    this.permissions = this.permissions || {};
    this.permissions[permission] = value;
    this.changed('permissions', true);
    return this.save();
};

GroupMembership.prototype.revokePermission = async function(permission) {
    if (this.permissions && this.permissions[permission]) {
        delete this.permissions[permission];
        this.changed('permissions', true);
        return this.save();
    }
    return this;
};

// Méthodes statiques
GroupMembership.findActiveByGroup = function(groupId) {
    return this.findAll({
        where: {
            group_id: groupId,
            is_active: true
        },
        order: [['role_in_group', 'DESC'], ['joined_at', 'ASC']]
    });
};

GroupMembership.findActiveByMember = function(memberId) {
    return this.findAll({
        where: {
            member_id: memberId,
            is_active: true
        },
        include: [{
            model: require('./Group'),
            where: { status: 'active' }
        }]
    });
};

GroupMembership.countActiveMembers = function(groupId) {
    return this.count({
        where: {
            group_id: groupId,
            is_active: true
        }
    });
};

GroupMembership.transferLeadership = async function(groupId, newLeaderId) {
    const transaction = await sequelize.transaction();
    
    try {
        // Retirer l'ancien leader
        await this.update(
            { role_in_group: 'member' },
            {
                where: {
                    group_id: groupId,
                    role_in_group: 'leader'
                },
                transaction
            }
        );
        
        // Promouvoir le nouveau leader
        await this.update(
            { role_in_group: 'leader' },
            {
                where: {
                    group_id: groupId,
                    member_id: newLeaderId,
                    is_active: true
                },
                transaction
            }
        );
        
        await transaction.commit();
        return true;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
};

module.exports = GroupMembership;
