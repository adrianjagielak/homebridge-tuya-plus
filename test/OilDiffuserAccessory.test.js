'use strict';

const OilDiffuserAccessory = require('../lib/OilDiffuserAccessory');
const { makeInstance, HAP } = require('./support/mocks');

// The dp/command fields are normally established by _registerCharacteristics,
// which only runs once the device reports its first state.
function makeDiffuser(state = {}, context = {}) {
    const result = makeInstance(OilDiffuserAccessory, state, { colorFunction: 'HEXHSB', ...context });
    const { instance, device } = result;

    instance.dpLight = '5';
    instance.dpMode = '6';
    instance.dpColor = '8';
    instance.dpColorTemperature = instance._getCustomDP(device.context.dpColorTemperature);
    instance.cmdWhite = 'white';
    instance.cmdColor = 'colour';
    instance.colorFunction = 'HEXHSB';

    return result;
}

// ---------------------------------------------------------------------------
// getColorTemperature
// ---------------------------------------------------------------------------
describe('OilDiffuserAccessory.getColorTemperature', () => {
    // These diffusers have no colour-temperature dp; reading the undefined one
    // returned NaN, which HomeKit rejects with a characteristic warning.
    test('returns the neutral value in white mode when no dp is configured', () => {
        const { instance } = makeDiffuser({ '6': 'white' });
        expect(instance.getColorTemperature()).toBe(0);
    });

    test('returns the neutral value in color mode', () => {
        const { instance } = makeDiffuser({ '6': 'colour' });
        expect(instance.getColorTemperature()).toBe(0);
    });

    test('reads the configured dp in white mode', () => {
        const { instance } = makeDiffuser({ '6': 'white', '4': 255 }, { dpColorTemperature: 4 });
        // convertColorTemperatureFromTuyaToHomeKit(255) == 140
        expect(instance.getColorTemperature()).toBe(140);
    });

    test('rejects (No Response) when the device is not connected', () => {
        const { instance, device } = makeDiffuser({ '6': 'white' });
        device.connected = false;
        expect(() => instance.getColorTemperature()).toThrow(HAP.HapStatusError);
    });
});
