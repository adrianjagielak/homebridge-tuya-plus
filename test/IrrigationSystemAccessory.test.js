'use strict';

const IrrigationSystemAccessory = require('../lib/IrrigationSystemAccessory');
const { HAP } = require('./support/mocks');

const { Service, Characteristic } = HAP;

/* ------------------------------------------------------------------ *
 *  A richer mock harness than support/mocks.js — it models distinct
 *  characteristics per type and real add/get/getById service handling
 *  so we can exercise the full irrigation flow (timers, batching,
 *  cascade, aggregation, device-change reflection).
 * ------------------------------------------------------------------ */

function makeChar(uuid) {
    return {
        UUID: uuid,
        value: null,
        props: { perms: [] },
        _handlers: {},
        updateValue(v) { this.value = v; return this; },
        setValue(v) { this.value = v; return this; },
        setProps(p) { Object.assign(this.props, p); return this; },
        onGet(fn) { this._handlers.get = fn; return this; },
        onSet(fn) { this._handlers.set = fn; return this; },
        on(ev, fn) { this._handlers[ev] = fn; return this; },
        // Test helpers
        triggerSet(v) { return this._handlers.set && this._handlers.set(v); },
        triggerGet() { return this._handlers.get && this._handlers.get(); },
    };
}

function makeService(uuid, displayName, subtype) {
    return {
        UUID: uuid,
        displayName: displayName || 'Service',
        subtype: subtype || null,
        characteristics: [],
        isPrimary: false,
        linked: [],
        _chars: {},
        getCharacteristic(type) {
            const key = type.UUID;
            if (!this._chars[key]) {
                const c = makeChar(type.UUID);
                this._chars[key] = c;
                this.characteristics.push(c);
            }
            return this._chars[key];
        },
        addCharacteristic(type) { return this.getCharacteristic(type); },
        setCharacteristic(type, value) { this.getCharacteristic(type).updateValue(value); return this; },
        updateCharacteristic(type, value) { this.getCharacteristic(type).updateValue(value); return this; },
        removeCharacteristic() {},
        setPrimaryService(v = true) { this.isPrimary = v; },
        addLinkedService(s) { if (!this.linked.includes(s)) this.linked.push(s); },
        removeLinkedService(s) { this.linked = this.linked.filter(x => x !== s); },
    };
}

function makeAccessory(context = {}) {
    const services = [];
    return {
        services,
        context,
        on() {},
        getService(type) {
            const uuid = type.UUID || type;
            return services.find(s => s.UUID === uuid && !s.subtype) || services.find(s => s.UUID === uuid);
        },
        getServiceById(type, subtype) {
            const uuid = type.UUID || type;
            return services.find(s => s.UUID === uuid && s.subtype === subtype);
        },
        addService(type, displayName, subtype) {
            const s = makeService(type.UUID, displayName, subtype);
            services.push(s);
            return s;
        },
        removeService(s) {
            const i = services.indexOf(s);
            if (i >= 0) services.splice(i, 1);
        },
        configureController() {},
    };
}

function makeHarness(state = {}, context = {}) {
    const log = Object.assign(jest.fn(), { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });
    const platform = {
        log,
        api: { hap: HAP, versionGreaterOrEqual: () => false },
        registerPlatformAccessories: jest.fn(),
    };
    const changeHandlers = [];
    const device = {
        connected: true,
        state: { ...state },
        context: { name: 'Sprinklers', id: '12345678abcdef', type: 'irrigationsystem', version: '3.3', ...context },
        update: jest.fn(function (dps) { Object.assign(this.state, dps); return true; }),
        on: jest.fn((ev, fn) => { if (ev === 'change') changeHandlers.push(fn); }),
        once: jest.fn(),
        _connect: jest.fn(),
        emitChange(changes) {
            Object.assign(this.state, changes);
            changeHandlers.forEach(h => h(changes, this.state));
        },
    };
    const accessory = makeAccessory({});
    const instance = new IrrigationSystemAccessory(platform, accessory, device, false);
    // Drive the lifecycle (isNew=false skips it in the constructor).
    instance._registerCharacteristics(device.state);
    return { instance, platform, device, accessory };
}

