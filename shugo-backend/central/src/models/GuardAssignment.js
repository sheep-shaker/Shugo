// src/models/GuardAssignment.js
// Modèle pour les affectations de garde

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const GuardAssignment = sequelize.define('GuardAssignment', {
    assignment_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    guard_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'guards',
            key: 'guard_id'
        }
    },
    
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    assigned_by_member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    assignment_type: {
        type: DataTypes.ENUM('voluntary', 'assigned', 'automatic', 'waiting_list'),
        defaultValue: 'voluntary'
    },
    
    status: {
        type: DataTypes.ENUM('confirmed', 'pending', 'cancelled', 'completed'),
        defaultValue: 'confirmed'
    },
    
    assigned_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    
    confirmed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    cancellation_reason: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    cancellation_type: {
        type: DataTypes.ENUM('normal', 'early', 'late'),
        allowNull: true,
        comment: 'normal: >7 days, early: 72h-7 days, late: <72h'
    },
    
    replacement_requested: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    
    replacement_member_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: {
            model: 'users',
            key: 'member_id'
        }
    },
    
    replacement_deadline: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    replacement_status: {
        type: DataTypes.ENUM('pending', 'accepted', 'rejected', 'expired'),
        allowNull: true
    },
    
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    check_in_time: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    check_out_time: {
        type: DataTypes.DATE,
        allowNull: true
    },
    
    actual_duration_minutes: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    
    rating: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: 1,
            max: 5
        }
    },
    
    feedback: {
        type: DataTypes.TEXT,
        allowNull: true
    },

    slot_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'guard_slots',
            key: 'slot_id'
        }
    },

    skill_match_score: {
        type: DataTypes.FLOAT,
        defaultValue: 0.0
    },

    availability_match_score: {
        type: DataTypes.FLOAT,
        defaultValue: 0.0
    },

    auto_assigned: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },

    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'guard_assignments',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['guard_id'] },
        { fields: ['member_id'] },
        { fields: ['status'] },
        { fields: ['assigned_by_member_id'] },
        { fields: ['replacement_member_id'] },
        { fields: ['assigned_at'] },
        // Unique constraint to prevent double assignments
        { 
            unique: true,
            fields: ['guard_id', 'member_id'],
            where: {
                status: ['confirmed', 'pending']
            }
        }
    ]
});

// Instance methods
GuardAssignment.prototype.confirm = async function() {
    this.status = 'confirmed';
    this.confirmed_at = new Date();
    await this.save();
};

GuardAssignment.prototype.cancel = async function(reason, type = 'normal') {
    this.status = 'cancelled';
    this.cancelled_at = new Date();
    this.cancellation_reason = reason;
    this.cancellation_type = type;
    await this.save();
};

GuardAssignment.prototype.complete = async function() {
    this.status = 'completed';
    if (!this.check_out_time) {
        this.check_out_time = new Date();
    }
    if (this.check_in_time && this.check_out_time) {
        const duration = (this.check_out_time - this.check_in_time) / (1000 * 60);
        this.actual_duration_minutes = Math.round(duration);
    }
    await this.save();
};

GuardAssignment.prototype.checkIn = async function() {
    this.check_in_time = new Date();
    await this.save();
};

GuardAssignment.prototype.checkOut = async function() {
    this.check_out_time = new Date();
    if (this.check_in_time) {
        const duration = (this.check_out_time - this.check_in_time) / (1000 * 60);
        this.actual_duration_minutes = Math.round(duration);
    }
    await this.save();
};

GuardAssignment.prototype.requestReplacement = async function(replacementMemberId, deadline = null) {
    this.replacement_requested = true;
    this.replacement_member_id = replacementMemberId;
    this.replacement_deadline = deadline || new Date(Date.now() + 4 * 60 * 60 * 1000); // 4 hours default
    this.replacement_status = 'pending';
    await this.save();
};

GuardAssignment.prototype.acceptReplacement = async function() {
    if (this.replacement_status === 'pending' && this.replacement_member_id) {
        this.replacement_status = 'accepted';
        // The actual replacement logic would be handled at a higher level
        await this.save();
        return true;
    }
    return false;
};

GuardAssignment.prototype.rejectReplacement = async function() {
    this.replacement_status = 'rejected';
    await this.save();
};

GuardAssignment.prototype.getCancellationType = function(guardDate) {
    const now = new Date();
    const guard = new Date(guardDate);
    const daysUntil = (guard - now) / (1000 * 60 * 60 * 24);
    
    if (daysUntil > 7) return 'normal';
    if (daysUntil >= 3) return 'early';
    return 'late';
};

// Class methods
GuardAssignment.findByGuard = async function(guardId) {
    return await this.findAll({
        where: {
            guard_id: guardId,
            status: ['confirmed', 'pending']
        },
        include: [{
            model: sequelize.models.User,
            as: 'member',
            attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted', 'role']
        }],
        order: [['assigned_at', 'ASC']]
    });
};

GuardAssignment.findByMember = async function(memberId, options = {}) {
    const where = {
        member_id: memberId
    };
    
    if (options.status) {
        where.status = options.status;
    }
    
    if (options.startDate && options.endDate) {
        where.assigned_at = {
            [sequelize.Sequelize.Op.between]: [options.startDate, options.endDate]
        };
    }
    
    return await this.findAll({
        where,
        include: [{
            model: sequelize.models.Guard,
            as: 'guard'
        }],
        order: [['assigned_at', 'DESC']],
        limit: options.limit || 100
    });
};

GuardAssignment.findPendingReplacements = async function() {
    return await this.findAll({
        where: {
            replacement_requested: true,
            replacement_status: 'pending',
            replacement_deadline: {
                [sequelize.Sequelize.Op.gt]: new Date()
            }
        },
        include: [
            {
                model: sequelize.models.User,
                as: 'member',
                attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
            },
            {
                model: sequelize.models.User,
                as: 'replacementMember',
                attributes: ['member_id', 'first_name_encrypted', 'last_name_encrypted']
            }
        ]
    });
};

GuardAssignment.getStatsByMember = async function(memberId, startDate, endDate) {
    const assignments = await this.findAll({
        where: {
            member_id: memberId,
            status: 'completed',
            assigned_at: {
                [sequelize.Sequelize.Op.between]: [startDate, endDate]
            }
        }
    });
    
    const totalAssignments = assignments.length;
    const totalMinutes = assignments.reduce((sum, a) => sum + (a.actual_duration_minutes || 0), 0);
    const averageRating = assignments
        .filter(a => a.rating)
        .reduce((sum, a, _, arr) => sum + a.rating / arr.length, 0);
    
    const cancellations = await this.count({
        where: {
            member_id: memberId,
            status: 'cancelled',
            cancelled_at: {
                [sequelize.Sequelize.Op.between]: [startDate, endDate]
            }
        }
    });
    
    return {
        total_assignments: totalAssignments,
        total_hours: Math.round(totalMinutes / 60),
        average_rating: averageRating || null,
        cancellations: cancellations,
        completion_rate: totalAssignments > 0 ? 
            ((totalAssignments / (totalAssignments + cancellations)) * 100).toFixed(2) : 0
    };
};

module.exports = GuardAssignment;
