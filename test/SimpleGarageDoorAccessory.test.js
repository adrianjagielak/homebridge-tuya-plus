'use strict';

const SimpleGarageDoorAccessory = require('../lib/SimpleGarageDoorAccessory');
const { HAP, makeInstance } = require('./support/mocks');

const { CurrentDoorState: CDS, TargetDoorState: TDS } = HAP.Characteristic;

const POST_RESET_DELAY_MS = 500;
const STOP_RESET_TIMEOUT_MS = 3000;
const DIRECTION_RESET_TIMEOUT_MS = 3000;
const SETTLE_MS = 1000;

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
    instance.dpOpen = '1';
    instance.dpStop = '2';
    instance.dpClose = '3';
    instance.partialOpenMs = 0;
    instance.currentDoorState = CDS.OPEN;
    instance.desiredTarget = TDS.OPEN;
    instance.worker = null;
    instance.scheduleTimer = null;
    instance.partialStopTimer = null;
    instance.partialOpenId = 0;
    instance._partialPending = false;
    instance._currentChangePending = null;
    instance._currentChangeResolve = null;
    instance.characteristicCurrentDoorState = {
        value: CDS.OPEN,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };
    instance.characteristicTargetDoorState = {
        value: TDS.OPEN,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };
    instance.characteristicPartialOpen = {
        value: true,
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
    };
    accessory.context.cachedTargetDoorState = TDS.OPEN;

    // Mirror the persistent change listener registered in production.
    device.on('change', changes => instance._onDeviceChange(changes));

    return { instance, device, accessory, platform };
}

// Simulate the device echoing a DP back to false (its "command consumed"
// signal). Drives both the worker's per-step listener and the persistent
// CurrentDoorState listener.
function emitReset(device, dp) {
    device.emit('change', { [dp]: false }, { [dp]: false });
}

// ---------------------------------------------------------------------------
// _onDeviceChange — the persistent listener that drives CurrentDoorState
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory._onDeviceChange', () => {
    test('Open DP resetting to false sets CurrentDoorState to OPEN', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance._onDeviceChange({ '1': false });

        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });

    test('Close DP resetting to false sets CurrentDoorState to CLOSED', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        instance._onDeviceChange({ '3': false });

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
    });

    test('Open DP echoing back to true does not change CurrentDoorState', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;

        instance._onDeviceChange({ '1': true });

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
    });

    test('Stop DP resets do not change CurrentDoorState', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;

        instance._onDeviceChange({ '2': false });

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
    });

    test('No characteristic write when CurrentDoorState already matches', () => {
        const { instance } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance._onDeviceChange({ '1': false });

        expect(instance.characteristicCurrentDoorState.updateValue).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// setTargetDoorState — single command (target differs from current)
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — single command', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('OPEN debounces for SETTLE_MS then sends stop, waits for reset+500ms, then sends open', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(SETTLE_MS - 1);
        expect(device.update).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });

        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
        expect(instance.worker).toBeNull();
        expect(instance.scheduleTimer).toBeNull();
    });

    test('CLOSE debounces then sends stop, waits, then sends close; CurrentDoorState flips on close reset', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });

        emitReset(device, '3');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
        expect(instance.worker).toBeNull();
    });

    test('Target matching current produces no commands', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.desiredTarget = TDS.OPEN;

        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(
            SETTLE_MS + STOP_RESET_TIMEOUT_MS + POST_RESET_DELAY_MS + DIRECTION_RESET_TIMEOUT_MS
        );

        expect(device.update).not.toHaveBeenCalled();
        expect(instance.worker).toBeNull();
    });

    test('Custom DPs are respected', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.dpOpen = '101';
        instance.dpStop = '102';
        instance.dpClose = '103';
        instance.currentDoorState = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '102': true });

        emitReset(device, '102');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '101': true });

        emitReset(device, '101');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
    });
});

