/**
 * SHUGO v7.0 - Guard Scenarios Seeder
 *
 * Creates default guard scenarios with 30-minute slots
 * Based on document specifications:
 * - Day slots: 30-minute blocks from 08:00 to 20:00
 * - Night guard: Single block from 20:00 to 08:00
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

// Generate 30-minute day slots from 08:00 to 20:00
function generateDaySlots() {
    const slots = [];
    const startHour = 8; // 08:00
    const endHour = 20;  // 20:00

    for (let hour = startHour; hour < endHour; hour++) {
        // First 30-minute slot
        slots.push({
            slot_index: slots.length,
            start_time: `${hour.toString().padStart(2, '0')}:00:00`,
            end_time: `${hour.toString().padStart(2, '0')}:30:00`,
            guard_type: 'standard',
            duration_minutes: 30,
            max_participants: 2,
            min_participants: 1,
            enabled: true,
            is_night: false
        });

        // Second 30-minute slot
        slots.push({
            slot_index: slots.length,
            start_time: `${hour.toString().padStart(2, '0')}:30:00`,
            end_time: `${(hour + 1).toString().padStart(2, '0')}:00:00`,
            guard_type: 'standard',
            duration_minutes: 30,
            max_participants: 2,
            min_participants: 1,
            enabled: true,
            is_night: false
        });
    }

    return slots;
}

// Night guard slot (20:00 to 08:00 - single block)
function generateNightSlot() {
    return {
        slot_index: 99,
        start_time: '20:00:00',
        end_time: '08:00:00', // Next day
        guard_type: 'special',
        duration_minutes: 720, // 12 hours
        max_participants: 2,
        min_participants: 1,
        enabled: true,
        is_night: true,
        description: 'Garde de nuit'
    };
}

// Default scenario template data
const DEFAULT_TEMPLATE_DATA = {
    slot_duration: 30,
    day_start: '08:00',
    day_end: '20:00',
    night_start: '20:00',
    night_end: '08:00',
    slots: generateDaySlots(),
    night_slot: generateNightSlot(),
    // By day of week (0 = Sunday, 1 = Monday, etc.)
    weekday_config: {
        0: { enabled: true, label: 'Dimanche' },  // Sunday
        1: { enabled: true, label: 'Lundi' },     // Monday
        2: { enabled: true, label: 'Mardi' },     // Tuesday
        3: { enabled: true, label: 'Mercredi' },  // Wednesday
        4: { enabled: true, label: 'Jeudi' },     // Thursday
        5: { enabled: true, label: 'Vendredi' },  // Friday
        6: { enabled: true, label: 'Samedi' }     // Saturday
    }
};

// Locations from the system
const LOCATIONS = [
    { geo_id: '02-033-04-01-00', name: 'Nice' },
    { geo_id: '02-033-04-01-01', name: 'Cannes' },
    { geo_id: '02-033-04-01-02', name: 'Saint Raphael' }
];

/**
 * Seed default guard scenarios for all locations
 */
async function seedGuardScenarios(sequelize) {
    const { GuardScenario } = sequelize.models;

    console.log('[Seeder] Creating default guard scenarios...');

    const scenarios = [];

    for (const location of LOCATIONS) {
        // Generate unique code for this location
        const locationCode = `NORMAL_${location.geo_id.replace(/-/g, '_')}`;

        // Check if scenario already exists for this location
        const existing = await GuardScenario.findOne({
            where: {
                geo_id: location.geo_id,
                code: locationCode
            }
        });

        if (existing) {
            console.log(`[Seeder] Scenario already exists for ${location.name}, skipping...`);
            continue;
        }

        // Create default NORMAL scenario
        const normalScenario = await GuardScenario.create({
            scenario_id: uuidv4(),
            name: `Planning Standard - ${location.name}`,
            description: `Scénario de garde standard avec créneaux de 30 minutes pour ${location.name}`,
            geo_id: location.geo_id,
            scenario_type: 'daily',
            code: locationCode,
            cancellation_window_hours: 72,
            template_data: DEFAULT_TEMPLATE_DATA,
            is_default: true,
            is_active: true
        });

        scenarios.push(normalScenario);
        console.log(`[Seeder] Created NORMAL scenario for ${location.name}`);
    }

    console.log(`[Seeder] Created ${scenarios.length} guard scenarios`);
    return scenarios;
}

/**
 * Run seeder if executed directly
 */
async function main() {
    const { sequelize, loadModels } = require('../database/connection');

    try {
        loadModels();
        await sequelize.authenticate();
        console.log('Database connected');

        await seedGuardScenarios(sequelize);

        console.log('Seeding completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

// Export for use in other scripts
module.exports = {
    seedGuardScenarios,
    generateDaySlots,
    generateNightSlot,
    DEFAULT_TEMPLATE_DATA,
    LOCATIONS
};

// Run if called directly
if (require.main === module) {
    main();
}
