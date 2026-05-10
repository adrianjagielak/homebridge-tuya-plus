'use strict';

const BaseAccessory = require('../lib/BaseAccessory');
const { makeInstance } = require('./support/mocks');

// Minimal concrete subclass — BaseAccessory itself doesn't define _registerCharacteristics
class TestAccessory extends BaseAccessory {
    _registerCharacteristics() {}
}

function make(deviceState = {}, deviceContext = {}) {
    return makeInstance(TestAccessory, deviceState, deviceContext);
}

// ---------------------------------------------------------------------------
// Brightness conversion
// ---------------------------------------------------------------------------
describe('convertBrightnessFromTuyaToHomeKit', () => {
    test('maps scale value (255) to 100%', () => {
        const { instance } = make();
        expect(instance.convertBrightnessFromTuyaToHomeKit(255)).toBe(100);
    });

    test('maps minimum value (27) to ~1%', () => {
        const { instance } = make();
        expect(instance.convertBrightnessFromTuyaToHomeKit(27)).toBe(1);
    });

    test('round-trips with convertBrightnessFromHomeKitToTuya at boundaries', () => {
        const { instance } = make();
        for (const hk of [1, 25, 50, 75, 100]) {
            const tuya = instance.convertBrightnessFromHomeKitToTuya(hk);
            expect(instance.convertBrightnessFromTuyaToHomeKit(tuya)).toBe(hk);
        }
    });

    test('respects custom scaleBrightness from device context', () => {
        const { instance } = make({}, { scaleBrightness: 1000 });
        expect(instance.convertBrightnessFromTuyaToHomeKit(1000)).toBe(100);
    });
});

describe('convertBrightnessFromHomeKitToTuya', () => {
    test('maps 100% to scale (255)', () => {
        const { instance } = make();
        expect(instance.convertBrightnessFromHomeKitToTuya(100)).toBe(255);
    });

    test('maps 1% to minimum (27)', () => {
        const { instance } = make();
        expect(instance.convertBrightnessFromHomeKitToTuya(1)).toBe(27);
    });
});

// ---------------------------------------------------------------------------
// Color temperature conversion
// ---------------------------------------------------------------------------
describe('convertColorTemperatureFromTuyaToHomeKit', () => {
    test('maps scale (255) to min mireds (140)', () => {
        const { instance } = make();
        expect(instance.convertColorTemperatureFromTuyaToHomeKit(255)).toBe(140);
    });

    test('maps 0 to max mireds (400)', () => {
        const { instance } = make();
        expect(instance.convertColorTemperatureFromTuyaToHomeKit(0)).toBe(400);
    });

    test('clamps result to [71, 600]', () => {
        const { instance } = make();
        expect(instance.convertColorTemperatureFromTuyaToHomeKit(255)).toBeGreaterThanOrEqual(71);
        expect(instance.convertColorTemperatureFromTuyaToHomeKit(0)).toBeLessThanOrEqual(600);
    });

    test('round-trips with convertColorTemperatureFromHomeKitToTuya at boundaries', () => {
        const { instance } = make();
        for (const hk of [140, 200, 300, 400]) {
            const tuya = instance.convertColorTemperatureFromHomeKitToTuya(hk);
            expect(instance.convertColorTemperatureFromTuyaToHomeKit(tuya)).toBe(hk);
        }
    });
});

// ---------------------------------------------------------------------------
// HEXHSB color conversion
// ---------------------------------------------------------------------------
describe('convertColorFromTuyaToHomeKit (HEXHSB)', () => {
    test('parses a known HEXHSB value correctly', () => {
        const { instance } = make({}, { colorFunction: 'HEXHSB' });
        instance.colorFunction = 'HEXHSB';
        // Format: RRGGBB + HHHH + SS + BB
        // h=0x00b4=180, s=0x64=100→39%, b=0x64=100→39%
        const result = instance.convertColorFromTuyaToHomeKit('00000000b46464');
        expect(result.h).toBe(180);
        expect(result.s).toBe(Math.round(100 / 2.55)); // 39
        expect(result.b).toBe(Math.round(100 / 2.55)); // 39
    });

    test('handles null/undefined with a default value', () => {
        const { instance } = make({}, { colorFunction: 'HEXHSB' });
        instance.colorFunction = 'HEXHSB';
        const result = instance.convertColorFromTuyaToHomeKit(null);
        expect(result).toHaveProperty('h');
        expect(result).toHaveProperty('s');
        expect(result).toHaveProperty('b');
    });
});

