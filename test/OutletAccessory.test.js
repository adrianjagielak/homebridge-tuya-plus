'use strict';

const OutletAccessory = require('../lib/OutletAccessory');
const { makeInstance } = require('./support/mocks');

describe('OutletAccessory — energy characteristics', () => {
    test('are read from the platform, since api.hap is read-only on Homebridge 2.5', () => {
        const { instance, platform, accessory } = makeInstance(OutletAccessory, {'1': true, '2': 2300}, {voltsId: '2'});
        const Volts = jest.fn();
        platform.EnergyCharacteristics = {Volts, Amperes: jest.fn(), Watts: jest.fn()};
        instance._removeCharacteristic = jest.fn();

        instance._registerCharacteristics({'1': true, '2': 2300});

        expect(accessory._mockService.getCharacteristic).toHaveBeenCalledWith(Volts);
        expect(instance._removeCharacteristic).toHaveBeenCalledWith(accessory._mockService, platform.EnergyCharacteristics.Amperes);
        expect(instance._removeCharacteristic).toHaveBeenCalledWith(accessory._mockService, platform.EnergyCharacteristics.Watts);
    });
});
