// packages/local/src/models/index.js
// Local server models - Optimized for SQLite

const LocalUser = require('./LocalUser');
const LocalGuard = require('./LocalGuard');
const LocalAssignment = require('./LocalAssignment');
const LocalGroup = require('./LocalGroup');
const LocalGroupMembership = require('./LocalGroupMembership');
const LocalNotification = require('./LocalNotification');
const SyncQueue = require('./SyncQueue');
const LocalChange = require('./LocalChange');
const HeartbeatLog = require('./HeartbeatLog');
const LocalConfig = require('./LocalConfig');

// Export all models
module.exports = {
    LocalUser,
    LocalGuard,
    LocalAssignment,
    LocalGroup,
    LocalGroupMembership,
    LocalNotification,
    SyncQueue,
    LocalChange,
    HeartbeatLog,
    LocalConfig
};

// Define associations after all models are loaded
module.exports.associate = function() {
    // User associations
    LocalUser.hasMany(LocalAssignment, { 
        foreignKey: 'member_id', 
        as: 'assignments' 
    });
    
    LocalUser.hasMany(LocalNotification, { 
        foreignKey: 'member_id', 
        as: 'notifications' 
    });
    
    LocalUser.belongsToMany(LocalGroup, {
        through: LocalGroupMembership,
        foreignKey: 'member_id',
        otherKey: 'group_id',
        as: 'groups'
    });
    
    // Guard associations
    LocalGuard.hasMany(LocalAssignment, { 
        foreignKey: 'guard_id', 
        as: 'assignments' 
    });
    
    LocalGuard.belongsTo(LocalUser, { 
        foreignKey: 'created_by_member_id', 
        as: 'creator' 
    });
    
    // Assignment associations
    LocalAssignment.belongsTo(LocalUser, { 
        foreignKey: 'member_id', 
        as: 'user' 
    });
    
    LocalAssignment.belongsTo(LocalGuard, { 
        foreignKey: 'guard_id', 
        as: 'guard' 
    });
    
    LocalAssignment.belongsTo(LocalUser, { 
        foreignKey: 'assigned_by_member_id', 
        as: 'assignedBy' 
    });
    
    // Group associations
    LocalGroup.belongsTo(LocalUser, { 
        foreignKey: 'leader_member_id', 
        as: 'leader' 
    });
    
    LocalGroup.belongsToMany(LocalUser, {
        through: LocalGroupMembership,
        foreignKey: 'group_id',
        otherKey: 'member_id',
        as: 'members'
    });
    
    // Group Membership associations
    LocalGroupMembership.belongsTo(LocalUser, { 
        foreignKey: 'member_id', 
        as: 'user' 
    });
    
    LocalGroupMembership.belongsTo(LocalGroup, { 
        foreignKey: 'group_id', 
        as: 'group' 
    });
    
    // Notification associations
    LocalNotification.belongsTo(LocalUser, { 
        foreignKey: 'member_id', 
        as: 'user' 
    });
};
