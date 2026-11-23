'use strict';

const WledDimmerAccessory = require('../lib/WledDimmerAccessory');
const { makeInstance } = require('./support/mocks');

function makeDimmer(state = {}, context = {}) {
    const result = makeInstance(WledDimmerAccessory, state, { type: 'WledDimmer', ...context });
    result.instance._registerCharacteristics(state);
    return result;
}

function changeHandler(device) {
    const call = device.on.mock.calls.find(args => args[0] === 'change');
    if (!call) throw new Error('no change listener registered');
    return call[1];
}

describe('WledDimmerAccessory ignoreBrightness', () => {
    test('does not read or write the Tuya brightness DP when syncing to WLED', () => {
        const { instance, device } = makeDimmer(
            { '1': true, '2': 50 },
            { syncBrightnessToWled: '192.168.1.50', ignoreBrightness: true }
        );
        const schedule = jest.spyOn(instance, '_scheduleWledBrightness').mockImplementation(() => {});

        expect(device.update).not.toHaveBeenCalled();
        expect(instance.getBrightness()).toBe(50);

        device.update.mockClear();
        instance.setBrightness(40);

        expect(instance.getBrightness()).toBe(40);
        expect(schedule).toHaveBeenCalledWith(102, 'HomeKit setBrightness');
        expect(device.update).not.toHaveBeenCalled();

        changeHandler(device)({ '2': 10 });
        expect(schedule).toHaveBeenCalledTimes(1);
        expect(device.update).not.toHaveBeenCalled();
    });

    test('accepts ignoreBrightness as the string "true"', () => {
        const { device } = makeDimmer(
            { '1': true, '2': 50 },
            { syncBrightnessToWled: '192.168.1.50', ignoreBrightness: 'true' }
        );
        expect(device.update).not.toHaveBeenCalled();
    });

    test('still forces the Tuya brightness DP to max when the option is off', () => {
        const { instance, device } = makeDimmer(
            { '1': true, '2': 50 },
            { syncBrightnessToWled: '192.168.1.50' }
        );
        const max = instance.convertBrightnessFromHomeKitToTuya(100);

        expect(device.update).toHaveBeenCalledWith({ '2': max });

        const schedule = jest.spyOn(instance, '_scheduleWledBrightness').mockImplementation(() => {});
        device.update.mockClear();
        device.state['2'] = 50;
        instance.setBrightness(40);

        expect(schedule).toHaveBeenCalledWith(102, 'HomeKit setBrightness');
        expect(device.update).toHaveBeenCalledWith({ '2': max });
    });

    test('a brightness DP change is mirrored to WLED only when the option is off', () => {
        const { instance, device } = makeDimmer(
            { '1': true, '2': 255 },
            { syncBrightnessToWled: '192.168.1.50', ignoreBrightness: false }
        );
        const schedule = jest.spyOn(instance, '_scheduleWledBrightness').mockImplementation(() => {});

        changeHandler(device)({ '2': 100 });
        expect(schedule).toHaveBeenCalled();
    });

    test('without WLED sync, ignoreBrightness keeps brightness local and warns once', () => {
        const { instance, device, platform } = makeDimmer(
            { '1': true, '2': 50 },
            { ignoreBrightness: true }
        );

        expect(device.update).not.toHaveBeenCalled();
        expect(platform.log.warn).toHaveBeenCalled();
        expect(instance.getBrightness()).toBe(100);

        instance.setBrightness(30);
        expect(instance.getBrightness()).toBe(30);
        expect(device.update).not.toHaveBeenCalled();

        changeHandler(device)({ '2': 10 });
        expect(instance.getBrightness()).toBe(30);
        expect(device.update).not.toHaveBeenCalled();
    });
});
