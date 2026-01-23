// packages/local/src/models/LocalGuard.js
// Local guard model - Guards for this geo_id

const { DataTypes, Op } = require('sequelize');
const BaseModel = require('@shugo/core/models/BaseModel');

class LocalGuard extends BaseModel {
    static init(sequelize) {
        return super.initBase(sequelize, 'LocalGuard', {
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
                defaultValue: 30, // minutes
                validate: {
                    min: 15,
                    max: 480
                }
            },
            
            guard_type: {
                type: DataTypes.ENUM('standard', 'preparation', 'closure', 'special', 'maintenance'),
                defaultValue: 'standard'
            },
            
            max_participants: {
                type: DataTypes.INTEGER,
                defaultValue: 1,
                validate: {
                    min: 1,
                    max: 20
                }
            },
            
            min_participants: {
                type: DataTypes.INTEGER,
                defaultValue: 1,
                validate: {
                    min: 0
                }
            },
            
            current_participants: {
                type: DataTypes.INTEGER,
                defaultValue: 0
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
                }
            },
            
            description: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            
            requirements: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            
            created_by_member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            
            // Recurrence
            is_recurring: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            
            recurrence_rule: {
                type: DataTypes.TEXT,
                allowNull: true
            },
            
            parent_guard_id: {
                type: DataTypes.UUID,
                allowNull: true
            },
            
            // Sync
            synced: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            
            sync_version: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            
            last_sync_at: {
                type: DataTypes.DATE,
                allowNull: true
            },
            
            // Local modifications
            locally_modified: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            
            modification_reason: {
                type: DataTypes.TEXT,
                allowNull: true
            }
        }, {
            tableName: 'local_guards',
            indexes: [
                { fields: ['geo_id'] },
                { fields: ['guard_date'] },
                { fields: ['start_time'] },
                { fields: ['status'] },
                { fields: ['created_by_member_id'] },
                { fields: ['synced'] },
                { fields: ['locally_modified'] },
                { 
                    fields: ['guard_date', 'start_time', 'end_time'],
                    unique: true
                }
            ],
            hooks: {
                beforeSave: async (guard) => {
                    // Update status based on participants
                    if (guard.current_participants >= guard.max_participants) {
                        guard.status = 'full';
                    } else if (guard.current_participants > 0 && guard.status === 'full') {
                        guard.status = 'open';
                    }
                }
            }
        });
    }
    
    /**
     * Check if guard is in the past
     */
    isPast() {
        const now = new Date();
        const guardDateTime = new Date(`${this.guard_date}T${this.start_time}`);
        return guardDateTime < now;
    }
    
    /**
     * Check if guard is today
     */
    isToday() {
        const today = new Date().toISOString().split('T')[0];
        return this.guard_date === today;
    }
    
    /**
     * Check if guard is full
     */
    isFull() {
        return this.current_participants >= this.max_participants;
    }
    
    /**
     * Check if guard has space
     */
    hasSpace() {
        return this.current_participants < this.max_participants;
    }
    
    /**
     * Add participant
     */
    async addParticipant() {
        if (this.isFull()) {
            throw new Error('Guard is full');
        }
        
        this.current_participants += 1;
        this.locally_modified = true;
        await this.save();
    }
    
    /**
     * Remove participant
     */
    async removeParticipant() {
        if (this.current_participants > 0) {
            this.current_participants -= 1;
            this.locally_modified = true;
            await this.save();
        }
    }
    
    /**
     * Get upcoming guards
     */
    static async getUpcoming(geoId, days = 7) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);
        
        return await this.findAll({
            where: {
                geo_id: geoId,
                guard_date: {
                    [Op.between]: [new Date().toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
                },
                status: {
                    [Op.ne]: 'cancelled'
                }
            },
            order: [['guard_date', 'ASC'], ['start_time', 'ASC']]
        });
    }
    
    /**
     * Get guards needing sync
     */
    static async getNeedingSync() {
        return await this.findAll({
            where: {
                [Op.or]: [
                    { synced: false },
                    { locally_modified: true }
                ]
            },
            limit: 50
        });
    }
    
    /**
     * Get guards with low participation
     */
    static async getLowParticipation(geoId, threshold = 0.5) {
        const guards = await this.findAll({
            where: {
                geo_id: geoId,
                guard_date: {
                    [Op.gte]: new Date().toISOString().split('T')[0]
                },
                status: 'open'
            }
        });
        
        return guards.filter(g => 
            (g.current_participants / g.max_participants) < threshold
        );
    }
    
    /**
     * Mark as synced
     */
    async markSynced() {
        this.synced = true;
        this.locally_modified = false;
        this.last_sync_at = new Date();
        this.sync_version = (this.sync_version || 0) + 1;
        await this.save();
    }
    
    /**
     * Associate method
     */
    static associate(models) {
        // Associations are defined in models/index.js
    }
}

module.exports = LocalGuard;
