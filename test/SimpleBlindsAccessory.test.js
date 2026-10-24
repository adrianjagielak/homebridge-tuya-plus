'use strict';

const SimpleBlindsAccessory = require('../lib/SimpleBlindsAccessory');
const { HAP, makeInstance, makeMockCharacteristic } = require('./support/mocks');

const { CurrentPosition, TargetPosition } = HAP.Characteristic;

const HOUR = 60 * 60 * 1000;

// Wire up the accessory the way the platform does (first state report), and
// hand back the device 'change' listener. Each characteristic gets its own mock
// (the shared default one can't tell CurrentPosition from PositionState).
function makeBlinds(context = {}, dps = { 1: 'stop' }) {
    const { instance, device, accessory } = makeInstance(SimpleBlindsAccessory, dps, { type: 'SimpleBlinds', ...context });
    // echo writes into state like a real device, so setMultiState's
    // "already at that value" short-circuit behaves as it does in production
    device.update = jest.fn(change => { Object.assign(device.state, change); return true; });
    const chars = new Map();
    accessory._mockService.getCharacteristic = jest.fn(c => {
        if (!chars.has(c)) chars.set(c, makeMockCharacteristic());
        return chars.get(c);
    });
    instance._registerCharacteristics(dps);
    const onChange = device.on.mock.calls.find(([event]) => event === 'change')[1];
    return { instance, device, onChange, current: chars.get(CurrentPosition), target: chars.get(TargetPosition) };
}

beforeEach(() => jest.useFakeTimers({ now: new Date('2026-10-24T08:00:00Z') }));
afterEach(() => jest.useRealTimers());

// ---------------------------------------------------------------------------
// The time-based position estimate must stay within the physical travel range.
// A stale changeTime (the device never echoed the command because its DP
// already held that value) used to extrapolate to values like 147382, which
// HomeKit rejects — breaking percentage control.
// ---------------------------------------------------------------------------
describe('SimpleBlindsAccessory position estimate', () => {
    test('a stop long after opening started reports fully open, not >100', () => {
        const { instance, onChange, current, target } = makeBlinds();
        instance.assumedState = 'opening';
        instance.changeTime = Date.now() - 18 * HOUR;

        onChange({ 1: 'stop' });

        expect(current.value).toBe(100);
        expect(target.value).toBe(100);
        expect(instance.assumedPosition).toBe(100);
    });

    test('a stop long after closing started reports fully closed, not <0', () => {
        const { instance, onChange, current, target } = makeBlinds();
        instance.assumedState = 'closing';
        instance.changeTime = Date.now() - 18 * HOUR;

        onChange({ 1: 'stop' });

        expect(current.value).toBe(0);
        expect(target.value).toBe(0);
        expect(instance.assumedPosition).toBe(0);
    });

    test('a stop mid-travel still reports the proportional position', () => {
        const { instance, onChange, current } = makeBlinds({ timeToOpen: 40 });
        instance.assumedState = 'opening';
        instance.changeTime = Date.now() - 10 * 1000; // 10s of a 40s run

        onChange({ 1: 'stop' });

        expect(current.value).toBe(25);
    });

    test('closing clamps to minPosition when timeToTighten is set', () => {
        const { instance, onChange } = makeBlinds({ timeToOpen: 45, timeToTighten: 5 });
        instance.assumedState = 'closing';
        instance.changeTime = Date.now() - 18 * HOUR;

        onChange({ 1: 'stop' });

        expect(instance.assumedPosition).toBe(instance.minPosition);
    });

    test('setting a percentage after a stale run moves from the real end position', async () => {
        const { instance, device } = makeBlinds({ timeToOpen: 40 });
        instance.assumedState = 'opening';
        instance.changeTime = Date.now() - 18 * HOUR;

        await instance.setTargetPosition(50);

        expect(instance.assumedPosition).toBe(100);
        expect(device.update).toHaveBeenLastCalledWith({ 1: 'close' });

        // 50% of a 40s run, not hours
        jest.advanceTimersByTime(20 * 1000);
        expect(device.update).toHaveBeenLastCalledWith({ 1: 'stop' });
    });

    test('reported positions are clamped to the HomeKit 0–100 range', () => {
        const { instance } = makeBlinds({ timeToOpen: 45, timeToTighten: 5 });

        instance.assumedPosition = 368;
        expect(instance._getCurrentPosition('stop')).toBe(100);
        expect(instance._getTargetPosition('stop')).toBe(100);

        instance.assumedPosition = instance.minPosition;
        expect(instance._getCurrentPosition('stop')).toBe(0);
        expect(instance._getTargetPosition('stop')).toBe(0);
    });
});