// ---------------------------------------------------------------------------
// Spam / debounce
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory.setTargetDoorState — spam debounce', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Rapid presses within the debounce window coalesce into one cycle on the final target', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        // 5 presses across ~800ms, all within SETTLE_MS of each other.
        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.CLOSED);

        // Nothing should have fired yet — debounce keeps resetting.
        expect(device.update).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });
        expect(device.update).toHaveBeenCalledTimes(2);

        emitReset(device, '3');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
        expect(instance.worker).toBeNull();
    });

    test('Presses that settle on the current state produce no commands at all', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(200);
        instance.setTargetDoorState(TDS.OPEN);

        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        // Final target matches current — no work to do.
        expect(device.update).not.toHaveBeenCalled();
        expect(instance.worker).toBeNull();
    });

    test('Reverting to current while a worker is running suppresses the direction command', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        // User reverts mid-stop.
        instance.setTargetDoorState(TDS.OPEN);

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        // Only stop went out — no direction, because target reverted to OPEN.
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(instance.worker).toBeNull();
        expect(instance.scheduleTimer).toBeNull();
    });

    test('Pressing the opposite during the direction wait triggers a follow-up cycle after the debounce', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });

        // User reverses while close is in flight.
        instance.setTargetDoorState(TDS.OPEN);
        emitReset(device, '3');
        await jest.advanceTimersByTimeAsync(0);
        // Close reset flipped UI to CLOSED. Worker exited, finally queued
        // another cycle behind the debounce.
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.CLOSED);
        expect(device.update).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(3, { '2': true });

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(4, { '1': true });

        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
        expect(instance.worker).toBeNull();
    });

    test('Only one worker is active at a time across rapid toggles', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        const workerA = instance.worker;
        expect(workerA).not.toBeNull();

        instance.setTargetDoorState(TDS.OPEN);
        instance.setTargetDoorState(TDS.CLOSED);
        expect(instance.worker).toBe(workerA);

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '3');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.worker).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Timeout fallbacks
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — timeout fallbacks', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Falls back to sending the direction after STOP_RESET_TIMEOUT_MS if no echo arrives', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(STOP_RESET_TIMEOUT_MS + POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });

        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.worker).toBeNull();
    });

    test('Worker exits and force-flips CurrentDoorState after DIRECTION_RESET_TIMEOUT_MS when the echo is missed', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });

        await jest.advanceTimersByTimeAsync(DIRECTION_RESET_TIMEOUT_MS);
        expect(instance.characteristicCurrentDoorState.value).toBe(CDS.OPEN);
        expect(instance.worker).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Disconnect handling
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — disconnected', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Skips writes when the device is disconnected', async () => {
        const { instance, device } = makeSimpleGarage();
        device.connected = false;
        instance.currentDoorState = CDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        await jest.advanceTimersByTimeAsync(
            SETTLE_MS + STOP_RESET_TIMEOUT_MS + POST_RESET_DELAY_MS + DIRECTION_RESET_TIMEOUT_MS
        );
        expect(device.update).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory persistence', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Stores the latest target on the accessory context', async () => {
        const { instance, device, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);

        instance.setTargetDoorState(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);

        // Drain so any spawned worker resolves cleanly.
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        if (device.update.mock.calls.length > 0) {
            emitReset(device, '2');
            await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        }
    });
});