describe('convertColorFromTuyaToHomeKit (HSB)', () => {
    test('parses a known HSB value correctly', () => {
        const { instance } = make({}, { colorFunction: 'HSB' });
        instance.colorFunction = 'HSB';
        // h=0x00b4=180, s=0x03e8=1000→100%, b=0x03e8=1000→100%
        const result = instance.convertColorFromTuyaToHomeKit('00b403e803e8');
        expect(result.h).toBe(180);
        expect(result.s).toBe(100); // 1000/10
        expect(result.b).toBe(100); // 1000/10
    });
});

// ---------------------------------------------------------------------------
// Color temperature → HomeKit color conversion
// ---------------------------------------------------------------------------
describe('convertHomeKitColorTemperatureToHomeKitColor', () => {
    test('returns an object with h, s, b properties', () => {
        const { instance } = make();
        const color = instance.convertHomeKitColorTemperatureToHomeKitColor(200);
        expect(color).toHaveProperty('h');
        expect(color).toHaveProperty('s');
        expect(color).toHaveProperty('b');
    });

    test('produces values within valid HomeKit ranges', () => {
        const { instance } = make();
        for (const ct of [140, 200, 300, 400, 500]) {
            const { h, s, b } = instance.convertHomeKitColorTemperatureToHomeKitColor(ct);
            expect(h).toBeGreaterThanOrEqual(0);
            expect(h).toBeLessThanOrEqual(360);
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(100);
            expect(b).toBeGreaterThanOrEqual(0);
            expect(b).toBeLessThanOrEqual(100);
        }
    });
});

// ---------------------------------------------------------------------------
// Async helpers
// ---------------------------------------------------------------------------
describe('getStateAsync', () => {
    test('returns a single DP value when connected', () => {
        const { instance } = make({ '1': true });
        expect(instance.getStateAsync('1')).toBe(true);
    });

    test('returns an object keyed by DP when passed an array', () => {
        const { instance } = make({ '1': true, '2': 50 });
        expect(instance.getStateAsync(['1', '2'])).toEqual({ '1': true, '2': 50 });
    });

    test('throws when device is not connected', () => {
        const { instance, device } = make();
        device.connected = false;
        expect(() => instance.getStateAsync('1')).toThrow('Not connected');
    });
});

describe('setStateAsync', () => {
    test('calls device.update with the correct DP and value', () => {
        const { instance, device } = make({ '1': false });
        instance.setStateAsync('1', true);
        expect(device.update).toHaveBeenCalledWith({ '1': true });
    });

    test('does not call device.update when value matches current state', () => {
        const { instance, device } = make({ '1': true });
        instance.setStateAsync('1', true);
        expect(device.update).not.toHaveBeenCalled();
    });

    test('skips silently when device is not connected (issue #34)', () => {
        const { instance, device } = make({ '1': false });
        device.connected = false;
        expect(() => instance.setStateAsync('1', true)).not.toThrow();
        expect(device.update).not.toHaveBeenCalled();
    });
});

