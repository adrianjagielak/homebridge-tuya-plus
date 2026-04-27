'use strict';

const GarageDoorAccessory = require('../lib/GarageDoorAccessory');
const { HAP, makeInstance } = require('./support/mocks');

const { CurrentDoorState: CDS, TargetDoorState: TDS } = HAP.Characteristic;

// Helper: create an instance with manufacturer pre-configured and
// all the state fields that _registerCharacteristics would normally set.
function makeGarage(manufacturer = 'Generic', flipState = false) {
    const { instance, device } = makeInstance(GarageDoorAccessory, {}, { manufacturer });

    // Replicate what _registerCharacteristics sets
    instance.manufacturer = manufacturer.trim();
    instance.dpAction = manufacturer === 'Kogan' ? '101' : '1';
    instance.dpStatus = manufacturer === 'Kogan' ? '102' : '2';

    instance.currentOpen    = flipState ? CDS.CLOSED   : CDS.OPEN;
    instance.currentOpening = flipState ? CDS.CLOSING  : CDS.OPENING;
    instance.currentClosing = flipState ? CDS.OPENING  : CDS.CLOSING;
    instance.currentClosed  = flipState ? CDS.OPEN     : CDS.CLOSED;
    instance.currentStopped = CDS.STOPPED;
    instance.targetOpen     = flipState ? TDS.CLOSED   : TDS.OPEN;
    instance.targetClosed   = flipState ? TDS.OPEN     : TDS.CLOSED;

    return { instance, device };
}

// ---------------------------------------------------------------------------
// _getTargetDoorState
// ---------------------------------------------------------------------------
describe('GarageDoorAccessory._getTargetDoorState — generic (boolean)', () => {
    test('true → targetOpen', () => {
        const { instance } = makeGarage('Generic');
        expect(instance._getTargetDoorState(true)).toBe(TDS.OPEN);
    });

    test('false → targetClosed', () => {
        const { instance } = makeGarage('Generic');
        expect(instance._getTargetDoorState(false)).toBe(TDS.CLOSED);
    });
});

describe('GarageDoorAccessory._getTargetDoorState — Kogan (string)', () => {
    let instance;
    beforeEach(() => ({ instance } = makeGarage('Kogan')));

    test('"opened" → targetOpen', () => expect(instance._getTargetDoorState('opened')).toBe(TDS.OPEN));
    test('"openning" → targetOpen', () => expect(instance._getTargetDoorState('openning')).toBe(TDS.OPEN));
    test('"opening" → targetOpen', () => expect(instance._getTargetDoorState('opening')).toBe(TDS.OPEN));
    test('"closed" → targetClosed', () => expect(instance._getTargetDoorState('closed')).toBe(TDS.CLOSED));
    test('"closing" → targetClosed', () => expect(instance._getTargetDoorState('closing')).toBe(TDS.CLOSED));
});

// ---------------------------------------------------------------------------
// _getCurrentDoorState
// ---------------------------------------------------------------------------
describe('GarageDoorAccessory._getCurrentDoorState — generic (boolean)', () => {
    test('true → currentOpen', () => {
        const { instance } = makeGarage('Generic');
        expect(instance._getCurrentDoorState(true)).toBe(CDS.OPEN);
    });

    test('false → currentClosed', () => {
        const { instance } = makeGarage('Generic');
        expect(instance._getCurrentDoorState(false)).toBe(CDS.CLOSED);
    });
});

describe('GarageDoorAccessory._getCurrentDoorState — Kogan (string)', () => {
    let instance;
    beforeEach(() => ({ instance } = makeGarage('Kogan')));

    test('"opened" → OPEN',    () => expect(instance._getCurrentDoorState('opened')).toBe(CDS.OPEN));
    test('"openning" → OPENING', () => expect(instance._getCurrentDoorState('openning')).toBe(CDS.OPENING));
    test('"opening" → OPENING',  () => expect(instance._getCurrentDoorState('opening')).toBe(CDS.OPENING));
    test('"closing" → CLOSING',  () => expect(instance._getCurrentDoorState('closing')).toBe(CDS.CLOSING));
    test('"closed" → CLOSED',    () => expect(instance._getCurrentDoorState('closed')).toBe(CDS.CLOSED));
});

// ---------------------------------------------------------------------------
// setTargetDoorState — device command
// ---------------------------------------------------------------------------
describe('GarageDoorAccessory.setTargetDoorState — generic', () => {
    test('OPEN sends true to dpAction', () => {
        const { instance, device } = makeGarage('Generic');
        device.state['1'] = false;
        instance.setTargetDoorState(TDS.OPEN);
        expect(device.update).toHaveBeenCalledWith({ '1': true });
    });

    test('CLOSED sends false to dpAction', () => {
        const { instance, device } = makeGarage('Generic');
        device.state['1'] = true;
        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenCalledWith({ '1': false });
    });
});

describe('GarageDoorAccessory.setTargetDoorState — Kogan', () => {
    test('OPEN sends "open" to dpAction (101)', () => {
        const { instance, device } = makeGarage('Kogan');
        device.state['101'] = 'closed';
        instance.setTargetDoorState(TDS.OPEN);
        expect(device.update).toHaveBeenCalledWith({ '101': 'open' });
    });

    test('CLOSED sends "close" to dpAction (101)', () => {
        const { instance, device } = makeGarage('Kogan');
        device.state['101'] = 'opened';
        instance.setTargetDoorState(TDS.CLOSED);
        expect(device.update).toHaveBeenCalledWith({ '101': 'close' });
    });
});

// ---------------------------------------------------------------------------
// flipState
// ---------------------------------------------------------------------------
describe('GarageDoorAccessory with flipState', () => {
    test('inverts currentOpen/currentClosed', () => {
        const { instance } = makeGarage('Generic', true);
        expect(instance.currentOpen).toBe(CDS.CLOSED);
        expect(instance.currentClosed).toBe(CDS.OPEN);
    });

    test('inverts targetOpen/targetClosed', () => {
        const { instance } = makeGarage('Generic', true);
        expect(instance.targetOpen).toBe(TDS.CLOSED);
        expect(instance.targetClosed).toBe(TDS.OPEN);
    });
});
