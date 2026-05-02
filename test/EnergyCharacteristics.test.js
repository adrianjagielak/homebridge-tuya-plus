'use strict';

const EnergyCharacteristics = require('../lib/EnergyCharacteristics');
const { HAP } = require('./support/mocks');

// The factory needs Characteristic as a base class.
// We use a minimal class that supports super(displayName, UUID) and setProps/getDefaultValue.
class MockCharacteristicBase {
    constructor(displayName, uuid) {
        this.displayName = displayName;
        this.UUID = uuid;
        this._props = {};
    }
    setProps(props) {
        this._props = { ...this._props, ...props };
        return this;
    }
    getDefaultValue() {
        return 0;
    }
}

const mockHap = {
    ...HAP,
    Characteristic: Object.assign(MockCharacteristicBase, HAP.Characteristic),
    Formats: HAP.Formats,
    Perms: HAP.Perms,
};

describe('EnergyCharacteristics', () => {
    let chars;

    beforeAll(() => {
        chars = EnergyCharacteristics(mockHap);
    });

    test('exports Amperes, KilowattHours, VoltAmperes, Volts, Watts', () => {
        expect(chars).toHaveProperty('Amperes');
        expect(chars).toHaveProperty('KilowattHours');
        expect(chars).toHaveProperty('VoltAmperes');
        expect(chars).toHaveProperty('Volts');
        expect(chars).toHaveProperty('Watts');
    });

    test('each characteristic has a UUID', () => {
        for (const [, Cls] of Object.entries(chars)) {
            expect(typeof Cls.UUID).toBe('string');
            expect(Cls.UUID.length).toBeGreaterThan(0);
        }
    });

    test('characteristics are instantiable', () => {
        for (const [name, Cls] of Object.entries(chars)) {
            const instance = new Cls();
            expect(instance.displayName).toBeTruthy();
            expect(instance.UUID).toBe(Cls.UUID);
        }
    });

    test('Amperes uses FLOAT format', () => {
        const instance = new chars.Amperes();
        expect(instance._props.format).toBe(HAP.Formats.FLOAT);
    });

    test('KilowattHours uses FLOAT format', () => {
        const instance = new chars.KilowattHours();
        expect(instance._props.format).toBe(HAP.Formats.FLOAT);
    });

    test('all UUIDs are unique', () => {
        const uuids = Object.values(chars).map(Cls => Cls.UUID);
        expect(new Set(uuids).size).toBe(uuids.length);
    });
});
