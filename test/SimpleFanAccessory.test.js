'use strict';

const SimpleFanAccessory = require('../lib/SimpleFanAccessory');
const { makeInstance, HAP } = require('./support/mocks');

const { SwingMode, RotationDirection } = HAP.Characteristic;

// The mock Fan service shares a single characteristic, so the write-path tests
// wire the DP fields manually (mirroring what _registerCharacteristics would do)
// and assert on the conversion helpers and the DP packets that go out. The
// registration tests below drive _registerCharacteristics itself.
function makeFan(state = {}, context = {}) {
    const result = makeInstance(SimpleFanAccessory, state, { type: 'Fan', ...context });
    const { instance } = result;

    instance.dpFanOn = '1';
    instance.dpRotationSpeed = '3';
    instance.dpFanDirection = '2';
    instance.dpSwing = instance._getCustomDP(context.dpSwing);
    instance.dpSwingVertical = instance._getCustomDP(context.dpSwingVertical);
    return result;
}

// ---------------------------------------------------------------------------
// _getSwingMode — boolean DP maps to HomeKit SwingMode
// ---------------------------------------------------------------------------
describe('SimpleFanAccessory._getSwingMode', () => {
    test('truthy DP enables swing', () => {
        const { instance } = makeFan();
        expect(instance._getSwingMode(true)).toBe(SwingMode.SWING_ENABLED);
        expect(instance._getSwingMode(1)).toBe(SwingMode.SWING_ENABLED);
    });

    test('falsy DP disables swing', () => {
        const { instance } = makeFan();
        expect(instance._getSwingMode(false)).toBe(SwingMode.SWING_DISABLED);
        expect(instance._getSwingMode(0)).toBe(SwingMode.SWING_DISABLED);
        expect(instance._getSwingMode(undefined)).toBe(SwingMode.SWING_DISABLED);
    });
});

