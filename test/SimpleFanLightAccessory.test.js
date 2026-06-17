'use strict';

const SimpleFanLightAccessory = require('../lib/SimpleFanLightAccessory');
const { makeInstance } = require('./support/mocks');

// Mirror the state that _registerCharacteristics would establish (the mock
// service shares a single characteristic, so wiring the fields manually keeps
// the assertions focused on the write path).
function makeFanLight(state = {}, context = {}) {
    const result = makeInstance(SimpleFanLightAccessory, state, { type: 'FanLight', ...context });
    const { instance, device } = result;

    instance.dpFanOn = '60';
    instance.dpRotationSpeed = '62';
    instance.dpFanDirection = '63';
    instance.maxSpeed = parseInt(device.context.maxSpeed) || 6;
    instance.fanDefaultSpeed = parseInt(device.context.fanDefaultSpeed) || 1;
    instance.fanCurrentSpeed = 0;
    instance.useStrings = instance._coerceBoolean(device.context.useStrings, true);
    instance.singleDpWrites = instance._coerceBoolean(device.context.singleDpWrites, false);

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
