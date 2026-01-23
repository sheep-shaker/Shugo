// packages/local/plugins/calendar/index.js
// Calendar plugin for SHUGO - Activities and events management

const ShugoPlugin = require('@shugo/sdk/plugin-base/Plugin');
const { DataTypes } = require('sequelize');

class CalendarPlugin extends ShugoPlugin {
    
    async onInitialize() {
        this.logger.info('Calendar plugin initializing...');
        
        // Register models
        this.registerActivityModel();
        
        // Register routes
        this.registerRoutes();
        
        // Register hooks
        this.registerEventHooks();
        
        // Register commands
        this.registerCommands();
        
        // Register services
        this.registerCalendarService();
    }
    
    /**
     * Register activity model
     */
    registerActivityModel() {
        this.registerModel('Activity', {
            activity_id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            title: {
                type: DataTypes.STRING(200),
                allowNull: false
            },
            description: {
                type: DataTypes.TEXT
            },
            activity_type: {
                type: DataTypes.ENUM('event', 'meeting', 'training', 'closure'),
                defaultValue: 'event'
            },
            start_datetime: {
                type: DataTypes.DATE,
                allowNull: false
            },
            end_datetime: {
                type: DataTypes.DATE,
                allowNull: false
            },
            location: {
                type: DataTypes.STRING(255)
            },
            max_participants: {
                type: DataTypes.INTEGER,
                defaultValue: null
            },
            current_participants: {
                type: DataTypes.INTEGER,
                defaultValue: 0
            },
            registration_required: {
                type: DataTypes.BOOLEAN,
                defaultValue: false
            },
            visibility: {
                type: DataTypes.ENUM('public', 'private', 'group'),
                defaultValue: 'public'
            },
            geo_id: {
                type: DataTypes.STRING(16),
                allowNull: false
            },
            created_by_member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM('active', 'cancelled', 'completed'),
                defaultValue: 'active'
            }
        });
        
