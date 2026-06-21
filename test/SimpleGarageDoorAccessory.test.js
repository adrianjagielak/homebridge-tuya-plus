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
    instance.stopBeforeCloseMs = 1500;
    instance.partialStopTimer = null;
    instance.pendingCloseTimer = null;
    instance.partialPending = false;
    instance.partialGeneration = 0;
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
// State DP -> door state mapping
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
// Open — always fired directly, even mid-motion
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — open', () => {
    test('OPEN fires the open action immediately, even while the gate is closing', () => {
        const { instance, device } = makeSimpleGarage();
        device.state['105'] = STATE_CLOSING_OR_CLOSED;

        instance.setTargetDoorState(TDS.OPEN);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '101': true });
    });

    test('OPEN never fires a stop first', () => {
        const { instance, device } = makeSimpleGarage();
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance.setTargetDoorState(TDS.OPEN);

        expect(device.update).not.toHaveBeenCalledWith({ '103': true });
        expect(device.update).toHaveBeenCalledWith({ '101': true });
    });

    test('Target + persistence update optimistically; Current waits for the DP', () => {
        const { instance, device, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.OPEN);
        expect(instance.characteristicCurrentDoorState.updateValue).not.toHaveBeenCalled();
        expect(instance.currentDoorState).toBe(CDS.CLOSED);

        // ~1s later the controller reports it is opening.
        emitState(device, STATE_OPENING_OR_OPEN);
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });

    test('Custom open DP is respected', () => {
        const { instance, device } = makeSimpleGarage();
        instance.dpOpen = '1';

        instance.setTargetDoorState(TDS.OPEN);

        expect(device.update).toHaveBeenCalledWith({ '1': true });
    });
});

// ---------------------------------------------------------------------------
// Close — direct only when already stopped (state 11), otherwise stop-first
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — close (stop-before-close)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('CLOSE fires immediately when the gate is already stopped (state 11)', () => {
        const { instance, device, accessory } = makeSimpleGarage();
        device.state['105'] = STATE_STOPPED;

        instance.setTargetDoorState(TDS.CLOSED);

        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '102': true });
        expect(instance.pendingCloseTimer).toBeNull();
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.CLOSED);
    });

    test('CLOSE while opening (state 12) fires stop, then close after stopBeforeCloseMs', () => {
        const { instance, device } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 1500;
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance.setTargetDoorState(TDS.CLOSED);

        // Stop goes out immediately, close is deferred.
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '103': true });

        jest.advanceTimersByTime(1500 - 1);
        expect(device.update).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(1);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenNthCalledWith(2, { '102': true });
        expect(instance.pendingCloseTimer).toBeNull();
    });

    test('CLOSE while closing (state 13) also uses stop-before-close', () => {
        const { instance, device } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 1500;
        device.state['105'] = STATE_CLOSING_OR_CLOSED;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenNthCalledWith(1, { '103': true });

        jest.advanceTimersByTime(1500);
        expect(device.update).toHaveBeenNthCalledWith(2, { '102': true });
    });

    test('CLOSE with no reported state yet uses stop-before-close', () => {
        const { instance, device } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 1500;
        // device.state['105'] intentionally left undefined

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenNthCalledWith(1, { '103': true });

        jest.advanceTimersByTime(1500);
        expect(device.update).toHaveBeenNthCalledWith(2, { '102': true });
    });

    test('A duplicate CLOSE during the wait does not restart or double-fire', () => {
        const { instance, device } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 1500;
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenCalledTimes(1); // stop

        jest.advanceTimersByTime(1000);
        instance.setTargetDoorState(TDS.CLOSED); // retransmit / second tap
        expect(device.update).toHaveBeenCalledTimes(1); // no extra stop, timer not pushed out

        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenNthCalledWith(2, { '102': true });
    });

    test('OPEN during the wait cancels the pending close and opens instead', () => {
        const { instance, device } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 1500;
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenNthCalledWith(1, { '103': true }); // stop

        jest.advanceTimersByTime(500);
        instance.setTargetDoorState(TDS.OPEN);
        expect(instance.pendingCloseTimer).toBeNull();
        expect(device.update).toHaveBeenNthCalledWith(2, { '101': true }); // open

        // The trailing close must never fire.
        jest.advanceTimersByTime(5000);
        expect(device.update).toHaveBeenCalledTimes(2);
    });

    test('Status reports are ignored during the stop-before-close window', () => {
        const { instance, device, accessory } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 1500;
        device.state['105'] = STATE_OPENING_OR_OPEN;
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);

        // The stop makes the controller momentarily report 11 (=OPEN). That
        // must be ignored, or it would bounce Target back to OPEN mid-close.
        emitState(device, STATE_STOPPED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
        expect(instance.currentDoorState).toBe(CDS.OPEN);

        // Close fires, then the controller reports 13 and we resume mirroring.
        jest.advanceTimersByTime(1500);
        expect(device.update).toHaveBeenNthCalledWith(2, { '102': true });
        emitState(device, STATE_CLOSING_OR_CLOSED);
        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
    });

    test('stopBeforeCloseMs is configurable', () => {
        const { instance, device } = makeSimpleGarage();
        instance.stopBeforeCloseMs = 300;
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenNthCalledWith(1, { '103': true });

        jest.advanceTimersByTime(299);
        expect(device.update).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        expect(device.update).toHaveBeenNthCalledWith(2, { '102': true });
    });

    test('Custom stop/close DPs are respected in the stop-before-close path', () => {
        const { instance, device } = makeSimpleGarage();
        instance.dpClose = '2';
        instance.dpStop = '4';
        instance.stopBeforeCloseMs = 1000;
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenNthCalledWith(1, { '4': true });

        jest.advanceTimersByTime(1000);
        expect(device.update).toHaveBeenNthCalledWith(2, { '2': true });
    });
});

