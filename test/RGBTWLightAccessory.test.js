'use strict';

const RGBTWLightAccessory = require('../lib/RGBTWLightAccessory');
const { makeInstance, makeMockCharacteristic } = require('./support/mocks');

function makeLight(state = {}, context = {}) {
    const result = makeInstance(RGBTWLightAccessory, state, { colorFunction: 'HEXHSB', ...context });
    const { instance, device } = result;

    // Set up the state that _registerCharacteristics would normally establish
    instance.dpPower = '1';
    instance.dpMode  = '2';
    instance.dpBrightness = '3';
    instance.dpColorTemperature = '4';
    instance.dpColor = '5';
    instance.cmdWhite = 'white';
    instance.cmdColor = 'colour';
    instance.colorFunction = 'HEXHSB';
    instance.minWhiteColor = device.context.minWhiteColor ?? 140;
    instance.maxWhiteColor = device.context.maxWhiteColor ?? 400;

    // Provide the cross-characteristic references _setHueSaturation writes to
    instance.characteristicColorTemperature = makeMockCharacteristic(0);

    return result;
}

// ---------------------------------------------------------------------------
// getBrightness
// ---------------------------------------------------------------------------
describe('RGBTWLightAccessory.getBrightness', () => {
    test('returns converted brightness when in white mode', () => {
        const { instance } = makeLight({ '2': 'white', '3': 255 });
        // convertBrightnessFromTuyaToHomeKit(255) == 100
        expect(instance.getBrightness()).toBe(100);
    });

    test('returns color brightness when in color mode', () => {
        const { instance } = makeLight({ '2': 'colour', '5': '00000000b46464' });
        // b byte = 0x64 = 100 → Math.round(100/2.55) = 39
        expect(instance.getBrightness()).toBe(39);
    });
});

// ---------------------------------------------------------------------------
// setBrightness
// ---------------------------------------------------------------------------
describe('RGBTWLightAccessory.setBrightness', () => {
    test('sets dpBrightness when in white mode', () => {
        const { instance, device } = makeLight({ '2': 'white', '3': 27 });
        instance.setBrightness(100);
        expect(device.update).toHaveBeenCalledWith({ '3': 255 });
    });

    test('sets dpColor when in color mode', () => {
        const { instance, device } = makeLight({ '2': 'colour', '5': '00000000b46464' });
        instance.setBrightness(50);
        expect(device.update).toHaveBeenCalled();
        const call = device.update.mock.calls[0][0];
        expect(call).toHaveProperty('5');
    });
});

// ---------------------------------------------------------------------------
// getColorTemperature
// ---------------------------------------------------------------------------
describe('RGBTWLightAccessory.getColorTemperature', () => {
    test('returns minWhiteColor when in color mode', () => {
        const { instance } = makeLight({ '2': 'colour' }, { minWhiteColor: 140 });
        expect(instance.getColorTemperature()).toBe(140);
    });

    test('returns converted color temperature when in white mode', () => {
        const { instance } = makeLight({ '2': 'white', '4': 255 });
        // convertColorTemperatureFromTuyaToHomeKit(255) = 140
        expect(instance.getColorTemperature()).toBe(140);
    });

    test('returns a finite default when minWhiteColor is not configured (issue #34)', () => {
        const { instance } = makeLight({ '2': 'colour' });
        const result = instance.getColorTemperature();
        expect(typeof result).toBe('number');
        expect(Number.isFinite(result)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// setColorTemperature
// ---------------------------------------------------------------------------
describe('RGBTWLightAccessory.setColorTemperature', () => {
    test('does not throw when device is not connected (issue #34)', () => {
        const { instance, device } = makeLight({ '2': 'white', '4': 255 });
        instance.characteristicHue = makeMockCharacteristic(0);
        instance.characteristicSaturation = makeMockCharacteristic(0);
        device.connected = false;
        expect(() => instance.setColorTemperature(200)).not.toThrow();
        expect(device.update).not.toHaveBeenCalled();
    });

    test('writes color temperature when device is connected', () => {
        const { instance, device } = makeLight({ '2': 'white', '4': 255 });
        instance.characteristicHue = makeMockCharacteristic(0);
        instance.characteristicSaturation = makeMockCharacteristic(0);
        instance.setColorTemperature(200);
        expect(device.update).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// _setHueSaturation — debounce/Promise pattern
// ---------------------------------------------------------------------------
describe('RGBTWLightAccessory._setHueSaturation', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('does not call device.update before timer fires', () => {
        const { instance, device } = makeLight({ '2': 'colour', '5': '00000000b46464' });
        instance.setHue(120);
        expect(device.update).not.toHaveBeenCalled();
    });

    test('batches hue + saturation into a single device call for dpColor', async () => {
        // Already in colour mode — mode DP is optimized out (matches current state)
        const { instance, device } = makeLight({ '2': 'colour', '5': '00000000b46464' });
        const ph = instance.setHue(120);
        const ps = instance.setSaturation(80);
        jest.advanceTimersByTime(500);
        await Promise.all([ph, ps]);
        const calls = device.update.mock.calls.map(c => c[0]);
        expect(calls.some(c => c['5'] !== undefined)).toBe(true);
        // Should be one batch, not two separate calls per property
        expect(device.update).toHaveBeenCalledTimes(1);
    });

    test('sends mode update when switching from white to colour', async () => {
        const { instance, device } = makeLight({ '2': 'white', '3': 255 });
        const p = instance.setHue(120);
        jest.advanceTimersByTime(500);
        await p;
        const calls = device.update.mock.calls.map(c => c[0]);
        expect(calls.some(c => c['2'] === 'colour')).toBe(true);
        expect(calls.some(c => c['5'] !== undefined)).toBe(true);
    });

    test('resolves both Promises when the timer fires', async () => {
        const { instance } = makeLight({ '2': 'colour', '5': '00000000b46464' });
        let hResolved = false, sResolved = false;
        const ph = instance.setHue(120).then(() => { hResolved = true; });
        const ps = instance.setSaturation(80).then(() => { sResolved = true; });
        jest.advanceTimersByTime(500);
        await Promise.all([ph, ps]);
        expect(hResolved).toBe(true);
        expect(sResolved).toBe(true);
    });

    test('a sham (h=0, s=0) in white mode does not call device.update', async () => {
        const { instance, device } = makeLight({ '2': 'white', '3': 255 });
        const ph = instance.setHue(0);
        const ps = instance.setSaturation(0);
        jest.advanceTimersByTime(500);
        await Promise.all([ph, ps]);
        expect(device.update).not.toHaveBeenCalled();
    });

    test('updates characteristicColorTemperature to minWhiteColor after firing', async () => {
        const { instance } = makeLight({ '2': 'colour', '5': '00000000b46464' }, { minWhiteColor: 140 });
        const p = instance.setHue(180);
        jest.advanceTimersByTime(500);
        await p;
        expect(instance.characteristicColorTemperature.updateValue).toHaveBeenCalledWith(140);
    });

    test('updates characteristicColorTemperature to a finite default when minWhiteColor unset (issue #34)', async () => {
        const { instance } = makeLight({ '2': 'colour', '5': '00000000b46464' });
        const p = instance.setHue(180);
        jest.advanceTimersByTime(500);
        await p;
        const calls = instance.characteristicColorTemperature.updateValue.mock.calls;
        const lastValue = calls[calls.length - 1][0];
        expect(typeof lastValue).toBe('number');
        expect(Number.isFinite(lastValue)).toBe(true);
    });
});