        this.registerModel('ActivityParticipant', {
            participant_id: {
                type: DataTypes.UUID,
                defaultValue: DataTypes.UUIDV4,
                primaryKey: true
            },
            activity_id: {
                type: DataTypes.UUID,
                allowNull: false
            },
            member_id: {
                type: DataTypes.BIGINT,
                allowNull: false
            },
            status: {
                type: DataTypes.ENUM('registered', 'confirmed', 'cancelled', 'attended'),
                defaultValue: 'registered'
            },
            registered_at: {
                type: DataTypes.DATE,
                defaultValue: DataTypes.NOW
            },
            notes: {
                type: DataTypes.TEXT
            }
        });
    }
    
    /**
     * Register plugin routes
     */
    registerRoutes() {
        // Get all activities
        this.registerRoute('GET', '/activities', async (req, res) => {
            try {
                const activities = await this.getActivities(req.query);
                res.json({ success: true, data: activities });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
        
        // Get activity by ID
        this.registerRoute('GET', '/activities/:id', async (req, res) => {
            try {
                const activity = await this.getActivity(req.params.id);
                res.json({ success: true, data: activity });
            } catch (error) {
                res.status(404).json({ success: false, error: 'Activity not found' });
            }
        });
        
        // Create activity
        this.registerRoute('POST', '/activities', async (req, res) => {
            try {
                const activity = await this.createActivity(req.body, req.user);
                res.json({ success: true, data: activity });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        }, { roles: ['Gold', 'Platinum', 'Admin'] });
        
        // Register for activity
        this.registerRoute('POST', '/activities/:id/register', async (req, res) => {
            try {
                const result = await this.registerForActivity(req.params.id, req.user);
                res.json({ success: true, data: result });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });
        
        // Cancel registration
        this.registerRoute('POST', '/activities/:id/cancel', async (req, res) => {
            try {
                const result = await this.cancelRegistration(req.params.id, req.user);
                res.json({ success: true, data: result });
            } catch (error) {
                res.status(400).json({ success: false, error: error.message });
            }
        });
        
        // Get calendar view
        this.registerRoute('GET', '/calendar', async (req, res) => {
            try {
                const calendar = await this.getCalendarView(req.query);
                res.json({ success: true, data: calendar });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
        });
    }
    
    /**
     * Register event hooks
     */
    registerEventHooks() {
        // When a guard is created, optionally create calendar event
        this.registerHook('guard.created', async (event) => {
            if (this.getConfig('sync_guards_to_calendar')) {
                await this.createActivityFromGuard(event.data);
            }
        });
        
        // When activity is created, notify users
        this.registerHook('calendar.activity.created', async (event) => {
            await this.notifyUsersAboutActivity(event.data);
        });
        
        // Sync activities with central server
        this.registerHook('sync.pull.completed', async (event) => {
            await this.syncActivitiesFromCentral();
        });
    }
    
    /**
     * Register commands
     */
    registerCommands() {
        this.registerCommand('list-activities', async (args) => {
            const activities = await this.getActivities({ limit: args.limit || 10 });
            return activities.map(a => `${a.title} - ${a.start_datetime}`).join('\n');
        }, {
            description: 'List upcoming activities',
            usage: 'list-activities [--limit=10]'
        });
        
        this.registerCommand('create-activity', async (args) => {
            const activity = await this.createActivity(args);
            return `Activity created: ${activity.title}`;
        }, {
            description: 'Create a new activity',
            usage: 'create-activity --title="..." --date="..." --time="..."'
        });
    }
    
    /**
     * Register calendar service
     */
    registerCalendarService() {
        const service = {
            getActivities: this.getActivities.bind(this),
            getActivity: this.getActivity.bind(this),
            createActivity: this.createActivity.bind(this),
            updateActivity: this.updateActivity.bind(this),
            deleteActivity: this.deleteActivity.bind(this),
            getParticipants: this.getParticipants.bind(this)
        };
        
        this.registerService('calendar', service);
    }
    
    /**
     * Plugin methods
     */
    
    async getActivities(filters = {}) {
        const { Activity } = await this.getModels();
        
        const where = {};
        if (filters.geo_id) where.geo_id = filters.geo_id;
        if (filters.type) where.activity_type = filters.type;
        if (filters.status) where.status = filters.status;
        
        // Get upcoming activities by default
        if (!filters.all) {
            where.start_datetime = {
                [require('sequelize').Op.gte]: new Date()
            };
        }
        
        return await Activity.findAll({
            where,
            order: [['start_datetime', 'ASC']],
            limit: filters.limit || 50
        });
    }
    
    async getActivity(activityId) {
        const { Activity, ActivityParticipant } = await this.getModels();
        
        return await Activity.findByPk(activityId, {
            include: [{
                model: ActivityParticipant,
                as: 'participants'
            }]
        });
    }
    
    async createActivity(data, user) {
        const { Activity } = await this.getModels();
        
        const activity = await Activity.create({
            ...data,
            created_by_member_id: user.member_id,
            geo_id: user.geo_id
        });
        
        // Emit event
        this.emitEvent('activity.created', activity);
        
        // Add to sync queue
        await this.addToSyncQueue('create', 'calendar_activity', activity);
        
        return activity;
    }
    
    async updateActivity(activityId, updates, user) {
        const { Activity } = await this.getModels();
        
        const activity = await Activity.findByPk(activityId);
        if (!activity) throw new Error('Activity not found');
        
        // Check permissions
        if (activity.created_by_member_id !== user.member_id && !user.can('manage_activities')) {
            throw new Error('Permission denied');
        }
        
        await activity.update(updates);
        
        // Emit event
        this.emitEvent('activity.updated', activity);
        
        // Add to sync queue
        await this.addToSyncQueue('update', 'calendar_activity', activity);
        
        return activity;
    }
    
    async deleteActivity(activityId, user) {
        const { Activity } = await this.getModels();
        
        const activity = await Activity.findByPk(activityId);
        if (!activity) throw new Error('Activity not found');
        
        // Check permissions
        if (activity.created_by_member_id !== user.member_id && !user.can('manage_activities')) {
            throw new Error('Permission denied');
        }
        
        activity.status = 'cancelled';
        await activity.save();
        
        // Emit event
        this.emitEvent('activity.cancelled', activity);
        
        // Add to sync queue
        await this.addToSyncQueue('update', 'calendar_activity', activity);
        
        return activity;
    }
    
    async registerForActivity(activityId, user) {
        const { Activity, ActivityParticipant } = await this.getModels();
        
        const activity = await Activity.findByPk(activityId);
        if (!activity) throw new Error('Activity not found');
        
        // Check if already registered
        const existing = await ActivityParticipant.findOne({
            where: {
                activity_id: activityId,
                member_id: user.member_id
            }
        });
        
        if (existing) {
            throw new Error('Already registered');
        }
        
        // Check capacity
        if (activity.max_participants && activity.current_participants >= activity.max_participants) {
            throw new Error('Activity is full');
        }
        
        // Register participant
        const participant = await ActivityParticipant.create({
            activity_id: activityId,
            member_id: user.member_id,
            status: 'registered'
        });
        
        // Update participant count
        activity.current_participants += 1;
        await activity.save();
        
        // Emit event
        this.emitEvent('activity.participant.added', {
            activity,
            participant
        });
        
        return participant;
    }
    
    async cancelRegistration(activityId, user) {
        const { Activity, ActivityParticipant } = await this.getModels();
        
        const participant = await ActivityParticipant.findOne({
            where: {
                activity_id: activityId,
                member_id: user.member_id,
                status: ['registered', 'confirmed']
            }
        });
        
        if (!participant) {
            throw new Error('Not registered');
        }
        
        // Cancel registration
        participant.status = 'cancelled';
        await participant.save();
        
        // Update participant count
        const activity = await Activity.findByPk(activityId);
        activity.current_participants = Math.max(0, activity.current_participants - 1);
        await activity.save();
        
        // Emit event
        this.emitEvent('activity.participant.removed', {
            activity,
            participant
        });
        
        return participant;
    }
    
    async getParticipants(activityId) {
        const { ActivityParticipant } = await this.getModels();
        
        return await ActivityParticipant.findAll({
            where: {
                activity_id: activityId,
                status: ['registered', 'confirmed']
            }
        });
    }
    
    async getCalendarView(options = {}) {
        const { start = new Date(), end, view = 'month' } = options;
        
        const activities = await this.getActivities({
            geo_id: options.geo_id,
            all: true
        });
        
        // Group by date
        const calendar = {};
        for (const activity of activities) {
            const date = activity.start_datetime.toISOString().split('T')[0];
            if (!calendar[date]) calendar[date] = [];
            calendar[date].push(activity);
        }
        
        return calendar;
    }
    
    async createActivityFromGuard(guard) {
        const { Activity } = await this.getModels();
        
        return await Activity.create({
            title: `Guard: ${guard.guard_date} ${guard.start_time}`,
            description: guard.description,
            activity_type: 'event',
            start_datetime: new Date(`${guard.guard_date}T${guard.start_time}`),
            end_datetime: new Date(`${guard.guard_date}T${guard.end_time}`),
            geo_id: guard.geo_id,
            created_by_member_id: guard.created_by_member_id,
            max_participants: guard.max_participants
        });
    }
    
    async notifyUsersAboutActivity(activity) {
        // Send notifications to users in the same geo_id
        const users = await this.database.models.LocalUser.findAll({
            where: { geo_id: activity.geo_id }
        });
        
        for (const user of users) {
            await this.database.models.LocalNotification.create({
                member_id: user.member_id,
                type: 'activity_created',
                title: 'New Activity',
                message: `New activity: ${activity.title}`,
                data: { activity_id: activity.activity_id }
            });
        }
    }
    
    async syncActivitiesFromCentral() {
        // Sync activities from central server
        this.logger.info('Syncing activities from central...');
    }
    
    async getModels() {
        // Get plugin models from database
        return {
            Activity: this.database.models[`Plugin_${this.id}_Activity`],
            ActivityParticipant: this.database.models[`Plugin_${this.id}_ActivityParticipant`]
        };
    }
    
    async addToSyncQueue(operation, entity, data) {
        const SyncQueue = this.database.models.SyncQueue;
        await SyncQueue.enqueue(operation, entity, data);
    }
}

module.exports = CalendarPlugin;
