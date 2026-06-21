'use strict';

const SimpleFanLightAccessory = require('../lib/SimpleFanLightAccessory');
const { makeInstance, HAP } = require('./support/mocks');

// Mirror the state that _registerCharacteristics would establish (the mock
// service shares a single characteristic, so wiring the fields manually keeps
// the assertions focused on the write path and the conversion helpers).
// minWhiteColor/maxWhiteColor are only copied onto the instance when the config
// provides them, so omitting them exercises the in-method default fallback.
function makeFanLight(state = {}, context = {}) {
    const result = makeInstance(SimpleFanLightAccessory, state, { type: 'FanLight', ...context });
    const { instance, device } = result;

    instance.dpFanOn = '60';
    instance.dpRotationSpeed = '62';
    instance.dpFanDirection = '63';
    instance.dpColorTemp = '23';
    instance.maxSpeed = parseInt(device.context.maxSpeed) || 6;
    instance.fanDefaultSpeed = parseInt(device.context.fanDefaultSpeed) || 1;
    instance.fanCurrentSpeed = 0;
    instance.useStrings = instance._coerceBoolean(device.context.useStrings, true);
    instance.singleDpWrites = instance._coerceBoolean(device.context.singleDpWrites, false);
    if (device.context.minWhiteColor !== undefined) instance.minWhiteColor = parseInt(device.context.minWhiteColor);
    if (device.context.maxWhiteColor !== undefined) instance.maxWhiteColor = parseInt(device.context.maxWhiteColor);

    return result;
}

const payloads = device => device.update.mock.calls.map(c => c[0]);

// ---------------------------------------------------------------------------
// Default behaviour: fan power + speed go out together in one legacy packet.
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory — combined writes (default)', () => {
    test('setFanOn(true) sends fan power and speed in a single packet', () => {
        const { instance, device } = makeFanLight({ '60': false, '62': '1' });

        instance.setFanOn(true);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '60': true, '62': '1' });
    });

    test('setSpeed sends fan power and speed in a single packet', () => {
        const { instance, device } = makeFanLight({ '60': false, '62': '1' });

        instance.setSpeed(100); // maxSpeed 6 -> tuya 6

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '60': true, '62': '6' });
    });

    test('setSpeed(0) sends fan off and the reset speed in a single packet', () => {
        const { instance, device } = makeFanLight({ '60': true, '62': '5' });

        instance.setSpeed(0);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '60': false, '62': '1' });
    });
});

// ---------------------------------------------------------------------------
// singleDpWrites: each DP goes out as its own packet (issue #43 — some `fsd`
// fan firmwares silently ignore any LAN packet carrying more than one DP).
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory — singleDpWrites (per-DP packets)', () => {
    test('every write carries at most one DP', () => {
        const { instance, device } = makeFanLight(
            { '60': false, '62': '1' },
            { singleDpWrites: true }
        );

        instance.setSpeed(100);

        for (const p of payloads(device)) {
            expect(Object.keys(p).length).toBe(1);
        }
    });

    test('setFanOn(true) emits the fan-power DP on its own (the packet that was ignored)', () => {
        // Fan is off at its default speed, so turning it on only needs DP 60 —
        // and it must go out alone, not bundled with the speed DP.
        const { instance, device } = makeFanLight(
            { '60': false, '62': '1' },
            { singleDpWrites: true }
        );

        instance.setFanOn(true);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '60': true });
    });

    test('setFanOn(true) splits power and speed into two packets when both change', () => {
        const { instance, device } = makeFanLight(
            { '60': false, '62': '1' },
            { singleDpWrites: true, fanDefaultSpeed: 3 }
        );

        instance.setFanOn(true);

        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenCalledWith({ '60': true });
        expect(device.update).toHaveBeenCalledWith({ '62': '3' });
    });

    test('setSpeed splits power and speed into two packets', () => {
        const { instance, device } = makeFanLight(
            { '60': false, '62': '1' },
            { singleDpWrites: true }
        );

        instance.setSpeed(100); // tuya 6, differs from current '1'

        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenCalledWith({ '60': true });
        expect(device.update).toHaveBeenCalledWith({ '62': '6' });
    });

    test('setSpeed(0) splits fan off and the reset speed into two packets', () => {
        const { instance, device } = makeFanLight(
            { '60': true, '62': '5' },
            { singleDpWrites: true }
        );

        instance.setSpeed(0);

        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenCalledWith({ '60': false });
        expect(device.update).toHaveBeenCalledWith({ '62': '1' });
    });

    test('respects useStrings: false (numeric speed) in per-DP mode', () => {
        const { instance, device } = makeFanLight(
            { '60': false, '62': 1 },
            { singleDpWrites: true, useStrings: false }
        );

        instance.setSpeed(100); // tuya 6 as a number

        expect(device.update).toHaveBeenCalledWith({ '60': true });
        expect(device.update).toHaveBeenCalledWith({ '62': 6 });
    });
});

// ---------------------------------------------------------------------------
// Fan OFF always goes through a single-DP write, regardless of the flag — this
// is why "fan off works" was already true in the bug report.
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory — setFanOn(false)', () => {
    test.each([
        ['default', {}],
        ['singleDpWrites', { singleDpWrites: true }],
    ])('sends a lone fan-off packet (%s)', (_label, context) => {
        const { instance, device } = makeFanLight({ '60': true, '62': '3' }, context);

        instance.setFanOn(false);

        expect(instance.fanCurrentSpeed).toBe(0);
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '60': false });
    });
});

