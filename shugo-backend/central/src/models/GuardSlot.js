// models/GuardSlot.js
// Modèle pour la gestion détaillée des créneaux de garde

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const GuardSlot = sequelize.define('GuardSlot', {
    slot_id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    guard_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    slot_date: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    slot_time: {
        type: DataTypes.TIME,
        allowNull: false
    },
    duration_minutes: {
        type: DataTypes.INTEGER,
        defaultValue: 60,
        validate: {
            min: 15,
            max: 480
        }
    },
    required_participants: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 1
        }
    },
    assigned_participants: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    required_skills: {
        type: DataTypes.JSON,
        defaultValue: [],
        comment: 'Liste des compétences requises'
    },
    status: {
        type: DataTypes.STRING(20),
        defaultValue: 'available',
        validate: {
            isIn: [['available', 'partial', 'full', 'cancelled', 'completed']]
        }
    },
    geo_id: {
        type: DataTypes.STRING(20),
        allowNull: false
    },
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {}
    }
}, {
    tableName: 'guard_slots',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            fields: ['guard_id', 'slot_date', 'slot_time'],
            unique: true,
            name: 'idx_unique_slot'
        },
        {
            fields: ['slot_date', 'status'],
            name: 'idx_slot_date_status'
        },
        {
            fields: ['geo_id', 'slot_date'],
            name: 'idx_slot_geo_date'
        }
    ]
});

// Méthodes d'instance
GuardSlot.prototype.isFull = function() {
    return this.assigned_participants >= this.required_participants;
};

GuardSlot.prototype.availableSpots = function() {
    return Math.max(0, this.required_participants - this.assigned_participants);
};

GuardSlot.prototype.updateStatus = async function() {
    if (this.assigned_participants === 0) {
        this.status = 'available';
    } else if (this.assigned_participants < this.required_participants) {
        this.status = 'partial';
    } else {
        this.status = 'full';
    }
    return await this.save();
};

module.exports = GuardSlot;
