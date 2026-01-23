'use strict';

/**
 * Migration 001 - Table locations
 * 
 * Référentiel géographique pour tous les locaux existants dans le système.
 * Cette table est la base de toute la hiérarchie géographique SHUGO.
 * 
 * Format geo_id: CC-PPP-ZZ-JJ-NN
 * - CC = Code continent (01-06)
 * - PPP = Code pays (préfixe téléphonique)
 * - ZZ = Code région/zone
 * - JJ = Numéro du local père
 * - NN = Numéro du sous-local
 * 
 * @see Document Technique V7.0 - Section 2.4, Annexe A.1.1
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('locations', {
      geo_id: {
        type: Sequelize.STRING(16),
        primaryKey: true,
        allowNull: false,
        comment: 'Identifiant géographique normalisé (CC-PPP-ZZ-JJ-NN)'
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Nom lisible du lieu (ex: Local de Cannes)'
      },
      address: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Adresse physique complète'
      },
      latitude: {
        type: Sequelize.DECIMAL(10, 8),
        allowNull: true,
        comment: 'Coordonnées GPS latitude'
      },
      longitude: {
        type: Sequelize.DECIMAL(11, 8),
        allowNull: true,
        comment: 'Coordonnées GPS longitude'
      },
      timezone: {
        type: Sequelize.STRING(50),
        allowNull: false,
        defaultValue: 'UTC',
        comment: 'Fuseau horaire local (ex: Europe/Paris)'
      },
      continent_code: {
        type: Sequelize.CHAR(2),
        allowNull: false,
        comment: 'Code continent (01=Asie/Océanie, 02=Europe, 03=Afrique, 04=Am.Nord, 05=Am.Sud, 06=Russie)'
      },
      country_code: {
        type: Sequelize.STRING(3),
        allowNull: false,
        comment: 'Code pays (préfixe téléphonique, ex: 33 pour France)'
      },
      region_code: {
        type: Sequelize.CHAR(2),
        allowNull: false,
        comment: 'Code région/zone administrative'
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive', 'maintenance'),
        allowNull: false,
        defaultValue: 'active',
        comment: 'Statut du local'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Index pour recherche par continent
    await queryInterface.addIndex('locations', ['continent_code'], {
      name: 'idx_locations_continent'
    });

    // Index pour recherche par pays
    await queryInterface.addIndex('locations', ['country_code'], {
      name: 'idx_locations_country'
    });

    // Index pour filtrer par statut
    await queryInterface.addIndex('locations', ['status'], {
      name: 'idx_locations_status'
    });

    // Contrainte de validation du format geo_id
    await queryInterface.sequelize.query(`
      ALTER TABLE locations 
      ADD CONSTRAINT chk_geo_id_format 
      CHECK (geo_id ~ '^[0-9]{2}-[0-9]{1,3}-[0-9]{2}-[0-9]{2}-[0-9]{2}$')
    `);

    // Contrainte de validation du code continent
    await queryInterface.sequelize.query(`
      ALTER TABLE locations 
      ADD CONSTRAINT chk_continent_code 
      CHECK (continent_code IN ('01','02','03','04','05','06'))
    `);

    console.log('✅ Migration 001: Table locations créée avec succès');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('locations');
    console.log('⬇️ Migration 001: Table locations supprimée');
  }
};
