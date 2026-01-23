// src/models/Guard.js
// Modèle pour les gardes et plannings

const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../database/connection');

const Guard = sequelize.define('Guard', {
    guard_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    geo_id: {
        type: DataTypes.STRING(16),
        allowNull: false,
        validate: {
            is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
        }
    },
    
    guard_date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    
    start_time: {
        type: DataTypes.TIME,
        allowNull: false
    },
    
    end_time: {
        type: DataTypes.TIME,
        allowNull: false
    },
    
    slot_duration: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
        comment: 'Duration in minutes'
    },
    
    max_participants: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 1,
            max: 100
        }
    },
    
    min_participants: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 0,
            max: 100
        }
    },
    
    current_participants: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        validate: {
            min: 0
        }
    },
    
    guard_type: {
        type: DataTypes.ENUM('standard', 'preparation', 'closure', 'special', 'maintenance'),
        defaultValue: 'standard'
    },
    
    status: {
        type: DataTypes.ENUM('open', 'full', 'closed', 'cancelled'),
        defaultValue: 'open'
    },
    
    priority: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 1,
            max: 3
        },
        comment: '1=normal, 2=important, 3=urgent'
    },
    
    description: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    requirements: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Special requirements for this guard'
    },
    
    created_by_member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    scenario_id: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Reference to guard scenario template'
    },
    
    is_recurring: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    recurrence_rule: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'RRULE format for recurring guards'
    },
    
    parent_guard_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: 'guards',
            key: 'guard_id'
        },
        comment: 'For merged guards'
    },
    
    auto_generated: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    reminder_sent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    reminder_sent_at: {
        type: DataTypes.DATE,
        allowNull: true
    },

    slot_configuration: {
        type: DataTypes.JSON,
        defaultValue: {}
    },

    skill_requirements: {
        type: DataTypes.JSON,
        defaultValue: []
    },

    auto_assign_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    auto_assign_rules: {
        type: DataTypes.JSON,
        defaultValue: {}
    },

    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    },
    
    deleted_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'guards',
    timestamps: true,
    underscored: true,
    paranoid: true,
    deletedAt: 'deleted_at',
    indexes: [
        { fields: ['geo_id'] },
        { fields: ['guard_date'] },
        { fields: ['guard_date', 'start_time'] },
        { fields: ['status'] },
        { fields: ['created_by_member_id'] },
        { fields: ['scenario_id'] },
        { fields: ['parent_guard_id'] }
    ],
    hooks: {
        beforeValidate: (guard) => {
            // Update status based on participants
            if (guard.current_participants >= guard.max_participants) {
                guard.status = 'full';
            } else if (guard.status === 'full' && guard.current_participants < guard.max_participants) {
                guard.status = 'open';
            }
        }
    }
});

// Instance methods
Guard.prototype.isFull = function() {
    return this.current_participants >= this.max_participants;
};

Guard.prototype.isEmpty = function() {
    return this.current_participants === 0;
};

Guard.prototype.isCritical = function() {
    return this.current_participants < this.min_participants;
};

Guard.prototype.hasSpace = function() {
    return this.current_participants < this.max_participants && this.status === 'open';
};

Guard.prototype.addParticipant = async function() {
    this.current_participants += 1;
    if (this.current_participants >= this.max_participants) {
        this.status = 'full';
    }
    await this.save();
};

Guard.prototype.removeParticipant = async function() {
    if (this.current_participants > 0) {
        this.current_participants -= 1;
        if (this.status === 'full' && this.current_participants < this.max_participants) {
            this.status = 'open';
        }
    }
    await this.save();
};

Guard.prototype.getDateTime = function() {
    const dateStr = this.guard_date;
    const timeStr = this.start_time;
    return new Date(`${dateStr}T${timeStr}`);
};

Guard.prototype.getEndDateTime = function() {
    const dateStr = this.guard_date;
    const timeStr = this.end_time;
    return new Date(`${dateStr}T${timeStr}`);
};

Guard.prototype.isInFuture = function() {
    return this.getDateTime() > new Date();
};

Guard.prototype.isToday = function() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const guardDate = new Date(this.guard_date);
    guardDate.setHours(0, 0, 0, 0);
    return guardDate.getTime() === today.getTime();
};

Guard.prototype.getDaysUntil = function() {
    const now = new Date();
    const guardDate = this.getDateTime();
    const diffTime = guardDate - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// Class methods
Guard.findUpcoming = async function(days = 7, geoId = null) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    
    const where = {
        guard_date: {
            [Op.between]: [new Date(), endDate]
        },
        status: {
            [Op.in]: ['open', 'full']
        }
    };
    
    if (geoId) {
        where.geo_id = geoId;
    }
    
    return await this.findAll({
        where,
        order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });
};

Guard.findEmpty = async function(days = 7, geoId = null) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    
    const where = {
        guard_date: {
            [Op.between]: [new Date(), endDate]
        },
        current_participants: 0,
        status: 'open'
    };
    
    if (geoId) {
        where.geo_id = geoId;
    }
    
    return await this.findAll({
        where,
        order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });
};

Guard.findCritical = async function(hours = 72, geoId = null) {
    const endDate = new Date();
    endDate.setHours(endDate.getHours() + hours);
    
    const where = {
        guard_date: {
            [Op.lte]: endDate
        },
        status: 'open',
        [Op.where]: sequelize.literal('current_participants < min_participants')
    };
    
    if (geoId) {
        where.geo_id = geoId;
    }
    
    return await this.findAll({
        where,
        order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });
};

Guard.findByDateRange = async function(startDate, endDate, geoId = null) {
    const where = {
        guard_date: {
            [Op.between]: [startDate, endDate]
        }
    };
    
    if (geoId) {
        where.geo_id = geoId;
    }
    
    return await this.findAll({
        where,
        order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
    });
};

Guard.getCoverageStats = async function(startDate, endDate, geoId) {
    const guards = await this.findByDateRange(startDate, endDate, geoId);

    const totalSlots = guards.length;
    const coveredSlots = guards.filter(g => g.current_participants >= g.min_participants).length;
    const emptySlots = guards.filter(g => g.current_participants === 0).length;
    const criticalSlots = guards.filter(g => g.isCritical()).length;
    const fullSlots = guards.filter(g => g.isFull()).length;

    return {
        total: totalSlots,
        covered: coveredSlots,
        empty: emptySlots,
        critical: criticalSlots,
        full: fullSlots,
        coverageRate: totalSlots > 0 ? (coveredSlots / totalSlots * 100).toFixed(2) : 0,
        occupancyRate: totalSlots > 0 ?
            (guards.reduce((sum, g) => sum + g.current_participants, 0) /
            guards.reduce((sum, g) => sum + g.max_participants, 0) * 100).toFixed(2) : 0
    };
};

// Associations
Guard.associate = function(models) {
    Guard.hasMany(models.GuardSlot, {
        foreignKey: 'guard_id',
        as: 'slots'
    });
};

module.exports = Guard;
