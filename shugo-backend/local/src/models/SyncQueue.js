// packages/local/src/models/SyncQueue.js
// Sync queue model - Persistent queue for offline sync

const { DataTypes } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class SyncQueue extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'SyncQueue', {
            id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            
            operation: {
                type: DataTypes.ENUM('create', 'update', 'delete', 'sync'),
                allowNull: false
            },
            
            entity: {
                type: DataTypes.STRING(50),
                allowNull: false
            },
            
            entity_id: {
                type: DataTypes.STRING(100),
                allowNull: true
            },
            
            data: {
                type: DataTypes.JSON, // Use JSON for SQLite compatibility
                allowNull: false
            },
            
            priority: {
                type: DataTypes.INTEGER,
                defaultValue: 5,
                validate: {
                    min: 1,
                    max: 10
                }
            },
            
            status: {
                type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'dead'),
                defaultValue: 'pending'
            },
            
            retries: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            
            max_retries: {
                type: DataTypes.INTEGER,
                defaultValue: 3
            },
            
            error: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            
            scheduled_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW
            },
            
            processed_at: {
                type: DataTypes.DATE,
                allowNull: true
            }
        }, {
            tableName: 'sync_queue',
            indexes: [
                { fields: ['status'] },
                { fields: ['priority'] },
                { fields: ['scheduled_at'] },
                { fields: ['entity', 'entity_id'] }
            ]
        });
    }
    
    /**
     * Add item to queue
     */
    static async enqueue(operation, entity, data, options = {}) {
        return await this.create({
            operation,
            entity,
            entity_id: data.id || data.guard_id || data.member_id,
            data,
            priority: options.priority || 5,
            scheduled_at: options.scheduledAt || new Date()
        });
    }
    
    /**
     * Get next items to process
     */
    static async getNextBatch(limit = 10) {
        return await this.findAll({
            where: {
                status: 'pending',
                scheduled_at: {
                    [require('sequelize').Op.lte]: new Date()
                }
            },
            order: [
                ['priority', 'ASC'],
                ['scheduled_at', 'ASC']
            ],
            limit
        });
    }
    
    /**
     * Mark as processing
     */
    async markProcessing() {
        this.status = 'processing';
        await this.save();
    }
    
    /**
     * Mark as completed
     */
    async markCompleted() {
        this.status = 'completed';
        this.processed_at = new Date();
        await this.save();
    }
    
    /**
     * Mark as failed
     */
    async markFailed(error) {
        this.retries += 1;
        this.error = error.message || error;
        
        if (this.retries >= this.max_retries) {
            this.status = 'dead';
        } else {
            this.status = 'pending';
            // Exponential backoff
            const delayMinutes = Math.pow(2, this.retries);
            this.scheduled_at = new Date(Date.now() + delayMinutes * 60000);
        }
        
        await this.save();
    }
    
    /**
     * Clean old completed items
     */
    static async cleanOld(days = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        
        return await this.destroy({
            where: {
                status: 'completed',
                processed_at: {
                    [require('sequelize').Op.lt]: cutoff
                }
            }
        });
    }
    
    /**
     * Get queue statistics
     */
    static async getStatistics() {
        const { sequelize } = this;
        const results = await sequelize.query(`
            SELECT 
                status,
                COUNT(*) as count,
                AVG(retries) as avg_retries
            FROM sync_queue
            GROUP BY status
        `, { type: sequelize.QueryTypes.SELECT });
        
        const stats = {
            total: 0,
            byStatus: {}
        };
        
        for (const row of results) {
            stats.byStatus[row.status] = {
                count: parseInt(row.count),
                avgRetries: parseFloat(row.avg_retries) || 0
            };
            stats.total += parseInt(row.count);
        }
        
        return stats;
    }
}

module.exports = SyncQueue;
