'use strict';

const SimpleGarageDoorAccessory = require('../lib/SimpleGarageDoorAccessory');
const { HAP, makeInstance } = require('./support/mocks');

const { CurrentDoorState: CDS, TargetDoorState: TDS } = HAP.Characteristic;

function makeSimpleGarage(contextOverrides = {}) {
    const { instance, device, accessory, platform } = makeInstance(
        SimpleGarageDoorAccessory,
        {},
        { manufacturer: 'Generic', ...contextOverrides }
    );

    // Replicate what _registerCharacteristics would set up.
    instance.dpOpen = '1';
    instance.dpStop = '2';
    instance.dpClose = '3';
    instance.currentDoorState = CDS.OPEN;
    instance.characteristicCurrentDoorState = {
        value: CDS.OPEN,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };

    return { instance, device, accessory, platform };
}

// ---------------------------------------------------------------------------
// setTargetDoorState — device commands
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — device commands', () => {
    test('OPEN sends stop=true then open=true', () => {
        const { instance, device } = makeSimpleGarage();
        instance.setTargetDoorState(TDS.OPEN);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });
    });

    test('CLOSED sends stop=true then close=true', () => {
        const { instance, device } = makeSimpleGarage();
        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });
    });

    test('Skips writes when the device is disconnected', () => {
        const { instance, device } = makeSimpleGarage();
        device.connected = false;
        instance.setTargetDoorState(TDS.OPEN);
        expect(device.update).not.toHaveBeenCalled();
    });

    test('Custom DPs are respected', () => {
        const { instance, device } = makeSimpleGarage();
        instance.dpOpen = '101';
        instance.dpStop = '102';
        instance.dpClose = '103';
        instance.setTargetDoorState(TDS.OPEN);
        expect(device.update).toHaveBeenNthCalledWith(1, { '102': true });
        expect(device.update).toHaveBeenNthCalledWith(2, { '101': true });
    });
});

// ---------------------------------------------------------------------------
// CurrentDoorState transition
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — CurrentDoorState transition', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('CurrentDoorState lags the target by 1s when opening', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);

        jest.advanceTimersByTime(999);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);

        jest.advanceTimersByTime(1);
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });

    test('CurrentDoorState lags the target by 1s when closing', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);

        jest.advanceTimersByTime(1000);
        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
    });

    test('Reversing direction within the 1s window resets the timer', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        jest.advanceTimersByTime(500);
        instance.setTargetDoorState(TDS.OPEN);

        jest.advanceTimersByTime(500);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);

        jest.advanceTimersByTime(500);
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory persistence', () => {
    test('Stores the latest target on the accessory context', () => {
        const { instance, accessory } = makeSimpleGarage();
        instance.setTargetDoorState(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
        instance.setTargetDoorState(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);
    });
});