const valve = (accessory, dp) => accessory.getServiceById(Service.Valve, 'valve-' + dp);
const irrigation = (accessory) => accessory.getService(Service.IrrigationSystem);

/* ============================== Tests ============================== */

describe('IrrigationSystemAccessory — category', () => {
    test('resolves to SPRINKLER', () => {
        expect(IrrigationSystemAccessory.getCategory(HAP.Categories)).toBe(HAP.Categories.SPRINKLER);
    });
});

describe('IrrigationSystemAccessory — service topology', () => {
    test('builds an IrrigationSystem (primary) + 4 linked valves + battery + contact sensor by default', () => {
        const { accessory } = makeHarness({ '1': false, '2': false, '3': false, '4': false, '46': 80, '49': 'no_rain' });

        const irr = irrigation(accessory);
        expect(irr).toBeDefined();
        expect(irr.isPrimary).toBe(true);

        const valves = accessory.services.filter(s => s.UUID === Service.Valve.UUID);
        expect(valves).toHaveLength(4);

        // All four valves are linked to the irrigation system.
        expect(irr.linked).toHaveLength(4);

        // Battery + ContactSensor present; LeakSensor absent.
        expect(accessory.getService(Service.Battery)).toBeDefined();
        expect(accessory.getService(Service.ContactSensor)).toBeDefined();
        expect(accessory.getService(Service.LeakSensor)).toBeUndefined();
    });

    test('valves carry IRRIGATION type, CONFIGURED, and sequential ServiceLabelIndex', () => {
        const { accessory } = makeHarness({ '1': false, '2': false, '3': false, '4': false });
        [1, 2, 3, 4].forEach(dp => {
            const v = valve(accessory, dp);
            expect(v.getCharacteristic(Characteristic.ValveType).value).toBe(Characteristic.ValveType.IRRIGATION);
            expect(v.getCharacteristic(Characteristic.IsConfigured).value).toBe(Characteristic.IsConfigured.CONFIGURED);
            expect(v.getCharacteristic(Characteristic.ServiceLabelIndex).value).toBe(dp);
        });
    });

    test('IrrigationSystem advertises the required characteristics', () => {
        const { accessory } = makeHarness({ '1': false });
        const irr = irrigation(accessory);
        expect(irr.getCharacteristic(Characteristic.ProgramMode).value).toBe(Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED);
        expect(irr.getCharacteristic(Characteristic.Active).value).toBe(Characteristic.Active.INACTIVE);
        expect(irr.getCharacteristic(Characteristic.InUse).value).toBe(Characteristic.InUse.NOT_IN_USE);
    });

    test('noBattery / noRainSensor omit those services', () => {
        const { accessory } = makeHarness({ '1': false }, { noBattery: true, noRainSensor: true });
        expect(accessory.getService(Service.Battery)).toBeUndefined();
        expect(accessory.getService(Service.ContactSensor)).toBeUndefined();
        expect(accessory.getService(Service.LeakSensor)).toBeUndefined();
    });

    test('rainSensorType "leak" uses a LeakSensor instead of a ContactSensor', () => {
        const { accessory } = makeHarness({ '49': 'rain' }, { rainSensorType: 'leak' });
        expect(accessory.getService(Service.LeakSensor)).toBeDefined();
        expect(accessory.getService(Service.ContactSensor)).toBeUndefined();
    });
});

