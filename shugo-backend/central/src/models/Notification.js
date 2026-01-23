// src/models/Notification.js
// Modèle pour les notifications système

const { DataTypes, Op } = require('sequelize');
const { sequelize } = require('../database/connection');

/**
 * Modèle Notification - Gestion des notifications
 */
const Notification = sequelize.define('Notification', {
    notification_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    
    member_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Destinataire'
    },
    
    type: {
        type: DataTypes.ENUM(
            'guard_reminder',
            'guard_cancellation',
            'guard_assignment',
            'system_alert',
            'maintenance',
            'security',
            'message',
            'announcement',
            'protocol_activation'
        ),
        allowNull: false,
        comment: 'Type de notification'
    },
    
    category: {
        type: DataTypes.ENUM('system', 'guard', 'admin', 'security', 'info'),
        allowNull: false,
        defaultValue: 'info',
        comment: 'Catégorie'
    },
    
    title: {
        type: DataTypes.STRING(200),
        allowNull: false,
        comment: 'Titre'
    },
    
    message: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Message'
    },
    
    priority: {
        type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
        defaultValue: 'normal',
        comment: 'Priorité'
    },
    
    channel: {
        type: DataTypes.ENUM('email', 'matrix', 'push', 'sms', 'internal'),
        allowNull: false,
        defaultValue: 'internal',
        comment: 'Canal de notification'
    },
    
    status: {
        type: DataTypes.ENUM('pending', 'sent', 'delivered', 'failed', 'cancelled', 'read'),
        defaultValue: 'pending',
        comment: 'Statut'
    },
    
    sent_at: {
        type: DataTypes.DATE,
        comment: 'Date d\'envoi'
    },
    
    delivered_at: {
        type: DataTypes.DATE,
        comment: 'Date de réception'
    },
    
    read_at: {
        type: DataTypes.DATE,
        comment: 'Date de lecture'
    },
    
    expires_at: {
        type: DataTypes.DATE,
        comment: 'Date d\'expiration'
    },
    
    retry_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Nombre de tentatives'
    },
    
    max_retries: {
        type: DataTypes.INTEGER,
        defaultValue: 3,
        comment: 'Tentatives maximum'
    },
    
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Métadonnées'
    },
    
    action_url: {
        type: DataTypes.STRING,
        comment: 'URL d\'action'
    },
    
    action_label: {
        type: DataTypes.STRING,
        comment: 'Label du bouton d\'action'
    },
    
    sender_member_id: {
        type: DataTypes.BIGINT,
        references: {
            model: 'users',
            key: 'member_id'
        },
        comment: 'Expéditeur (si applicable)'
    },
    
    group_id: {
        type: DataTypes.UUID,
        references: {
            model: 'groups',
            key: 'group_id'
        },
        comment: 'Groupe concerné'
    },
    
    guard_id: {
        type: DataTypes.UUID,
        references: {
            model: 'guards',
            key: 'guard_id'
        },
        comment: 'Garde concernée'
    },
    
    error_message: {
        type: DataTypes.TEXT,
        comment: 'Message d\'erreur si échec'
    }
}, {
    tableName: 'notifications',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
        { fields: ['member_id'] },
        { fields: ['status'] },
        { fields: ['type'] },
        { fields: ['priority'] },
        { fields: ['created_at'] },
        { fields: ['expires_at'] },
        { fields: ['sender_member_id'] }
    ]
});

// Hooks
Notification.beforeCreate(async (notification) => {
    // Définir l'expiration par défaut selon le type
    if (!notification.expires_at) {
        const expirationHours = {
            urgent: 24,
            high: 48,
            normal: 72,
            low: 168 // 7 jours
        };
        
        const hours = expirationHours[notification.priority] || 72;
        notification.expires_at = new Date(Date.now() + hours * 60 * 60 * 1000);
    }
});

