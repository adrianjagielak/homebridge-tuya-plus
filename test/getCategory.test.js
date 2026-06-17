'use strict';

const { HAP } = require('./support/mocks');
const { Categories } = HAP;

// Mirror of index.js CLASS_DEF. Every configurable device type must resolve to
// a real HAP category: getCategory() returning undefined makes HomeKit store
// the accessory as Categories.OTHER, so the cached category never matches the
// expectation again and the accessory is unregistered & recreated on every
// Homebridge restart — wiping its name, room and automations (issue #45).
const CLASS_DEF = {
    outlet: require('../lib/OutletAccessory'),
    simplelight: require('../lib/SimpleLightAccessory'),
    rgbtwlight: require('../lib/RGBTWLightAccessory'),
    rgbtwoutlet: require('../lib/RGBTWOutletAccessory'),
    twlight: require('../lib/TWLightAccessory'),
    multioutlet: require('../lib/MultiOutletAccessory'),
    custommultioutlet: require('../lib/CustomMultiOutletAccessory'),
    airconditioner: require('../lib/AirConditionerAccessory'),
    airpurifier: require('../lib/AirPurifierAccessory'),
    dehumidifier: require('../lib/DehumidifierAccessory'),
    convector: require('../lib/ConvectorAccessory'),
    garagedoor: require('../lib/GarageDoorAccessory'),
    simplegaragedoor: require('../lib/SimpleGarageDoorAccessory'),
    simpledimmer: require('../lib/SimpleDimmerAccessory'),
    simpledimmer2: require('../lib/SimpleDimmer2Accessory'),
    simpleblinds: require('../lib/SimpleBlindsAccessory'),
    simpleheater: require('../lib/SimpleHeaterAccessory'),
    switch: require('../lib/SwitchAccessory'),
    fan: require('../lib/SimpleFanAccessory'),
    fanlight: require('../lib/SimpleFanLightAccessory'),
    watervalve: require('../lib/ValveAccessory'),
    oildiffuser: require('../lib/OilDiffuserAccessory'),
    doorbell: require('../lib/DoorbellAccessory'),
    verticalblindswithtilt: require('../lib/VerticalBlindsWithTilt'),
    percentblinds: require('../lib/PercentBlindsAccessory'),
};

const validCategoryValues = new Set(Object.values(Categories));

describe('getCategory()', () => {
    test.each(Object.entries(CLASS_DEF))('%s resolves to a real HAP category', (type, AccessoryClass) => {
        expect(typeof AccessoryClass.getCategory).toBe('function');

        const category = AccessoryClass.getCategory(Categories);

        // Must be a defined, numeric category — not undefined (the issue #45 bug).
        expect(category).toBeDefined();
        expect(typeof category).toBe('number');
        // ...and an actual member of the HAP Categories enum.
        expect(validCategoryValues.has(category)).toBe(true);
    });

    test('the specific types reported in issue #45 are fixed', () => {
        expect(CLASS_DEF.fanlight.getCategory(Categories)).toBe(Categories.FAN);
        expect(CLASS_DEF.dehumidifier.getCategory(Categories)).toBe(Categories.AIR_DEHUMIDIFIER);
        expect(CLASS_DEF.oildiffuser.getCategory(Categories)).toBe(Categories.AIR_DEHUMIDIFIER);
    });

    test('BaseAccessory falls back to OTHER for a missing override', () => {
        const BaseAccessory = require('../lib/BaseAccessory');
        expect(BaseAccessory.getCategory(Categories)).toBe(Categories.OTHER);
    });
});