describe('IrrigationSystemAccessory — valve configuration', () => {
    test('defaults to four zones A–D on DP 1–4', () => {
        const { instance } = makeHarness();
        const cfgs = instance._getValveConfigs();
        expect(cfgs).toHaveLength(4);
        expect(cfgs.map(c => c.dp)).toEqual(['1', '2', '3', '4']);
        expect(cfgs.map(c => c.name)).toEqual(['Valve A', 'Valve B', 'Valve C', 'Valve D']);
    });

    test('valveCount controls the number of zones', () => {
        const { instance } = makeHarness({}, { valveCount: 2 });
        expect(instance._getValveConfigs().map(c => c.dp)).toEqual(['1', '2']);
    });

    test('a custom valves array maps names + data-points', () => {
        const { instance } = makeHarness({}, {
            valves: [{ name: 'Lawn', dp: 5 }, { name: 'Beds', dp: 7, defaultDuration: 1200 }],
        });
        const cfgs = instance._getValveConfigs();
        expect(cfgs).toHaveLength(2);
        expect(cfgs[0]).toMatchObject({ dp: '5', name: 'Lawn', index: 1 });
        expect(cfgs[1]).toMatchObject({ dp: '7', name: 'Beds', index: 2, duration: 1200 });
    });
});

describe('IrrigationSystemAccessory — valve activation & timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('turning a zone on writes the DP (debounced) and starts the countdown', async () => {
        const { accessory, device } = makeHarness({ '1': false }, { defaultDuration: 600 });
        const v = valve(accessory, 1);

        v.getCharacteristic(Characteristic.Active).triggerSet(1);

        // Optimistic UI updates immediately…
        expect(v.getCharacteristic(Characteristic.Active).value).toBe(1);
        expect(v.getCharacteristic(Characteristic.InUse).value).toBe(1);
        expect(v.getCharacteristic(Characteristic.RemainingDuration).value).toBe(600);
        // …but the device write is debounced.
        expect(device.update).not.toHaveBeenCalled();

        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenCalledWith({ '1': true });
    });

    test('the zone auto-shuts-off when the timer expires', () => {
        const { accessory, device } = makeHarness({ '1': false }, { defaultDuration: 60 });
        const v = valve(accessory, 1);
        v.getCharacteristic(Characteristic.Active).triggerSet(1);

        jest.advanceTimersByTime(500);     // flush the on-write
        expect(device.update).toHaveBeenLastCalledWith({ '1': true });

        jest.advanceTimersByTime(60 * 1000); // duration elapses
        expect(v.getCharacteristic(Characteristic.Active).value).toBe(0);
        expect(v.getCharacteristic(Characteristic.InUse).value).toBe(0);

        jest.advanceTimersByTime(500);     // flush the off-write
        expect(device.update).toHaveBeenLastCalledWith({ '1': false });
    });

    test('RemainingDuration counts down from the stored end time', () => {
        const { accessory } = makeHarness({ '1': false }, { defaultDuration: 600 });
        const v = valve(accessory, 1);
        v.getCharacteristic(Characteristic.Active).triggerSet(1);

        jest.advanceTimersByTime(120 * 1000);
        const remaining = v.getCharacteristic(Characteristic.RemainingDuration).triggerGet();
        expect(remaining).toBeGreaterThanOrEqual(479);
        expect(remaining).toBeLessThanOrEqual(480);
    });

    test('a duration of 0 runs indefinitely — no timer, no countdown', () => {
        const { accessory, device } = makeHarness({ '1': false }, { defaultDuration: 0 });
        const v = valve(accessory, 1);
        v.getCharacteristic(Characteristic.Active).triggerSet(1);
        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenCalledWith({ '1': true });

        // Far in the future, the zone is still running and never auto-closed.
        jest.advanceTimersByTime(24 * 3600 * 1000);
        expect(v.getCharacteristic(Characteristic.InUse).value).toBe(1);
        expect(v.getCharacteristic(Characteristic.RemainingDuration).value).toBe(0);
        expect(device.update).toHaveBeenCalledTimes(1); // never wrote an "off"
    });

    test('turning a running zone off clears the timer and writes false', () => {
        const { accessory, device } = makeHarness({ '1': false }, { defaultDuration: 600 });
        const v = valve(accessory, 1);
        v.getCharacteristic(Characteristic.Active).triggerSet(1);
        jest.advanceTimersByTime(500);

        v.getCharacteristic(Characteristic.Active).triggerSet(0);
        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenLastCalledWith({ '1': false });
        expect(v.getCharacteristic(Characteristic.RemainingDuration).value).toBe(0);

        // The original auto-off timer must not fire later.
        const calls = device.update.mock.calls.length;
        jest.advanceTimersByTime(600 * 1000);
        expect(device.update.mock.calls.length).toBe(calls);
    });
});