// ---------------------------------------------------------------------------
// convertColorTempFromTuyaToHomeKit — default range, inverted (issue #44)
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory.convertColorTempFromTuyaToHomeKit (default range)', () => {
    test('Tuya 0 (warmest) maps to the warm mired end (370)', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromTuyaToHomeKit(0)).toBe(370);
    });

    test('Tuya 1000 (coolest) maps to the cool mired end (154)', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromTuyaToHomeKit(1000)).toBe(154);
    });

    test('Tuya midpoint maps to the mired midpoint', () => {
        const { instance } = makeFanLight();
        // 370 - 500*(370-154)/1000 = 262
        expect(instance.convertColorTempFromTuyaToHomeKit(500)).toBe(262);
    });

    test('accepts Tuya values as strings', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromTuyaToHomeKit('0')).toBe(370);
        expect(instance.convertColorTempFromTuyaToHomeKit('1000')).toBe(154);
    });

    test('out-of-range / undefined Tuya values stay within bounds', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromTuyaToHomeKit(99999)).toBe(154);
        expect(instance.convertColorTempFromTuyaToHomeKit(-5)).toBe(370);
        const undef = instance.convertColorTempFromTuyaToHomeKit(undefined);
        expect(Number.isFinite(undef)).toBe(true);
        expect(undef).toBeGreaterThanOrEqual(154);
        expect(undef).toBeLessThanOrEqual(370);
    });
});

// ---------------------------------------------------------------------------
// convertColorTempFromHomeKitToTuya — default range, inverted (issue #44)
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory.convertColorTempFromHomeKitToTuya (default range)', () => {
    test('warm mired end (370) maps to Tuya 0 (warmest)', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromHomeKitToTuya(370)).toBe(0);
    });

    test('cool mired end (154) maps to Tuya 1000 (coolest)', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromHomeKitToTuya(154)).toBe(1000);
    });

    test("Apple's warm preset (~370 mired) lands warm, not neutral (issue #44 regression)", () => {
        const { instance } = makeFanLight();
        // The old code produced 313 for the warm preset; it must now be the warm extreme.
        expect(instance.convertColorTempFromHomeKitToTuya(370)).toBeLessThan(100);
    });

    test('cool input (low mired) produces a high Tuya value, warm input (high mired) a low one', () => {
        const { instance } = makeFanLight();
        const cool = instance.convertColorTempFromHomeKitToTuya(154);
        const warm = instance.convertColorTempFromHomeKitToTuya(370);
        expect(cool).toBeGreaterThan(warm);
    });

    test('values outside the configured range are clamped before mapping', () => {
        const { instance } = makeFanLight();
        expect(instance.convertColorTempFromHomeKitToTuya(500)).toBe(0);    // clamped to 370 -> warm
        expect(instance.convertColorTempFromHomeKitToTuya(140)).toBe(1000); // clamped to 154 -> cool
    });
});

// ---------------------------------------------------------------------------
// Configurable range via minWhiteColor / maxWhiteColor (issue #44)
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory color temperature with a configured range', () => {
    test('honours a custom 140..500 mired range', () => {
        const { instance } = makeFanLight({}, { minWhiteColor: 140, maxWhiteColor: 500 });
        expect(instance.convertColorTempFromHomeKitToTuya(500)).toBe(0);     // warm end
        expect(instance.convertColorTempFromHomeKitToTuya(140)).toBe(1000);  // cool end
        expect(instance.convertColorTempFromTuyaToHomeKit(0)).toBe(500);
        expect(instance.convertColorTempFromTuyaToHomeKit(1000)).toBe(140);
    });

    test('string config values are coerced to numbers', () => {
        const { instance } = makeFanLight({}, { minWhiteColor: '154', maxWhiteColor: '370' });
        expect(instance.convertColorTempFromHomeKitToTuya(370)).toBe(0);
        expect(instance.convertColorTempFromTuyaToHomeKit(1000)).toBe(154);
    });
});

// ---------------------------------------------------------------------------
// Round-trip stability
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory color temperature round-trips', () => {
    test('HomeKit -> Tuya -> HomeKit is stable across the default range', () => {
        const { instance } = makeFanLight();
        for (let hk = 154; hk <= 370; hk += 1) {
            const tuya = instance.convertColorTempFromHomeKitToTuya(hk);
            const back = instance.convertColorTempFromTuyaToHomeKit(tuya);
            // Allow ±1 mired for rounding through the 0..1000 integer scale.
            expect(Math.abs(back - hk)).toBeLessThanOrEqual(1);
        }
    });
});

// ---------------------------------------------------------------------------
// getColorTemp / setColorTemp integration
// ---------------------------------------------------------------------------
describe('SimpleFanLightAccessory.getColorTemp / setColorTemp', () => {
    test('getColorTemp reads and converts the Tuya DP', () => {
        const { instance } = makeFanLight({ '23': 0 });
        expect(instance.getColorTemp()).toBe(370); // Tuya 0 -> warm
    });

    test('setColorTemp writes the inverted, range-mapped Tuya value as a string', () => {
        const { instance, device } = makeFanLight({ '23': 500 });
        instance.setColorTemp(370); // warm preset -> Tuya 0
        expect(device.update).toHaveBeenCalledWith({ '23': '0' });
    });

    test('setColorTemp writes a numeric value when useStrings is false', () => {
        const { instance, device } = makeFanLight({ '23': 500 }, { useStrings: false });
        instance.setColorTemp(154); // cool end -> Tuya 1000
        expect(device.update).toHaveBeenCalledWith({ '23': 1000 });
    });

    test('setColorTemp rejects (No Response) and writes nothing when disconnected', async () => {
        const { instance, device } = makeFanLight({ '23': 500 });
        device.connected = false;
        await expect(instance.setColorTemp(370)).rejects.toBeInstanceOf(HAP.HapStatusError);
        expect(device.update).not.toHaveBeenCalled();
    });
});