// ---------------------------------------------------------------------------
// Partial-open switch
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory._handlePartialOpen', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Opens the gate, waits partialOpenMs after current=OPEN, then sends a raw STOP', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();

        // Open cycle is queued through the regular debounce + worker.
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });

        // Until the open echo lands the stop timer is not scheduled.
        // (Stay short of DIRECTION_RESET_TIMEOUT_MS so the belt-and-braces
        // current-state flip doesn't run yet.)
        await jest.advanceTimersByTimeAsync(1000);
        expect(device.update).toHaveBeenCalledTimes(2);

        // Open echo flips CurrentDoorState, partial-open flow then starts
        // its 2 s timer.
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.currentDoorState).toBe(CDS.OPEN);

        await jest.advanceTimersByTimeAsync(2000 - 1);
        expect(device.update).toHaveBeenCalledTimes(2);

        // Timer fires: raw STOP write goes straight to the device, no queue,
        // no debounce, no follow-up direction. The stop is re-sent a few
        // times spread over ~1.2 s to defend against dropped writes.
        await jest.advanceTimersByTimeAsync(1);
        expect(device.update).toHaveBeenCalledTimes(3);
        expect(device.update).toHaveBeenNthCalledWith(3, { '2': true });

        await jest.advanceTimersByTimeAsync(1200);
        expect(device.update).toHaveBeenCalledTimes(6);
        expect(device.update).toHaveBeenNthCalledWith(4, { '2': true });
        expect(device.update).toHaveBeenNthCalledWith(5, { '2': true });
        expect(device.update).toHaveBeenNthCalledWith(6, { '2': true });

        await jest.advanceTimersByTimeAsync(10_000);
        expect(device.update).toHaveBeenCalledTimes(6);
        // Gate is now partially open — CurrentDoorState stays OPEN.
        expect(instance.currentDoorState).toBe(CDS.OPEN);
    });

    test('Sends only the raw STOP if the gate is already OPEN', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.OPEN;

        instance._handlePartialOpen();

        await jest.advanceTimersByTimeAsync(0);
        // No open cycle needed — desiredTarget==current already.
        expect(device.update).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(2000);
        // Four stop sends spread over ~1.2 s; first one fires immediately at
        // partialOpenMs.
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
        await jest.advanceTimersByTimeAsync(1200);
        expect(device.update).toHaveBeenCalledTimes(4);
    });

    test('Pressing partial again while the stop timer is armed is ignored (idempotent)', async () => {
        // HomeKit/iOS retransmit a WRITE if the 204 response is delayed or
        // dropped, which fires onSet again. The retry must not cancel the
        // armed stop and push it out — otherwise repeated retries can
        // delay the auto-stop indefinitely and the gate runs all the way
        // open. The retry should be ignored; the original timer fires at
        // its original deadline.
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.OPEN;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(0);

        await jest.advanceTimersByTimeAsync(1500);
        // 1.5 s in, retry — should be ignored.
        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(0);
        expect(device.update).not.toHaveBeenCalled();

        // Original timer fires at the original 2000 ms deadline.
        await jest.advanceTimersByTimeAsync(499);
        expect(device.update).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
    });

    test('Pressing partial again while the open wait is pending is ignored (idempotent)', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        // Retry lands while we're still waiting for the stop reset / open
        // echo. The retry should not bump the generation token or restart
        // anything — the original flow should complete normally.
        const idBefore = instance.partialOpenId;
        instance._handlePartialOpen();
        expect(instance.partialOpenId).toBe(idBefore);

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);

        await jest.advanceTimersByTimeAsync(2000);
        expect(device.update).toHaveBeenNthCalledWith(3, { '2': true });
    });

    test('A same-value setTargetDoorState while the partial stop is armed does not cancel it', async () => {
        // HomeKit / iOS Home may write TargetDoorState=OPEN back to the
        // accessory after observing CurrentDoorState flip to OPEN (a
        // resync). desiredTarget is already OPEN from the partial flow's
        // own _setTarget, so this is a no-op write — but the public
        // setTargetDoorState path would still cancel the armed partial
        // stop and the auto-stop would never fire, leaving the gate to
        // run all the way open. The no-op write should be ignored.
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.partialStopTimer).not.toBeNull();

        // Simulate the HomeKit-side resync write.
        instance.setTargetDoorState(TDS.OPEN);
        expect(instance.partialStopTimer).not.toBeNull();

        await jest.advanceTimersByTimeAsync(2000);
        expect(device.update).toHaveBeenNthCalledWith(3, { '2': true });
    });

    test('A same-value setTargetDoorState during the open wait does not supersede the partial flow', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });

        // HomeKit pushes a TargetDoorState=OPEN write mid-cycle. The partial
        // flow's _setTarget already set desiredTarget=OPEN, so this is
        // redundant — it should not disturb the in-flight partial.
        const idBefore = instance.partialOpenId;
        instance.setTargetDoorState(TDS.OPEN);
        expect(instance.partialOpenId).toBe(idBefore);
        expect(instance._partialPending).toBe(true);

        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);

        await jest.advanceTimersByTimeAsync(2000);
        expect(device.update).toHaveBeenNthCalledWith(3, { '2': true });
    });

    test('External setTargetDoorState with a different target cancels the armed auto-stop', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();

        // Run the open cycle.
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.partialStopTimer).not.toBeNull();

        // Stop timer is now armed (fires in 2 s). User toggles to a real
        // different target (CLOSED) — auto-stop should be cancelled.
        await jest.advanceTimersByTimeAsync(500);
        instance.setTargetDoorState(TDS.CLOSED);
        expect(instance.partialStopTimer).toBeNull();
    });

    test('External setTargetDoorState with a different target during the open wait supersedes the partial flow', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '1');
        // Before the loop notices and arms the stop timer, the user toggles
        // to a real different target (CLOSED — the partial intended OPEN).
        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(0);

        // partialOpenId got bumped — the partial flow's wait returns silently.
        expect(instance.partialStopTimer).toBeNull();
    });

    test('Does nothing when partialOpenMs is not configured', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 0;
        instance.currentDoorState = CDS.OPEN;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(10_000);

        expect(device.update).not.toHaveBeenCalled();
        expect(instance.partialStopTimer).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Force open/close switches (just verify they route through setTargetDoorState
// — the queue/debounce behaviour is already covered by the earlier suites)
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — force switches', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('Force Open routes through the public setTargetDoorState path', async () => {
        const { instance, device, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.desiredTarget = TDS.CLOSED;

        instance.setTargetDoorState(TDS.OPEN);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.OPEN);
        expect(instance.desiredTarget).toBe(TDS.OPEN);

        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '1': true });
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.currentDoorState).toBe(CDS.OPEN);
    });

    test('Force Close routes through the public setTargetDoorState path', async () => {
        const { instance, device, accessory } = makeSimpleGarage();
        instance.currentDoorState = CDS.OPEN;

        instance.setTargetDoorState(TDS.CLOSED);
        expect(accessory.context.cachedTargetDoorState).toBe(TDS.CLOSED);

        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });
        emitReset(device, '3');
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.currentDoorState).toBe(CDS.CLOSED);
    });

    test('A force action with a different target cancels the in-flight partial', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;

        // Partial press while already open: just schedules the stop timer.
        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(0);
        expect(instance.partialStopTimer).not.toBeNull();

        // Force Close pressed before the auto-stop fires. The different
        // target indicates a real user override — cancel the partial.
        instance.setTargetDoorState(TDS.CLOSED);
        expect(instance.partialStopTimer).toBeNull();

        // The new target (CLOSED) is acted on through the regular queue.
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        expect(device.update).toHaveBeenNthCalledWith(1, { '2': true });
    });
});