// Méthodes d'instance
Notification.prototype.send = async function() {
    try {
        // TODO: Implémenter l'envoi selon le canal
        this.status = 'sent';
        this.sent_at = new Date();
        await this.save();
        
        // Simuler la délivrance
        setTimeout(async () => {
            this.status = 'delivered';
            this.delivered_at = new Date();
            await this.save();
        }, 1000);
        
        return true;
    } catch (error) {
        this.retry_count += 1;
        
        if (this.retry_count >= this.max_retries) {
            this.status = 'failed';
            this.error_message = error.message;
        }
        
        await this.save();
        return false;
    }
};

Notification.prototype.markAsRead = async function() {
    this.status = 'read';
    this.read_at = new Date();
    return this.save();
};

Notification.prototype.cancel = async function() {
    if (this.status === 'pending') {
        this.status = 'cancelled';
        return this.save();
    }
    throw new Error('Can only cancel pending notifications');
};

Notification.prototype.retry = async function() {
    if (this.retry_count < this.max_retries) {
        this.status = 'pending';
        this.retry_count += 1;
        await this.save();
        return this.send();
    }
    throw new Error('Maximum retries exceeded');
};

// Méthodes statiques
Notification.findUnread = function(memberId, options = {}) {
    const where = {
        member_id: memberId,
        status: { [Op.ne]: 'read' },
        expires_at: { [Op.gt]: new Date() }
    };
    
    return this.findAll({
        where: { ...where, ...options.where },
        order: [['priority', 'DESC'], ['created_at', 'DESC']],
        ...options
    });
};

Notification.findByPriority = function(memberId, priority) {
    return this.findAll({
        where: {
            member_id: memberId,
            priority,
            status: { [Op.ne]: 'read' },
            expires_at: { [Op.gt]: new Date() }
        },
        order: [['created_at', 'DESC']]
    });
};

Notification.countUnread = function(memberId) {
    return this.count({
        where: {
            member_id: memberId,
            status: { [Op.ne]: 'read' },
            expires_at: { [Op.gt]: new Date() }
        }
    });
};

Notification.markAllAsRead = async function(memberId) {
    return this.update(
        {
            status: 'read',
            read_at: new Date()
        },
        {
            where: {
                member_id: memberId,
                status: { [Op.ne]: 'read' }
            }
        }
    );
};

Notification.sendBulk = async function(notifications) {
    const created = await this.bulkCreate(notifications);
    
    // Envoyer chaque notification
    const results = await Promise.all(
        created.map(notification => notification.send())
    );
    
    return results;
};

Notification.cleanExpired = async function() {
    const result = await this.destroy({
        where: {
            expires_at: { [Op.lt]: new Date() },
            status: { [Op.ne]: 'read' }
        }
    });
    
    return result;
};

Notification.createGuardReminder = async function(memberId, guardId, hoursBeforeStart = 24) {
    const Guard = require('./Guard');
    const guard = await Guard.findByPk(guardId);
    
    if (!guard) throw new Error('Guard not found');
    
    const guardStart = new Date(`${guard.guard_date} ${guard.start_time}`);
    const reminderTime = new Date(guardStart.getTime() - hoursBeforeStart * 60 * 60 * 1000);
    
    return this.create({
        member_id: memberId,
        type: 'guard_reminder',
        category: 'guard',
        title: `Rappel: Garde dans ${hoursBeforeStart}h`,
        message: `Vous avez une garde prévue le ${guard.guard_date} à ${guard.start_time}`,
        priority: hoursBeforeStart <= 24 ? 'high' : 'normal',
        guard_id: guardId,
        metadata: {
            guard_date: guard.guard_date,
            guard_time: guard.start_time,
            hours_before: hoursBeforeStart
        }
    });
};

Notification.createSystemAlert = async function(memberId, title, message, priority = 'high') {
    return this.create({
        member_id: memberId,
        type: 'system_alert',
        category: 'system',
        title,
        message,
        priority,
        channel: 'internal'
    });
};

module.exports = Notification;