describe('IrrigationSystemAccessory — write batching (one Tuya command)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('two zones toggled within the window collapse into a single device.update', () => {
        const { accessory, device } = makeHarness({ '1': false, '2': false }, { defaultDuration: 0 });
        valve(accessory, 1).getCharacteristic(Characteristic.Active).triggerSet(1);
        valve(accessory, 2).getCharacteristic(Characteristic.Active).triggerSet(1);

        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '1': true, '2': true });
    });

    test('writes are dropped when the device is offline', () => {
        const { accessory, device } = makeHarness({ '1': false }, { defaultDuration: 0 });
        device.connected = false;
        valve(accessory, 1).getCharacteristic(Characteristic.Active).triggerSet(1);
        jest.advanceTimersByTime(500);
        expect(device.update).not.toHaveBeenCalled();
    });
});

describe('IrrigationSystemAccessory — master (whole-system) toggle', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('system OFF closes every open zone in one command', () => {
        const { accessory, device } = makeHarness({ '1': true, '2': true, '3': false, '4': false }, { defaultDuration: 0 });
        irrigation(accessory).getCharacteristic(Characteristic.Active).triggerSet(0);
        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '1': false, '2': false });
    });

    test('system ON opens every closed zone in one command', () => {
        const { accessory, device } = makeHarness({ '1': false, '2': false, '3': false, '4': false }, { defaultDuration: 0 });
        irrigation(accessory).getCharacteristic(Characteristic.Active).triggerSet(1);
        jest.advanceTimersByTime(500);
        expect(device.update).toHaveBeenCalledTimes(1);
        expect(device.update).toHaveBeenCalledWith({ '1': true, '2': true, '3': true, '4': true });
    });

    test('masterTurnsOnAllZones=false makes ON a passive enable (no writes)', () => {
        const { accessory, device } = makeHarness({ '1': false, '2': false }, { masterTurnsOnAllZones: false });
        irrigation(accessory).getCharacteristic(Characteristic.Active).triggerSet(1);
        jest.advanceTimersByTime(500);
        expect(device.update).not.toHaveBeenCalled();
    });
});

describe('IrrigationSystemAccessory — aggregation', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('the system reports IN_USE/ACTIVE whenever a zone runs', () => {
        const { accessory } = makeHarness({ '1': false }, { defaultDuration: 600 });
        const irr = irrigation(accessory);
        expect(irr.getCharacteristic(Characteristic.InUse).value).toBe(Characteristic.InUse.NOT_IN_USE);

        valve(accessory, 1).getCharacteristic(Characteristic.Active).triggerSet(1);
        expect(irr.getCharacteristic(Characteristic.InUse).value).toBe(Characteristic.InUse.IN_USE);
        expect(irr.getCharacteristic(Characteristic.Active).value).toBe(Characteristic.Active.ACTIVE);
    });
});

