'use strict';

const PercentBlindsAccessory = require('../lib/PercentBlindsAccessory');
const { HAP, makeInstance } = require('./support/mocks');

const { PositionState: PS } = HAP.Characteristic;

// Helper: build an instance and set the fields _registerCharacteristics would
// normally populate, so the pure helpers can be tested without wiring up the
// mock WindowCovering service (whose getCharacteristic returns a single shared
// mock, indistinguishable per-characteristic).
function makeBlinds({ flipState = false, opening, closing } = {}) {
    const { instance, device } = makeInstance(PercentBlindsAccessory, {}, { type: 'PercentBlinds' });

    const toList = (value, fallback) => (value === undefined ? fallback : [].concat(value)).map(v => ('' + v).toLowerCase());
    instance.flipState = flipState;
    instance._openingValues = toList(opening, ['opening', 'open', 'up']);
    instance._closingValues = toList(closing, ['closing', 'close', 'down']);

    return { instance, device };
}

// ---------------------------------------------------------------------------
// _workStateToPositionState — direction mapping
// ---------------------------------------------------------------------------
describe('PercentBlindsAccessory._workStateToPositionState — defaults', () => {
    let instance;
    beforeEach(() => ({ instance } = makeBlinds()));

    test('"opening" → INCREASING', () => expect(instance._workStateToPositionState('opening')).toBe(PS.INCREASING));
    test('"open" → INCREASING',    () => expect(instance._workStateToPositionState('open')).toBe(PS.INCREASING));
    test('"up" → INCREASING',      () => expect(instance._workStateToPositionState('up')).toBe(PS.INCREASING));
    test('"closing" → DECREASING', () => expect(instance._workStateToPositionState('closing')).toBe(PS.DECREASING));
    test('"close" → DECREASING',   () => expect(instance._workStateToPositionState('close')).toBe(PS.DECREASING));
    test('"down" → DECREASING',    () => expect(instance._workStateToPositionState('down')).toBe(PS.DECREASING));
    test('unknown value → STOPPED', () => expect(instance._workStateToPositionState('paused')).toBe(PS.STOPPED));
    test('mixed case "OPENING" → INCREASING', () => expect(instance._workStateToPositionState('OPENING')).toBe(PS.INCREASING));
});

describe('PercentBlindsAccessory._workStateToPositionState — flipState inverts direction', () => {
    let instance;
    beforeEach(() => ({ instance } = makeBlinds({ flipState: true })));

    test('"opening" → DECREASING', () => expect(instance._workStateToPositionState('opening')).toBe(PS.DECREASING));
    test('"closing" → INCREASING', () => expect(instance._workStateToPositionState('closing')).toBe(PS.INCREASING));
    test('unknown value stays STOPPED', () => expect(instance._workStateToPositionState('paused')).toBe(PS.STOPPED));
});

describe('PercentBlindsAccessory._workStateToPositionState — custom work-state values', () => {
    test('custom opening/closing tokens are honoured', () => {
        const { instance } = makeBlinds({ opening: 'FZ', closing: 'ZF' });
        expect(instance._workStateToPositionState('fz')).toBe(PS.INCREASING);
        expect(instance._workStateToPositionState('zf')).toBe(PS.DECREASING);
        // the built-in defaults no longer apply once overridden
        expect(instance._workStateToPositionState('opening')).toBe(PS.STOPPED);
    });
});

// ---------------------------------------------------------------------------
// _mapPosition — flip handling
// ---------------------------------------------------------------------------
describe('PercentBlindsAccessory._mapPosition', () => {
    test('passes value through when not flipped', () => {
        const { instance } = makeBlinds();
        expect(instance._mapPosition(0)).toBe(0);
        expect(instance._mapPosition(30)).toBe(30);
        expect(instance._mapPosition(100)).toBe(100);
    });

    test('inverts value when flipped', () => {
        const { instance } = makeBlinds({ flipState: true });
        expect(instance._mapPosition(0)).toBe(100);
        expect(instance._mapPosition(30)).toBe(70);
        expect(instance._mapPosition(100)).toBe(0);
    });

    test('coerces string data-point values', () => {
        const { instance } = makeBlinds();
        expect(instance._mapPosition('45')).toBe(45);
    });
});