// ---------------------------------------------------------------------------
// Partial-open switch is stateful: mirrors CurrentDoorState (ON when the gate
// is open) and toggling it OFF triggers a standard close cycle.
// ---------------------------------------------------------------------------
describe('SimpleGarageDoorAccessory — partial-open switch state', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('_setCurrentDoorState mirrors OPEN/CLOSED to the switch', () => {
        const { instance } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicPartialOpen.value = false;

        instance._setCurrentDoorState(CDS.OPEN);
        expect(instance.characteristicPartialOpen.value).toBe(true);

        instance._setCurrentDoorState(CDS.CLOSED);
        expect(instance.characteristicPartialOpen.value).toBe(false);
    });

    test('After the partial open cycle the switch reads ON', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.CLOSED;
        instance.characteristicCurrentDoorState.value = CDS.CLOSED;
        instance.characteristicPartialOpen.value = false;
        instance.desiredTarget = TDS.CLOSED;

        instance._handlePartialOpen();
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        emitReset(device, '1');
        await jest.advanceTimersByTimeAsync(0);

        expect(instance.currentDoorState).toBe(CDS.OPEN);
        expect(instance.characteristicPartialOpen.value).toBe(true);
    });

    test('A subsequent close cycle flips the switch back to OFF', async () => {
        const { instance, device } = makeSimpleGarage();
        instance.partialOpenMs = 2000;
        instance.currentDoorState = CDS.OPEN;
        instance.characteristicCurrentDoorState.value = CDS.OPEN;
        instance.characteristicPartialOpen.value = true;

        // Simulate the user tapping the switch OFF — close cycle queued.
        instance.setTargetDoorState(TDS.CLOSED);
        await jest.advanceTimersByTimeAsync(SETTLE_MS);
        emitReset(device, '2');
        await jest.advanceTimersByTimeAsync(POST_RESET_DELAY_MS);
        expect(device.update).toHaveBeenNthCalledWith(2, { '3': true });
        emitReset(device, '3');
        await jest.advanceTimersByTimeAsync(0);

        expect(instance.currentDoorState).toBe(CDS.CLOSED);
        expect(instance.characteristicPartialOpen.value).toBe(false);
    });
});
