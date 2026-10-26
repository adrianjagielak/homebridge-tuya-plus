'use strict';

const CustomMultiLightAccessory = require('../lib/CustomMultiLightAccessory');
const CustomMultiOutletAccessory = require('../lib/CustomMultiOutletAccessory');
const { HAP, makeInstance, makeMockCharacteristic } = require('./support/mocks');

const { Service, Characteristic } = HAP;

const CHANNELS = [{ name: 'Ceiling', dp: 1 }, { name: 'LED', dp: 2 }];

// An accessory that actually keeps its services, so the tests can assert which
// HomeKit service type and subtype each channel ends up as.
function makeServiceStore(accessory, existing = []) {
    const makeService = (type, displayName, subtype) => {
        const chars = new Map();
        return {
            UUID: type.UUID, displayName, subtype,
            getCharacteristic: jest.fn(c => {
                if (!chars.has(c)) chars.set(c, makeMockCharacteristic());
                return chars.get(c);
            }),
        };
    };

    accessory.services = existing.map(([type, name, subtype]) => makeService(type, name, subtype));
    accessory.addService = jest.fn((type, name, subtype) => {
        const service = makeService(type, name, subtype);
        accessory.services.push(service);
        return service;
    });
    accessory.getServiceById = jest.fn((type, subtype) =>
        accessory.services.find(s => s.UUID === type.UUID && s.subtype === subtype));
    accessory.removeService = jest.fn(service => {
        accessory.services = accessory.services.filter(s => s !== service);
    });
}

function make(AccessoryClass, { outlets = CHANNELS, existing, state = { 1: false, 2: true } } = {}) {
    const built = makeInstance(AccessoryClass, state, { name: 'Hallway', type: 'CustomMultiLight', outlets });
    makeServiceStore(built.accessory, existing);
    built.instance._checkServiceName = jest.fn();
    return built;
}

const summary = accessory => accessory.services.map(s => [s.UUID, s.subtype, s.displayName]);

describe('CustomMultiLightAccessory', () => {
    test('is a LIGHTBULB accessory', () => {
        expect(CustomMultiLightAccessory.getCategory(HAP.Categories)).toBe(HAP.Categories.LIGHTBULB);
    });

    test('exposes each channel as a Lightbulb with a "light <dp>" subtype', () => {
        const { instance, accessory } = make(CustomMultiLightAccessory);
        instance._verifyCachedPlatformAccessory();

        expect(summary(accessory)).toEqual([
            [Service.Lightbulb.UUID, 'light 1', 'Ceiling - Hallway'],
            [Service.Lightbulb.UUID, 'light 2', 'LED - Hallway'],
        ]);
    });

    test('reuses cached channel services and drops channels no longer configured', () => {
        const { instance, accessory } = make(CustomMultiLightAccessory, {
            outlets: [CHANNELS[0]],
            existing: [
                [Service.AccessoryInformation, 'Hallway', undefined],
                [Service.Lightbulb, 'Ceiling - Hallway', 'light 1'],
                [Service.Lightbulb, 'Old - Hallway', 'light 7'],
            ],
        });
        const cached = accessory.services[1];

        instance._verifyCachedPlatformAccessory();

        expect(accessory.addService).not.toHaveBeenCalled();
        expect(accessory.services).toContain(cached);
        expect(summary(accessory)).toEqual([
            [Service.AccessoryInformation.UUID, undefined, 'Hallway'],
            [Service.Lightbulb.UUID, 'light 1', 'Ceiling - Hallway'],
        ]);
    });

    test('rejects a malformed channel definition', () => {
        const { instance } = make(CustomMultiLightAccessory, { outlets: [{ name: 'No DP' }] });
        expect(() => instance._verifyCachedPlatformAccessory()).toThrow(/malformed/);
    });

    describe('channel control', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        function wired() {
            const built = make(CustomMultiLightAccessory);
            built.instance._registerCharacteristics(built.device.state);
            const on = dp => built.accessory.getServiceById(Service.Lightbulb, 'light ' + dp).getCharacteristic(Characteristic.On);
            const onChange = built.device.on.mock.calls.find(([event]) => event === 'change')[1];
            return { ...built, on, onChange };
        }

        test('seeds each channel from the device state', () => {
            const { on } = wired();
            expect(on(1).value).toBe(false);
            expect(on(2).value).toBe(true);
        });

        test('a device change updates only the matching channel', () => {
            const { on, onChange } = wired();
            onChange({ 1: true });
            expect(on(1).value).toBe(true);
            expect(on(2).updateValue).toHaveBeenCalledTimes(1); // only the initial seed
        });

        test('setting a channel writes its DP', async () => {
            const { on, device } = wired();
            const setHandler = on(2).onSet.mock.calls[0][0];

            const done = setHandler(false);
            jest.advanceTimersByTime(500);
            await done;

            expect(device.update).toHaveBeenCalledWith({ 2: false });
        });
    });
});

// The channel hooks were extracted from CustomMultiOutletAccessory; its
// services must keep their exact type and subtype so paired outlets survive.
describe('CustomMultiOutletAccessory (unchanged by the channel hooks)', () => {
    test('still exposes each channel as an Outlet with an "outlet <dp>" subtype', () => {
        const { instance, accessory } = make(CustomMultiOutletAccessory);
        instance._verifyCachedPlatformAccessory();

        expect(summary(accessory)).toEqual([
            [Service.Outlet.UUID, 'outlet 1', 'Ceiling - Hallway'],
            [Service.Outlet.UUID, 'outlet 2', 'LED - Hallway'],
        ]);
    });

    test('wires the On characteristic of outlet services', () => {
        const { instance, accessory } = make(CustomMultiOutletAccessory);
        instance._registerCharacteristics(instance.device.state);
        const on = accessory.getServiceById(Service.Outlet, 'outlet 1').getCharacteristic(Characteristic.On);
        expect(on.onSet).toHaveBeenCalled();
        expect(on.value).toBe(false);
    });
});