describe('IrrigationSystemAccessory — device-side change reflection', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

    test('a physical switch toggle is mirrored into HomeKit and arms the timer', () => {
        const { accessory, device } = makeHarness({ '1': false }, { defaultDuration: 600 });
        const v = valve(accessory, 1);

        device.emitChange({ '1': true });
        expect(v.getCharacteristic(Characteristic.Active).value).toBe(1);
        expect(v.getCharacteristic(Characteristic.InUse).value).toBe(1);
        expect(v.getCharacteristic(Characteristic.RemainingDuration).value).toBe(600);
    });

    test('battery + rain telemetry updates the corresponding characteristics', () => {
        const { accessory, device } = makeHarness({ '46': 80, '49': 'no_rain' });
        device.emitChange({ '46': 10, '49': 'rain' });

        const battery = accessory.getService(Service.Battery);
        expect(battery.getCharacteristic(Characteristic.BatteryLevel).value).toBe(10);
        expect(battery.getCharacteristic(Characteristic.StatusLowBattery).value).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);

        const contact = accessory.getService(Service.ContactSensor);
        expect(contact.getCharacteristic(Characteristic.ContactSensorState).value).toBe(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    });
});

describe('IrrigationSystemAccessory — battery mapping', () => {
    test('clamps the level into 0–100', () => {
        const { instance } = makeHarness();
        expect(instance._batteryLevel(150)).toBe(100);
        expect(instance._batteryLevel(-5)).toBe(0);
        expect(instance._batteryLevel('42')).toBe(42);
        expect(instance._batteryLevel(undefined)).toBe(0);
    });

    test('low-battery threshold (default 20%) is inclusive', () => {
        const { instance } = makeHarness();
        expect(instance._lowBattery(21)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        expect(instance._lowBattery(20)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
        expect(instance._lowBattery(5)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    });

    test('the low-battery threshold is configurable', () => {
        const { instance } = makeHarness({}, { lowBatteryThreshold: 10 });
        expect(instance._lowBattery(15)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
        expect(instance._lowBattery(10)).toBe(Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW);
    });
});

describe('IrrigationSystemAccessory — charging state', () => {
    test('maps the charging data-point: true → CHARGING, false → NOT_CHARGING', () => {
        const { instance } = makeHarness();
        expect(instance._chargingState(true)).toBe(Characteristic.ChargingState.CHARGING);
        expect(instance._chargingState(false)).toBe(Characteristic.ChargingState.NOT_CHARGING);
    });

    test('falls back to NOT_CHARGEABLE when the device reports no charging data-point', () => {
        const { instance } = makeHarness();
        expect(instance._chargingState(undefined)).toBe(Characteristic.ChargingState.NOT_CHARGEABLE);
    });

    test('reflects the initial charging data-point onto the Battery service', () => {
        const { accessory } = makeHarness({ '46': 80, '101': true });
        const battery = accessory.getService(Service.Battery);
        expect(battery.getCharacteristic(Characteristic.ChargingState).value).toBe(Characteristic.ChargingState.CHARGING);
    });

    test('updates ChargingState when the device reports a charging change', () => {
        const { accessory, device } = makeHarness({ '46': 80, '101': false });
        const battery = accessory.getService(Service.Battery);
        expect(battery.getCharacteristic(Characteristic.ChargingState).value).toBe(Characteristic.ChargingState.NOT_CHARGING);

        device.emitChange({ '101': true });
        expect(battery.getCharacteristic(Characteristic.ChargingState).value).toBe(Characteristic.ChargingState.CHARGING);
    });
});

describe('IrrigationSystemAccessory — rain mapping', () => {
    test('contact sensor: rain → NOT_DETECTED, no_rain → DETECTED', () => {
        const { instance } = makeHarness();
        expect(instance._contactState('rain')).toBe(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        expect(instance._contactState('no_rain')).toBe(Characteristic.ContactSensorState.CONTACT_DETECTED);
    });

    test('rainInverted flips the polarity', () => {
        const { instance } = makeHarness({}, { rainInverted: true });
        expect(instance._contactState('rain')).toBe(Characteristic.ContactSensorState.CONTACT_DETECTED);
        expect(instance._contactState('no_rain')).toBe(Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    });

    test('leak sensor maps rain → detected', () => {
        const { instance } = makeHarness({}, { rainSensorType: 'leak' });
        expect(instance._rainDetected('rain')).toBe(true);
        expect(instance._rainDetected('no_rain')).toBe(false);
    });
});
