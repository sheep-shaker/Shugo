// src/models/Location.js
// Modèle pour les localisations géographiques

const { DataTypes } = require('sequelize');
const { sequelize } = require('../database/connection');

const Location = sequelize.define('Location', {
    geo_id: {
        type: DataTypes.STRING(16),
        primaryKey: true,
        allowNull: false,
        validate: {
            is: /^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$/
        },
        comment: 'Format: CC-PPP-ZZ-JJ-NN'
    },
    
    name: {
        type: DataTypes.STRING(255),
        allowNull: false,
        validate: {
            notEmpty: true,
            len: [3, 255]
        }
    },
    
    address: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: {
            min: -90,
            max: 90
        }
    },
    
    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: {
            min: -180,
            max: 180
        }
    },
    
    timezone: {
        type: DataTypes.STRING(50),
        defaultValue: 'UTC',
        allowNull: false
    },
    
    continent_code: {
        type: DataTypes.CHAR(2),
        allowNull: false,
        validate: {
            isIn: [['01', '02', '03', '04', '05', '06']]
        },
        comment: '01=Asia/Oceania, 02=Europe, 03=Africa, 04=North America, 05=South America, 06=Russia'
    },
    
    country_code: {
        type: DataTypes.STRING(3),
        allowNull: false,
        comment: 'Country telephone prefix (e.g., 33 for France)'
    },
    
    region_code: {
        type: DataTypes.CHAR(2),
        allowNull: false,
        comment: 'Regional code within country'
    },
    
    parent_id: {
        type: DataTypes.CHAR(2),
        allowNull: false,
        comment: 'Parent location ID (JJ in format)'
    },
    
    local_id: {
        type: DataTypes.CHAR(2),
        allowNull: false,
        comment: 'Local ID (NN in format)'
    },
    
    status: {
        type: DataTypes.ENUM('active', 'inactive', 'maintenance'),
        defaultValue: 'active',
        allowNull: false
    },
    
    capacity: {
        type: DataTypes.INTEGER,
        allowNull: true,
        validate: {
            min: 0
        },
        comment: 'Maximum capacity of the location'
    },
    
    contact_email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
            isEmail: true
        }
    },
    
    contact_phone: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    
    opening_hours: {
        type: DataTypes.JSON,
        allowNull: true,
        defaultValue: {},
        comment: 'JSON object with days as keys and hours as values'
    },
    
    features: {
        type: DataTypes.JSON,
        defaultValue: [],
        comment: 'Array of location features/amenities'
    },
    
    metadata: {
        type: DataTypes.JSON,
        defaultValue: {},
        comment: 'Additional location metadata'
    }
}, {
    tableName: 'locations',
    timestamps: true,
    underscored: true,
    indexes: [
        { fields: ['continent_code'] },
        { fields: ['country_code'] },
        { fields: ['status'] },
        { fields: ['name'] },
        { fields: ['continent_code', 'country_code', 'region_code'] }
    ]
});

// Instance methods
Location.prototype.getFullPath = function() {
    return `${this.continent_code}-${this.country_code}-${this.region_code}-${this.parent_id}-${this.local_id}`;
};

Location.prototype.isParentOf = function(childGeoId) {
    const parentPrefix = this.geo_id.substring(0, 11); // Up to parent_id
    return childGeoId.startsWith(parentPrefix) && childGeoId !== this.geo_id;
};

Location.prototype.getParentGeoId = function() {
    if (this.local_id === '00') {
        // This is already a parent location
        return null;
    }
    return `${this.continent_code}-${this.country_code}-${this.region_code}-${this.parent_id}-00`;
};

// Class methods
Location.findByContinent = async function(continentCode) {
    return await this.findAll({
        where: { 
            continent_code: continentCode,
            status: 'active'
        },
        order: [['name', 'ASC']]
    });
};

Location.findByCountry = async function(countryCode) {
    return await this.findAll({
        where: { 
            country_code: countryCode,
            status: 'active'
        },
        order: [['name', 'ASC']]
    });
};

Location.findChildren = async function(parentGeoId) {
    const parentPrefix = parentGeoId.substring(0, 11);
    return await this.findAll({
        where: {
            geo_id: {
                [sequelize.Sequelize.Op.like]: `${parentPrefix}%`,
                [sequelize.Sequelize.Op.ne]: parentGeoId
            },
            status: 'active'
        },
        order: [['geo_id', 'ASC']]
    });
};

Location.getHierarchy = async function(geoId) {
    const location = await this.findByPk(geoId);
    if (!location) return null;
    
    const hierarchy = [location];
    let parentGeoId = location.getParentGeoId();
    
    while (parentGeoId) {
        const parent = await this.findByPk(parentGeoId);
        if (parent) {
            hierarchy.unshift(parent);
            parentGeoId = parent.getParentGeoId();
        } else {
            break;
        }
    }
    
    return hierarchy;
};

module.exports = Location;