describe('setMultiStateAsync', () => {
    test('calls device.update once per changed DP', () => {
        const { instance, device } = make({ '1': false, '2': 0 });
        instance.setMultiStateAsync({ '1': true, '2': 50 });
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenCalledWith({ '1': true });
        expect(device.update).toHaveBeenCalledWith({ '2': 50 });
    });

    test('skips DPs whose value has not changed', () => {
        const { instance, device } = make({ '1': true, '2': 50 });
        instance.setMultiStateAsync({ '1': true, '2': 50 });
        expect(device.update).not.toHaveBeenCalled();
    });

    test('skips silently when device is not connected (issue #34)', () => {
        const { instance, device } = make({ '1': false });
        device.connected = false;
        expect(() => instance.setMultiStateAsync({ '1': true, '2': 50 })).not.toThrow();
        expect(device.update).not.toHaveBeenCalled();
    });
});

describe('setMultiStateLegacyAsync', () => {
    test('calls device.update once with the full dps object', () => {
        const { instance, device } = make();
        instance.setMultiStateLegacyAsync({ '1': true, '3': '2' });
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '1': true, '3': '2' });
    });

    test('skips silently when device is not connected (issue #34)', () => {
        const { instance, device } = make();
        device.connected = false;
        expect(() => instance.setMultiStateLegacyAsync({ '1': true })).not.toThrow();
        expect(device.update).not.toHaveBeenCalled();
    });
});

describe('getDividedStateAsync', () => {
    test('returns state value divided by divisor', () => {
        const { instance } = make({ '5': 2200 });
        expect(instance.getDividedStateAsync('5', 10)).toBeCloseTo(220);
    });

    test('throws when state value is not finite', () => {
        const { instance } = make({ '5': 'bad' });
        expect(() => instance.getDividedStateAsync('5', 10)).toThrow();
    });
});

describe('setMultiState (legacy callback)', () => {
    test('skips silently and invokes callback without error when not connected (issue #34)', () => {
        const { instance, device } = make({ '1': false });
        device.connected = false;
        const cb = jest.fn();
        instance.setMultiState({ '1': true }, cb);
        expect(device.update).not.toHaveBeenCalled();
        expect(cb).toHaveBeenCalledWith();
    });

    test('tolerates a missing callback when not connected', () => {
        const { instance, device } = make({ '1': false });
        device.connected = false;
        expect(() => instance.setMultiState({ '1': true })).not.toThrow();
    });
});

describe('setMultiStateLegacy (legacy callback)', () => {
    test('skips silently and invokes callback without error when not connected (issue #34)', () => {
        const { instance, device } = make();
        device.connected = false;
        const cb = jest.fn();
        instance.setMultiStateLegacy({ '1': true }, cb);
        expect(device.update).not.toHaveBeenCalled();
        expect(cb).toHaveBeenCalledWith();
    });
});

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
describe('_getCustomDP', () => {
    test('returns string for valid positive integers', () => {
        const { instance } = make();
        expect(instance._getCustomDP(1)).toBe('1');
        expect(instance._getCustomDP('101')).toBe('101');
    });

    test('returns false for invalid values', () => {
        const { instance } = make();
        expect(instance._getCustomDP(0)).toBe(false);
        expect(instance._getCustomDP(-1)).toBe(false);
        expect(instance._getCustomDP('abc')).toBe(false);
        expect(instance._getCustomDP(undefined)).toBe(false);
    });
});

describe('_coerceBoolean', () => {
    test('passes through booleans', () => {
        const { instance } = make();
        expect(instance._coerceBoolean(true)).toBe(true);
        expect(instance._coerceBoolean(false)).toBe(false);
    });

    test('coerces strings', () => {
        const { instance } = make();
        expect(instance._coerceBoolean('true')).toBe(true);
        expect(instance._coerceBoolean('false')).toBe(false);
        expect(instance._coerceBoolean('TRUE')).toBe(true);
    });

    test('coerces numbers', () => {
        const { instance } = make();
        expect(instance._coerceBoolean(1)).toBe(true);
        expect(instance._coerceBoolean(0)).toBe(false);
    });

    test('falls back to defaultValue for unrecognised input', () => {
        const { instance } = make();
        expect(instance._coerceBoolean(null, true)).toBe(true);
        expect(instance._coerceBoolean(undefined, false)).toBe(false);
    });
});
