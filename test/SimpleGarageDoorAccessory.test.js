'use strict';

const SimpleGarageDoorAccessory = require('../lib/SimpleGarageDoorAccessory');
const { HAP, makeInstance } = require('./support/mocks');

const { CurrentDoorState: CDS, TargetDoorState: TDS } = HAP.Characteristic;

const STOP_TO_DIRECTION_DELAY_MS = 500;
const CURRENT_STATE_DELAY_MS = 1000;
const TOTAL_DELAY_MS = STOP_TO_DIRECTION_DELAY_MS + CURRENT_STATE_DELAY_MS;

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
    instance.opToken = 0;
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
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('OPEN sends stop=true, then open=true after the stop->direction delay', async () => {
        const { instance, device } = makeSimpleGarage();
        const op = instance.setTargetDoorState(TDS.OPEN);

        await jest.advanceTimersByTimeAsync(0);
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        await jest.advanceTimersByTimeAsync(STOP_TO_DIRECTION_DELAY_MS - 1);
        expect(device.update).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });

        await jest.advanceTimersByTimeAsync(CURRENT_STATE_DELAY_MS);
        await op;
    });

    test('CLOSED sends stop=true, then close=true after the stop->direction delay', async () => {
        const { instance, device } = makeSimpleGarage();
        const op = instance.setTargetDoorState(TDS.CLOSED);

        await jest.advanceTimersByTimeAsync(0);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        await jest.advanceTimersByTimeAsync(STOP_TO_DIRECTION_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });

        await jest.advanceTimersByTimeAsync(CURRENT_STATE_DELAY_MS);
        await op;
    });

    test('Custom DPs are respected', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.dpOpen = '101';
        instance.dpStop = '102';
        instance.dpClose = '103';
        const op = instance.setTargetDoorState(TDS.OPEN);

        await jest.advanceTimersByTimeAsync(0);
        expect(device.update).toHaveBeenNthCalledWith(1, { '102': true });

        await jest.advanceTimersByTimeAsync(STOP_TO_DIRECTION_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '101': true });

        await jest.advanceTimersByTimeAsync(CURRENT_STATE_DELAY_MS);
        await op;
    });

    test('Skips writes when the device is disconnected', async () => {
        const { instance, device } = makeSimpleGarage();
        device.connected = false;
        const op = instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(TOTAL_DELAY_MS);
        await op;
        expect(device.update).not.toHaveBeenCalled();
    });

    test('Reversing during the stop->direction window cancels the pending direction command', async () => {
        const { instance, device } = makeSimpleGarage();
        const op1 = instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(0);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        await jest.advanceTimersByTimeAsync(200);
        const op2 = instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(0);

        // A second stop is sent, but the originally-pending open must not fire.
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenNthCalledWith(2, { '2': true });

        await jest.advanceTimersByTimeAsync(STOP_TO_DIRECTION_DELAY_MS);
        expect(device.update).toHaveBeenCalledTimes(3);
        expect(device.update).toHaveBeenNthCalledWith(3, { '3': true });

        await jest.advanceTimersByTimeAsync(CURRENT_STATE_DELAY_MS);
        await op1;
        await op2;
    });
});

// ---------------------------------------------------------------------------
// CurrentDoorState transition
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — CurrentDoorState transition', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('CurrentDoorState updates to OPEN after the full transition window', async () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        const op = instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);

        await jest.advanceTimersByTimeAsync(TOTAL_DELAY_MS - 1);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);

        await jest.advanceTimersByTimeAsync(1);
        await op;
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });

    test('CurrentDoorState updates to CLOSED after the full transition window', async () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        const op = instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(TOTAL_DELAY_MS);
        await op;
        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
    });

    test('Reversing direction mid-transition cancels the stale CurrentDoorState update', async () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        const op1 = instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(STOP_TO_DIRECTION_DELAY_MS + 200);
        const op2 = instance.setTargetDoorState(TDS.OPEN);

        await jest.advanceTimersByTimeAsync(500);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);

        await jest.advanceTimersByTimeAsync(TOTAL_DELAY_MS);
        await op1;
        await op2;
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory persistence', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Stores the latest target on the accessory context', async () => {
        const { instance, accessory } = makeSimpleGarage();
        const op1 = instance.setTargetDoorState(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
        const op2 = instance.setTargetDoorState(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);

        await jest.advanceTimersByTimeAsync(TOTAL_DELAY_MS);
        await op1;
        await op2;
    });
});
