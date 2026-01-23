// src/models/Group.js
// Modèle pour les groupes d'utilisateurs

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const Group = sequelize.define('Group', {
    group_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [3, 100]
        }
    },
    
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
        }
    },
    
    parent_group_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'groups',
            key: 'group_id'
        }
    },
    
    leader_member_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    deputy_member_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    max_members: {
        type: DataTypes.INTEGER,
        defaultValue: 50,
        validate: {
            min: 1,
            max: 500
        }
    },
    
    current_members: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    
    group_type: {
        type: DataTypes.ENUM('operational', 'administrative', 'training', 'special'),
        defaultValue: 'operational'
    },
    
    color_code: {
        type: DataTypes.STRING(7),
        allowNull: true,
        validate: {
            is: /^#[0-9A-Fa-f]{6}$/
        }
    },
    
    icon: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'archived'),
        defaultValue: 'active'
    },
    
    visibility: {
        type: DataTypes.ENUM('public', 'private', 'restricted'),
        defaultValue: 'public'
    },
    
    join_approval_required: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    auto_assign_guards: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    guard_preferences: {
        type: DataTypes.JSON,
        defaultValue: {
            min_guards_per_month: 0,
            max_guards_per_month: null,
            preferred_days: [],
            preferred_times: []
        }
    },

    notification_settings: {
        type: DataTypes.JSON,
        defaultValue: {
            new_guard: true,
            guard_reminder: true,
            member_joined: true,
            member_left: true
        }
    },

    permissions: {
        type: DataTypes.JSON,
        defaultValue: {
            can_create_guards: false,
            can_modify_guards: false,
            can_invite_members: false,
            can_remove_members: false
        }
    },

    tags: {
        type: DataTypes.JSON,
        defaultValue: []
    },

    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'groups',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['geo_id'] },
        { fields: ['parent_group_id'] },
        { fields: ['leader_member_id'] },
        { fields: ['deputy_member_id'] },
        { fields: ['status'] },
        { fields: ['group_type'] },
        { fields: ['name'] }
    ],
    hooks: {
        beforeValidate: (group) => {
            // Ensure current_members doesn't exceed max_members
            if (group.current_members > group.max_members) {
                throw new Error('Current members cannot exceed maximum members');
            }
        }
    }
});

// Instance methods
Group.prototype.isFull = function() {
    return this.current_members >= this.max_members;
};

Group.prototype.hasSpace = function() {
    return this.current_members < this.max_members;
};

Group.prototype.addMember = async function() {
    if (this.isFull()) {
        throw new Error('Group is full');
    }
    this.current_members += 1;
    await this.save();
};

Group.prototype.removeMember = async function() {
    if (this.current_members > 0) {
        this.current_members -= 1;
        await this.save();
    }
};

Group.prototype.setLeader = async function(memberId) {
    this.leader_member_id = memberId;
    await this.save();
};

Group.prototype.setDeputy = async function(memberId) {
    this.deputy_member_id = memberId;
    await this.save();
};

Group.prototype.archive = async function() {
    this.status = 'archived';
    await this.save();
};

Group.prototype.activate = async function() {
    this.status = 'active';
    await this.save();
};

Group.prototype.getFullHierarchy = async function() {
    const hierarchy = [this.toJSON()];
    let currentGroup = this;
    
    // Get parent groups
    while (currentGroup.parent_group_id) {
        const parent = await Group.findByPk(currentGroup.parent_group_id);
        if (parent) {
            hierarchy.unshift(parent.toJSON());
            currentGroup = parent;
        } else {
            break;
        }
    }
    
    // Get child groups
    const children = await Group.findAll({
        where: { parent_group_id: this.group_id }
    });
    
    if (children.length > 0) {
        hierarchy.push(...children.map(c => c.toJSON()));
    }
    
    return hierarchy;
};

// Class methods
Group.findByGeoId = async function(geoId) {
    return await this.findAll({
        where: {
            geo_id: geoId,
            status: 'active'
        },
        order: [['name', 'ASC']]
    });
};

Group.findByLeader = async function(leaderId) {
    return await this.findAll({
        where: {
            leader_member_id: leaderId,
            status: 'active'
        }
    });
};

Group.findChildren = async function(parentGroupId) {
    return await this.findAll({
        where: {
            parent_group_id: parentGroupId,
            status: 'active'
        },
        order: [['name', 'ASC']]
    });
};

Group.findAvailable = async function(geoId = null) {
    const where = {
        status: 'active',
        visibility: ['public', 'restricted']
    };
    
    if (geoId) {
        where.geo_id = geoId;
    }
    
    return await this.findAll({
        where,
        having: sequelize.literal('current_members < max_members'),
        order: [['name', 'ASC']]
    });
};

Group.getStatistics = async function(groupId) {
    const group = await this.findByPk(groupId);
    if (!group) return null;
    
    const memberships = await sequelize.models.GroupMembership.count({
        where: {
            group_id: groupId,
            is_active: true
        }
    });
    
    const guards = await sequelize.models.Guard.count({
        where: {
            created_by_member_id: {
                [sequelize.Sequelize.Op.in]: sequelize.literal(`
                    (SELECT member_id FROM group_memberships 
                     WHERE group_id = '${groupId}' AND is_active = true)
                `)
            }
        }
    });
    
    return {
        group_id: groupId,
        name: group.name,
        total_members: memberships,
        max_members: group.max_members,
        occupancy_rate: ((memberships / group.max_members) * 100).toFixed(2),
        total_guards: guards,
        status: group.status
    };
};

Group.searchByName = async function(searchTerm, geoId = null) {
    const where = {
        name: {
            [sequelize.Sequelize.Op.iLike]: `%${searchTerm}%`
        },
        status: 'active'
    };
    
    if (geoId) {
        where.geo_id = geoId;
    }
    
    return await this.findAll({
        where,
        order: [['name', 'ASC']],
        limit: 20
    });
};

module.exports = Group;
