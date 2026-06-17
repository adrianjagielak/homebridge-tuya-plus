'use strict';

const SimpleGarageDoorAccessory = require('../lib/SimpleGarageDoorAccessory');
const { HAP, makeInstance } = require('./support/mocks');

const { CurrentDoorState: CDS, TargetDoorState: TDS } = HAP.Characteristic;

// Raw status DP values reported by the controller (DP 105).
const STATE_STOPPED = 11;
const STATE_OPENING_OR_OPEN = 12;
const STATE_CLOSING_OR_CLOSED = 13;

// Give the device's `on`/`removeListener` mocks real subscription semantics
// so the accessory can wait for `change` events the way it does in production.
function installRealEvents(device) {
    const handlers = new Map();
    device.on = jest.fn((event, handler) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event).push(handler);
    });
    device.removeListener = jest.fn((event, handler) => {
        const list = handlers.get(event);
        if (!list) return;
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
    });
    device.emit = (event, ...args) => {
        const list = handlers.get(event);
        if (list) list.slice().forEach(h => h(...args));
    };
    device.listenerCount = (event) => (handlers.get(event) || []).length;
}

function makeSimpleGarage(initialContext = {}) {
    const { instance, device, accessory, platform } = makeInstance(
        SimpleGarageDoorAccessory,
        {},
        { manufacturer: 'Generic', ...initialContext }
    );

    installRealEvents(device);

    // Mirror the state that _registerCharacteristics would set up. We can't
    // call it directly because the mock service shares a single mock
    // characteristic across calls — wiring each role manually keeps the
    // assertions untangled.
    instance.dpOpen = '101';
    instance.dpClose = '102';
    instance.dpStop = '103';
    instance.dpState = '105';
    instance.partialOpenMs = 0;
    instance.partialStopTimer = null;
    instance.currentDoorState = CDS.CLOSED;
    instance.characteristicCurrentDoorState = {
        value: CDS.CLOSED,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };
    instance.characteristicTargetDoorState = {
        value: TDS.CLOSED,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };
    instance.characteristicPartialOpen = {
        value: false,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };
    accessory.context.cachedTargetDoorState = TDS.CLOSED;

    // Mirror the persistent change listener registered in production.
    device.on('change', changes => instance._onDeviceChange(changes));

    return { instance, device, accessory, platform };
}

// Simulate the controller reporting a new value on its status DP.
function emitState(device, value) {
    device.emit('change', { '105': value });
}

// ---------------------------------------------------------------------------
// State DP -> door state mapping (the heart of the new behaviour)
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory._onDeviceChange', () => {
    test('State 12 (opening/open) drives Current and Target to OPEN', () => {
        const { instance, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        accessory.context.cachedTargetDoorState = TDS.CLOSED;

        instance._onDeviceChange({ '105': STATE_OPENING_OR_OPEN });

        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);
    });

    test('State 11 (stopped) is treated as OPEN', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance._onDeviceChange({ '105': STATE_STOPPED });

        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });

    test('State 13 (closing/closed) drives Current and Target to CLOSED', () => {
        const { instance, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;
        instance.characteristicTargetDoorState.value = TDS.OPEN;
        accessory.context.cachedTargetDoorState = TDS.OPEN;

        instance._onDeviceChange({ '105': STATE_CLOSING_OR_CLOSED });

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
    });

    test('String DP values are coerced', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;

        instance._onDeviceChange({ '105': '12' });

        expect(instance.currentDoorState).toBe(CDS.OPEN);
    });

    test('Unknown DP values are ignored', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;

        instance._onDeviceChange({ '105': 99 });

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.updateValue).not.toHaveBeenCalled();
    });

    test('Changes that do not include the state DP are ignored', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;

        // The action DPs echoing back are irrelevant — only the state DP matters.
        instance._onDeviceChange({ '101': false });
        instance._onDeviceChange({ '103': true });

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.updateValue).not.toHaveBeenCalled();
    });

    test('No characteristic write when the state already matches', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;
        instance.accessory.context.cachedTargetDoorState = TDS.OPEN;

        instance._onDeviceChange({ '105': STATE_OPENING_OR_OPEN });

        expect(instance.characteristicCurrentDoorState.updateValue).not.toHaveBeenCalled();
        expect(instance.characteristicTargetDoorState.updateValue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// setTargetDoorState — fires the matching action, no stop-first dance
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState', () => {
    test('OPEN fires the open action immediately (no stop first)', () => {
        const { instance, device, accessory } = makeSimpleGarage();

        instance.setTargetDoorState(TDS.OPEN);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '101': true });
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.OPEN);
    });

    test('CLOSE fires the close action immediately (no stop first)', () => {
        const { instance, device, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '102': true });
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.CLOSED);
    });

    test('CurrentDoorState is not touched until the device reports it', () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        // Target updated, but Current waits for the status DP.
        expect(instance.characteristicCurrentDoorState.updateValue).not.toHaveBeenCalled();
        expect(instance.currentDoorState).toBe(CDS.CLOSED);

        // ~1s later the controller reports it is opening.
        emitState(device, STATE_OPENING_OR_OPEN);
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });

    test('Custom DPs are respected', () => {
        const { instance, device } = makeSimpleGarage();
        instance.dpOpen = '1';
        instance.dpClose = '2';

        instance.setTargetDoorState(TDS.OPEN);
        expect(device.update).toHaveBeenCalledWith({ '1': true });

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenCalledWith({ '2': true });
    });

    test('Stop is never fired by a normal open/close', () => {
        const { instance, device } = makeSimpleGarage();

        instance.setTargetDoorState(TDS.OPEN);
        instance.setTargetDoorState(TDS.CLOSED);

        expect(device.update).not.toHaveBeenCalledWith({ '103': true });
    });
});

