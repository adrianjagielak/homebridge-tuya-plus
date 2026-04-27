'use strict';

const MultiOutletAccessory = require('../lib/MultiOutletAccessory');
const { makeInstance } = require('./support/mocks');

function makeOutlet(state = {}) {
    return makeInstance(MultiOutletAccessory, state);
}

describe('MultiOutletAccessory.getPower', () => {
    test('returns the current DP value from device state', () => {
        const { instance } = makeOutlet({ '1': true, '2': false });
        expect(instance.getPower('1')).toBe(true);
        expect(instance.getPower('2')).toBe(false);
    });

    test('throws when device is disconnected', () => {
        const { instance, device } = makeOutlet();
        device.connected = false;
        expect(() => instance.getPower('1')).toThrow('Not connected');
    });
});

describe('MultiOutletAccessory.setPower — debounce batching', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('does not call device.update before the debounce timer fires', () => {
        const { instance, device } = makeOutlet({ '1': false });
        instance.setPower('1', true);
        expect(device.update).not.toHaveBeenCalled();
    });

    test('calls device.update after 500ms', async () => {
        const { instance, device } = makeOutlet({ '1': false });
        const p = instance.setPower('1', true);
        jest.advanceTimersByTime(500);
        await p;
        expect(device.update).toHaveBeenCalledWith({ '1': true });
    });

    test('batches two setPower calls within the window into one setMultiStateAsync', async () => {
        const { instance, device } = makeOutlet({ '1': false, '2': true });
        const p1 = instance.setPower('1', true);
        const p2 = instance.setPower('2', false);
        jest.advanceTimersByTime(500);
        await Promise.all([p1, p2]);
        expect(device.update).toHaveBeenCalledTimes(2);
        expect(device.update).toHaveBeenCalledWith({ '1': true });
        expect(device.update).toHaveBeenCalledWith({ '2': false });
    });

    test('a second call within the window resets the timer', async () => {
        const { instance, device } = makeOutlet({ '1': false, '2': true });
        instance.setPower('1', true);
        jest.advanceTimersByTime(300);
        // Timer has not fired yet — a second call resets it
        const p2 = instance.setPower('2', false);
        jest.advanceTimersByTime(300);
        // First timer (300ms after first call) should not have fired
        expect(device.update).not.toHaveBeenCalled();
        jest.advanceTimersByTime(200);
        await p2;
        // Now the reset timer (500ms after second call) fires
        expect(device.update).toHaveBeenCalledTimes(2);
    });

    test('the returned Promise resolves when the batch fires', async () => {
        const { instance } = makeOutlet({ '1': false });
        let resolved = false;
        const p = instance.setPower('1', true).then(() => { resolved = true; });
        expect(resolved).toBe(false);
        jest.advanceTimersByTime(500);
        await p;
        expect(resolved).toBe(true);
    });

    test('skips update when value already matches state (setMultiStateAsync optimisation)', async () => {
        // DP '1' is already true — no update should be sent
        const { instance, device } = makeOutlet({ '1': true });
        const p = instance.setPower('1', true);
        jest.advanceTimersByTime(500);
        await p;
        expect(device.update).not.toHaveBeenCalled();
    });
});