// ---------------------------------------------------------------------------
// Disconnect handling
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — disconnected', () => {
    test('Surfaces a No Response error and writes nothing when disconnected', () => {
        const { instance, device } = makeSimpleGarage();
        device.connected = false;

        // A tap on an unreachable gate must fail in HomeKit instead of being
        // silently dropped while HomeKit believes the open/close succeeded.
        expect(() => instance.setTargetDoorState(TDS.OPEN)).toThrow(HAP.HapStatusError);

        expect(device.update).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory persistence', () => {
    test('Stores the latest target on the accessory context', () => {
        const { instance, device, accessory } = makeSimpleGarage();
        // Already stopped, so the close fires immediately (no dangling timer).
        device.state['105'] = STATE_STOPPED;

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

    test('Stop is anchored to the gate reporting it is moving, not the button press', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        // Gate starts closed, so the open command needs time to reach it and
        // get the gate moving before a stop can do anything.
        device.state['105'] = STATE_CLOSING_OR_CLOSED;

        instance._handlePartialOpen();

        // Open goes out immediately, but the auto-stop is NOT armed yet.
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '101': true });
        expect(instance.characteristicTargetDoorState.value).toBe(TDS.OPEN);
        expect(instance.partialStopTimer).toBeNull();
        expect(instance.partialPending).toBe(true);

        // No amount of waiting fires a stop until the gate reports it's moving —
        // this is what stops a too-early stop from being a dropped no-op.
        jest.advanceTimersByTime(10_000);
        expect(device.update).toHaveBeenCalledTimes(1);

        // Controller reports it has started opening: now the countdown arms.
        emitState(device, STATE_OPENING_OR_OPEN);
        expect(instance.partialStopTimer).not.toBeNull();
        expect(instance.partialPending).toBe(false);

        jest.advanceTimersByTime(2000 - 1);
        expect(device.update).toHaveBeenCalledTimes(1);

        // The stop fires, and is re-sent a couple of times to survive a dropped
        // write (the controller occasionally drops a lone command).
        jest.advanceTimersByTime(1);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenNthCalledWith(2, { '103': true });
        jest.advanceTimersByTime(300);
        expect(device.update).toHaveBeenNthCalledWith(3, { '103': true });
        jest.advanceTimersByTime(300);
        expect(device.update).toHaveBeenNthCalledWith(4, { '103': true });

        // And nothing more after the re-sends.
        jest.advanceTimersByTime(10_000);
        expect(device.update).toHaveBeenCalledTimes(4);
        expect(instance.partialStopTimer).toBeNull();
    });

    test('Arms straight away when the gate already reports open/opening', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        device.state['105'] = STATE_OPENING_OR_OPEN;

        instance._handlePartialOpen();

        // Open fired and the countdown armed without waiting for a fresh report.
        expect(device.update).toHaveBeenNthCalledWith(1, { '101': true });
        expect(instance.partialStopTimer).not.toBeNull();
        expect(instance.partialPending).toBe(false);

        jest.advanceTimersByTime(2000);
        expect(device.update).toHaveBeenNthCalledWith(2, { '103': true });
    });

    test('Re-entrant press while in progress is ignored (idempotent)', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        device.state['105'] = STATE_OPENING_OR_OPEN; // arms immediately

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

    test('Re-entrant press while waiting for movement is ignored', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        device.state['105'] = STATE_CLOSING_OR_CLOSED;

        instance._handlePartialOpen();
        expect(device.update).toHaveBeenCalledTimes(1); // open
        expect(instance.partialPending).toBe(true);

        // A second press before the gate reports moving must not fire another open.
        instance._handlePartialOpen();
        expect(device.update).toHaveBeenCalledTimes(1);
    });

    test('A direct close cancels the partial auto-stop and runs stop-before-close', () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.stopBeforeCloseMs = 1500;
        device.state['105'] = STATE_OPENING_OR_OPEN; // gate is moving during the partial

        instance._handlePartialOpen();
        expect(instance.partialStopTimer).not.toBeNull();
        expect(device.update).toHaveBeenNthCalledWith(1, { '101': true }); // open

        // User closes before the partial auto-stop fires.
        jest.advanceTimersByTime(500);
        instance.setTargetDoorState(TDS.CLOSED);
        expect(instance.partialStopTimer).toBeNull(); // partial auto-stop cancelled
        expect(device.update).toHaveBeenNthCalledWith(2, { '103': true }); // stop-before-close stop

        jest.advanceTimersByTime(1500);
        expect(device.update).toHaveBeenNthCalledWith(3, { '102': true }); // close

        // The cancelled partial stop never fires a stray write.
        jest.advanceTimersByTime(5000);
        expect(device.update).toHaveBeenCalledTimes(3);
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

    test('Force Close fires the close action (immediately when already stopped)', () => {
        const { instance, device, accessory } = makeSimpleGarage();
        device.state['105'] = STATE_STOPPED;

        instance.setTargetDoorState(TDS.CLOSED);

        expect(device.update).toHaveBeenCalledWith({ '102': true });
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);
    });
});