// ---------------------------------------------------------------------------
// Disconnect handling
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — disconnected', () => {
    test('Skips writes when the device is disconnected', () => {
        const { instance, device } = makeSimpleGarage();
        device.connected = false;

        instance.setTargetDoorState(TDS.OPEN);

        expect(device.update).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory persistence', () => {
    test('Stores the latest target on the accessory context', () => {
        const { instance, accessory } = makeSimpleGarage();

        instance.setTargetDoorState(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);

        instance.setTargetDoorState(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
    });
});

// ---------------------------------------------------------------------------
// Partial open
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory._handlePartialOpen', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Fires open, then fires stop after partialOpenMs', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;

        instance._handlePartialOpen();

        // Open goes out immediately.
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '101': true });
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.OPEN);

        // Nothing happens until the timer elapses.
        jest.advanceTimersByTime(2000 - 1);
        expect(device.update).toHaveBeenCalledTimes(1);

        // Then a single stop is fired.
        jest.advanceTimersByTime(1);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenNthCalledWith(2, { '103': true });

        // And nothing more after that.
        jest.advanceTimersByTime(10_000);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(instance.partialStopTimer).toBeNull();
    });

    test('Re-entrant press while armed is ignored (idempotent)', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;

        instance._handlePartialOpen();
        expect(device.update).toHaveBeenCalledTimes(1);

        // A retransmit 1.5s in must not re-open or push the stop out.
        jest.advanceTimersByTime(1500);
        instance._handlePartialOpen();
        expect(device.update).toHaveBeenCalledTimes(1);

        // Original timer still fires at its original 2000ms deadline.
        jest.advanceTimersByTime(499);
        expect(device.update).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        expect(device.update).toHaveBeenNthCalledWith(2, { '103': true });
    });

    test('A direct open/close cancels the armed auto-stop', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;

        instance._handlePartialOpen();
        expect(instance.partialStopTimer).not.toBeNull();

        // User takes manual control before the auto-stop fires.
        jest.advanceTimersByTime(500);
        instance.setTargetDoorState(TDS.CLOSED);
        expect(instance.partialStopTimer).toBeNull();
        expect(device.update).toHaveBeenLastCalledWith({ '102': true });

        // The stop must never fire now.
        jest.advanceTimersByTime(5000);
        expect(device.update).not.toHaveBeenCalledWith({ '103': true });
    });

    test('Does nothing when partialOpenMs is not configured', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 0;

        instance._handlePartialOpen();
        jest.advanceTimersByTime(10_000);

        expect(device.update).not.toHaveBeenCalled();
        expect(instance.partialStopTimer).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Partial-open switch is stateful: mirrors CurrentDoorState (ON when the gate
// is open) via the status DP.
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — partial-open switch state', () => {
    test('Reported OPEN/CLOSED is mirrored onto the switch', () => {
        const { instance } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.characteristicPartialOpen.value = false;

        instance._onDeviceChange({ '105': STATE_OPENING_OR_OPEN });
        expect(instance.characteristicPartialOpen.value).toBe(true);

        instance._onDeviceChange({ '105': STATE_CLOSING_OR_CLOSED });
        expect(instance.characteristicPartialOpen.value).toBe(false);

        // A stop mid-travel (state 11) leaves the gate parked open.
        instance._onDeviceChange({ '105': STATE_STOPPED });
        expect(instance.characteristicPartialOpen.value).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Force open/close switches route through setTargetDoorState
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — force switches', () => {
    test('Force Open fires the open action', () => {
        const { instance, device, accessory } = makeSimpleGarage();

        instance.setTargetDoorState(TDS.OPEN);

        expect(device.update).toHaveBeenCalledWith({ '101': true });
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);
    });

    test('Force Close fires the close action', () => {
        const { instance, device, accessory } = makeSimpleGarage();

        instance.setTargetDoorState(TDS.CLOSED);

        expect(device.update).toHaveBeenCalledWith({ '102': true });
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
    });
});