// ---------------------------------------------------------------------------
// getSwingMode / setSwingMode — read and write the configured swing DP
// ---------------------------------------------------------------------------
describe('SimpleFanAccessory.getSwingMode / setSwingMode', () => {
    test('getSwingMode reads and converts the swing DP', () => {
        const { instance } = makeFan({ '4': true }, { dpSwing: 4 });
        expect(instance.getSwingMode()).toBe(SwingMode.SWING_ENABLED);
    });

    test('setSwingMode writes a boolean true to the swing DP', () => {
        const { instance, device } = makeFan({ '4': false }, { dpSwing: 4 });
        instance.setSwingMode(SwingMode.SWING_ENABLED);
        expect(device.update).toHaveBeenCalledWith({ '4': true });
    });

    test('setSwingMode writes a boolean false to the swing DP', () => {
        const { instance, device } = makeFan({ '4': true }, { dpSwing: 4 });
        instance.setSwingMode(SwingMode.SWING_DISABLED);
        expect(device.update).toHaveBeenCalledWith({ '4': false });
    });

    test('setSwingMode rejects (No Response) and writes nothing when disconnected', async () => {
        const { instance, device } = makeFan({ '4': false }, { dpSwing: 4 });
        device.connected = false;
        await expect(instance.setSwingMode(SwingMode.SWING_ENABLED)).rejects.toBeInstanceOf(HAP.HapStatusError);
        expect(device.update).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Enum swing DPs — fans that model oscillation as sweep angles ("OFF"/"30"/"120")
// ---------------------------------------------------------------------------
describe('SimpleFanAccessory swing on/off values', () => {
    const enumSwing = { dpSwing: 7, swingOnValue: '120', swingOffValue: 'OFF' };

    test('the off value disables swing and any other value enables it', () => {
        const { instance } = makeFan({}, enumSwing);
        expect(instance._getSwingMode('OFF')).toBe(SwingMode.SWING_DISABLED);
        expect(instance._getSwingMode('30')).toBe(SwingMode.SWING_ENABLED);
        expect(instance._getSwingMode('120')).toBe(SwingMode.SWING_ENABLED);
        expect(instance._getSwingMode(undefined)).toBe(SwingMode.SWING_DISABLED);
    });

    test('setSwingMode writes the configured on value', () => {
        const { instance, device } = makeFan({ '7': 'OFF' }, enumSwing);
        instance.setSwingMode(SwingMode.SWING_ENABLED);
        expect(device.update).toHaveBeenCalledWith({ '7': '120' });
    });

    test('setSwingMode writes the configured off value', () => {
        const { instance, device } = makeFan({ '7': '120' }, enumSwing);
        instance.setSwingMode(SwingMode.SWING_DISABLED);
        expect(device.update).toHaveBeenCalledWith({ '7': 'OFF' });
    });

    test('empty on/off values fall back to booleans', () => {
        const { instance, device } = makeFan({ '4': false }, { dpSwing: 4, swingOnValue: '', swingOffValue: '' });
        instance.setSwingMode(SwingMode.SWING_ENABLED);
        expect(device.update).toHaveBeenCalledWith({ '4': true });
        expect(instance._getSwingMode(false)).toBe(SwingMode.SWING_DISABLED);
    });
});

// ---------------------------------------------------------------------------
// Vertical swing — a second oscillation axis exposed as a Switch
// ---------------------------------------------------------------------------
describe('SimpleFanAccessory vertical swing', () => {
    const vertical = { dpSwingVertical: 6, swingVerticalOnValue: '60', swingVerticalOffValue: 'OFF' };

    test('reads the vertical swing DP through its off value', () => {
        const { instance } = makeFan({ '6': '30' }, vertical);
        expect(instance.getSwingVertical()).toBe(true);
        expect(instance._getSwingVertical('OFF')).toBe(false);
    });

    test('setSwingVertical writes the configured on value', () => {
        const { instance, device } = makeFan({ '6': 'OFF' }, vertical);
        instance.setSwingVertical(true);
        expect(device.update).toHaveBeenCalledWith({ '6': '60' });
    });

    test('setSwingVertical writes the configured off value', () => {
        const { instance, device } = makeFan({ '6': '60' }, vertical);
        instance.setSwingVertical(false);
        expect(device.update).toHaveBeenCalledWith({ '6': 'OFF' });
    });

    test('a boolean vertical swing DP works without on/off values', () => {
        const { instance, device } = makeFan({ '6': false }, { dpSwingVertical: 6 });
        instance.setSwingVertical(true);
        expect(device.update).toHaveBeenCalledWith({ '6': true });
    });

    test('the switch is named after the device', () => {
        expect(makeFan({}, vertical).instance._getSwingVerticalName()).toBe('Test Device Vertical Swing');
    });
});

// ---------------------------------------------------------------------------
// Registration — SwingMode is opt-in and RotationDirection is opt-out
// ---------------------------------------------------------------------------
describe('SimpleFanAccessory._registerCharacteristics', () => {
    const register = context => {
        const { instance, accessory } = makeInstance(SimpleFanAccessory, {}, { type: 'Fan', ...context });
        const service = accessory._mockService;
        service.getCharacteristic.mockClear();
        instance._registerCharacteristics(instance.device.state);
        return service;
    };

    test('registers SwingMode when dpSwing is configured', () => {
        const service = register({ dpSwing: 4 });
        expect(service.getCharacteristic).toHaveBeenCalledWith(SwingMode);
    });

    test('does not register SwingMode when dpSwing is absent (backwards compatible)', () => {
        const service = register({});
        expect(service.getCharacteristic).not.toHaveBeenCalledWith(SwingMode);
    });

    test('adds the vertical swing Switch when dpSwingVertical is configured', () => {
        const { instance, accessory } = makeInstance(SimpleFanAccessory, {}, { type: 'Fan', dpSwingVertical: 6 });
        instance._registerCharacteristics(instance.device.state);
        expect(accessory.addService).toHaveBeenCalledWith(HAP.Service.Switch, 'Test Device Vertical Swing', 'swing-vertical');
    });

    test('removes a cached vertical swing Switch when dpSwingVertical is dropped', () => {
        const { instance, accessory } = makeInstance(SimpleFanAccessory, {}, { type: 'Fan' });
        const cached = { UUID: 'switch' };
        accessory.getServiceById.mockReturnValue(cached);
        instance._registerCharacteristics(instance.device.state);
        expect(accessory.removeService).toHaveBeenCalledWith(cached);
        expect(accessory.addService).not.toHaveBeenCalled();
    });

    test('registers RotationDirection by default', () => {
        const service = register({});
        expect(service.getCharacteristic).toHaveBeenCalledWith(RotationDirection);
    });

    test('drops RotationDirection when noDirection is set', () => {
        const service = register({ noDirection: true });
        expect(service.getCharacteristic).not.toHaveBeenCalledWith(RotationDirection);
    });
});
