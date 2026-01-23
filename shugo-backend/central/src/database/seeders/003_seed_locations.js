'use strict';

/**
 * Seeder 003 - Localisations de base
 * 
 * Crée les localisations initiales pour le développement et les tests.
 * Format geo_id: CC-PPP-ZZ-JJ-NN (Continent-Pays-Région-LocalPère-SousLocal)
 * 
 * @see Document Technique V7.0 - Section 2.4
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();

    const locations = [
      // === FRANCE (02-33) ===
      // Région Île-de-France (01)
      {
        geo_id: '02-33-01-01-00',
        name: 'Local de Paris',
        address: 'Paris, France',
        latitude: 48.8566,
        longitude: 2.3522,
        timezone: 'Europe/Paris',
        continent_code: '02',
        country_code: '33',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      },
      
      // Région Sud-Est (06) - Alpes-Maritimes
      {
        geo_id: '02-33-06-01-00',
        name: 'Local de Nice',
        address: 'Nice, France',
        latitude: 43.7102,
        longitude: 7.2620,
        timezone: 'Europe/Paris',
        continent_code: '02',
        country_code: '33',
        region_code: '06',
        status: 'active',
        created_at: now,
        updated_at: now
      },
      {
        geo_id: '02-33-06-01-01',
        name: 'Local de Cannes',
        address: 'Cannes, France',
        latitude: 43.5528,
        longitude: 7.0174,
        timezone: 'Europe/Paris',
        continent_code: '02',
        country_code: '33',
        region_code: '06',
        status: 'active',
        created_at: now,
        updated_at: now
      },
      {
        geo_id: '02-33-06-01-02',
        name: 'Local d\'Antibes',
        address: 'Antibes, France',
        latitude: 43.5808,
        longitude: 7.1283,
        timezone: 'Europe/Paris',
        continent_code: '02',
        country_code: '33',
        region_code: '06',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // Région Sud-Ouest (05) - Toulouse
      {
        geo_id: '02-33-05-01-00',
        name: 'Local de Toulouse',
        address: 'Toulouse, France',
        latitude: 43.6047,
        longitude: 1.4442,
        timezone: 'Europe/Paris',
        continent_code: '02',
        country_code: '33',
        region_code: '05',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // === AUTRES PAYS EUROPÉENS ===
      // Italie (02-39)
      {
        geo_id: '02-39-01-01-00',
        name: 'Local de Rome',
        address: 'Rome, Italie',
        latitude: 41.9028,
        longitude: 12.4964,
        timezone: 'Europe/Rome',
        continent_code: '02',
        country_code: '39',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // Espagne (02-34)
      {
        geo_id: '02-34-01-01-00',
        name: 'Local de Madrid',
        address: 'Madrid, Espagne',
        latitude: 40.4168,
        longitude: -3.7038,
        timezone: 'Europe/Madrid',
        continent_code: '02',
        country_code: '34',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // Portugal (02-351)
      {
        geo_id: '02-351-01-01-00',
        name: 'Local de Lisbonne',
        address: 'Lisbonne, Portugal',
        latitude: 38.7223,
        longitude: -9.1393,
        timezone: 'Europe/Lisbon',
        continent_code: '02',
        country_code: '351',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // === ASIE & OCÉANIE (01) ===
      // Japon (01-81)
      {
        geo_id: '01-81-01-01-00',
        name: 'Local de Tokyo',
        address: 'Tokyo, Japon',
        latitude: 35.6762,
        longitude: 139.6503,
        timezone: 'Asia/Tokyo',
        continent_code: '01',
        country_code: '81',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // === AMÉRIQUE DU NORD (04) ===
      // États-Unis (04-1)
      {
        geo_id: '04-1-01-01-00',
        name: 'Local de New York',
        address: 'New York, USA',
        latitude: 40.7128,
        longitude: -74.0060,
        timezone: 'America/New_York',
        continent_code: '04',
        country_code: '1',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // Canada (04-1) - code région différent
      {
        geo_id: '04-1-02-01-00',
        name: 'Local de Montréal',
        address: 'Montréal, Canada',
        latitude: 45.5017,
        longitude: -73.5673,
        timezone: 'America/Montreal',
        continent_code: '04',
        country_code: '1',
        region_code: '02',
        status: 'active',
        created_at: now,
        updated_at: now
      },

      // === AMÉRIQUE DU SUD (05) ===
      // Brésil (05-55)
      {
        geo_id: '05-55-01-01-00',
        name: 'Local de São Paulo',
        address: 'São Paulo, Brésil',
        latitude: -23.5505,
        longitude: -46.6333,
        timezone: 'America/Sao_Paulo',
        continent_code: '05',
        country_code: '55',
        region_code: '01',
        status: 'active',
        created_at: now,
        updated_at: now
      }
    ];

    await queryInterface.bulkInsert('locations', locations);
    console.log(`✅ Seeder 003: ${locations.length} localisations insérées`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('locations', null, {});
    console.log('⬇️ Seeder 003: Localisations supprimées');
  }
};
