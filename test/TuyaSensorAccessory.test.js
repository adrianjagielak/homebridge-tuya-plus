'use strict';

const EventEmitter = require('events');
const ContactSensorAccessory = require('../lib/ContactSensorAccessory');
const SmokeSensorAccessory = require('../lib/SmokeSensorAccessory');
const LeakSensorAccessory = require('../lib/LeakSensorAccessory');
const TuyaCloudDevice = require('../lib/TuyaCloudDevice');
const {HAP, makeInstance, makeMockService, makeMockCharacteristic} = require('./support/mocks');

const TYPES = [ContactSensorAccessory, SmokeSensorAccessory, LeakSensorAccessory];

function sensorFixture(Type, state, context = {}) {
    const fixture = makeInstance(Type, state, context);
    const services = new Map();
    function service(type, name) {
        const result = makeMockService(type.UUID);
        result.displayName = name;
        result.chars = new Map();
        result.getCharacteristic.mockImplementation(characteristic => {
            if (!result.chars.has(characteristic.UUID)) result.chars.set(characteristic.UUID, makeMockCharacteristic());
            return result.chars.get(characteristic.UUID);
        });
        services.set(type.UUID, result);
        return result;
    }
    service(HAP.Service[Type.sensor.service], fixture.device.context.name);
    fixture.accessory.getService.mockImplementation(type => services.get(type.UUID));
    fixture.accessory.addService.mockImplementation(service);
    fixture.instance._registerCharacteristics(state);
    const callback = fixture.device.on.mock.calls.find(([event]) => event === 'change')[1];
    const change = updates => {
        Object.assign(fixture.device.state, updates);
        callback(updates, {...fixture.device.state});
    };
    const characteristic = (serviceName, characteristicName) =>
        services.get(HAP.Service[serviceName].UUID).chars.get(HAP.Characteristic[characteristicName].UUID);
    const main = characteristic(Type.sensor.service, Type.sensor.characteristic);
    const read = char => char.onGet.mock.calls[0][0]();
    return {...fixture, services, change, characteristic, main, read};
}

describe.each(TYPES)('%s read-only sensor', Type => {
    const code = Type.sensor.codes[0];
    const initial = Type === ContactSensorAccessory ? false : 'normal';

    test('creates its service and registers one accessory', () => {
        const {instance, accessory, platform} = makeInstance(Type);
        instance._registerPlatformAccessory();
        expect(accessory.addService).toHaveBeenCalledWith(HAP.Service[Type.sensor.service], 'Test Device');
        expect(platform.registerPlatformAccessories).toHaveBeenCalledTimes(1);
    });

    test('has no battery service until battery telemetry is reported', () => {
        const {services} = sensorFixture(Type, {[code]: initial});
        expect(services.has(HAP.Service.Battery.UUID)).toBe(false);
    });

    test('keeps state through unrelated partial updates and never writes commands', async () => {
        const {main, read, change, device} = sensorFixture(Type, {[code]: initial});
        change({unrelated: 50});
        await expect(read(main)).resolves.toBe(0);
        expect(main.onSet).not.toHaveBeenCalled();
        expect(device.update).not.toHaveBeenCalled();
    });

    test('does not turn an unknown or missing reading into a safe state', async () => {
        const fixture = sensorFixture(Type, {});
        await expect(fixture.read(fixture.main)).rejects.toMatchObject({hapStatus: -70402});
        fixture.change({[code]: 'unsupported-state'});
        await expect(fixture.read(fixture.main)).rejects.toMatchObject({hapStatus: -70402});
        expect(fixture.main.updateValue).toHaveBeenLastCalledWith(expect.objectContaining({hapStatus: -70402}));
    });

    test('reports No Response after disconnecting', async () => {
        const fixture = sensorFixture(Type, {[code]: initial});
        fixture.device.connected = false;
        await expect(fixture.read(fixture.main)).rejects.toMatchObject({hapStatus: -70402});
    });

    test('accepts a numeric LAN DP override', async () => {
        const fixture = sensorFixture(Type, {'7': initial}, {[Type.sensor.option]: 7});
        await expect(fixture.read(fixture.main)).resolves.toBe(0);
        fixture.change({'7': Type === ContactSensorAccessory ? true : 'alarm'});
        await expect(fixture.read(fixture.main)).resolves.toBe(1);
    });

    test('accepts a custom cloud code without requiring a numeric shadow mapping', async () => {
        const fixture = sensorFixture(Type, {custom_code: initial}, {[Type.sensor.option]: 'custom_code'});
        await expect(fixture.read(fixture.main)).resolves.toBe(0);
    });
});

describe('contact mapping from 0x5e', () => {
    test.each([true, 1, '1', 'true'])('%s means contact not detected (open)', async value => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: value});
        await expect(fixture.read(fixture.main)).resolves.toBe(HAP.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
    });
    test.each([false, 0, '0', 'false'])('%s means contact detected (closed)', async value => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: value});
        await expect(fixture.read(fixture.main)).resolves.toBe(HAP.Characteristic.ContactSensorState.CONTACT_DETECTED);
    });
    test('falls back to switch and prefers doorcontact_state when both exist', async () => {
        const fixture = sensorFixture(ContactSensorAccessory, {switch: true});
        await expect(fixture.read(fixture.main)).resolves.toBe(1);
        fixture.change({doorcontact_state: false});
        await expect(fixture.read(fixture.main)).resolves.toBe(0);
    });
});

describe.each([SmokeSensorAccessory, LeakSensorAccessory])('%s alarm mappings', Type => {
    test.each(Type.sensor.codes)('supports %s', async code => {
        const fixture = sensorFixture(Type, {[code]: 'alarm'});
        await expect(fixture.read(fixture.main)).resolves.toBe(1);
        fixture.change({[code]: 'normal'});
        await expect(fixture.read(fixture.main)).resolves.toBe(0);
    });
    test.each(['1', 1, true])('accepts alarm value %s', async value => {
        const fixture = sensorFixture(Type, {[Type.sensor.codes[0]]: value});
        await expect(fixture.read(fixture.main)).resolves.toBe(1);
    });
});

test('a leak alarm wins over normal or malformed readings from other channels', async () => {
    const fixture = sensorFixture(LeakSensorAccessory, {gas_sensor_status: 'normal', watersensor_state: 'alarm'});
    await expect(fixture.read(fixture.main)).resolves.toBe(1);
    fixture.change({gas_sensor_status: 'unsupported'});
    await expect(fixture.read(fixture.main)).resolves.toBe(1);
    fixture.change({watersensor_state: 'normal'});
    await expect(fixture.read(fixture.main)).rejects.toMatchObject({hapStatus: -70402});
});

describe('sensor battery telemetry', () => {
    test.each(['battery_percentage', 'residual_electricity', 'wireless_electricity', 'va_battery', 'battery'])('supports %s', async code => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: false, [code]: 65});
        await expect(fixture.read(fixture.characteristic('Battery', 'BatteryLevel'))).resolves.toBe(65);
    });
    test('adds battery telemetry when it arrives after initial registration', async () => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: false});
        fixture.change({battery_percentage: 20});
        await expect(fixture.read(fixture.characteristic('Battery', 'StatusLowBattery'))).resolves.toBe(1);
        fixture.change({battery_percentage: 21});
        await expect(fixture.read(fixture.characteristic('Battery', 'StatusLowBattery'))).resolves.toBe(0);
    });
    test('battery_state takes precedence over the percentage threshold', async () => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: false, battery_percentage: 80, battery_state: 'low'});
        const status = fixture.characteristic('Battery', 'StatusLowBattery');
        await expect(fixture.read(status)).resolves.toBe(1);
        fixture.change({battery_percentage: 5, battery_state: 'high'});
        await expect(fixture.read(status)).resolves.toBe(0);
    });
    test('supports scaled percentages, threshold overrides, and charging', async () => {
        const fixture = sensorFixture(ContactSensorAccessory, {'1': true, '2': 250, '3': true},
            {dpContact: 1, dpBattery: 2, dpCharging: 3, batteryDivisor: 10, lowBatteryThreshold: 30});
        await expect(fixture.read(fixture.characteristic('Battery', 'BatteryLevel'))).resolves.toBe(25);
        await expect(fixture.read(fixture.characteristic('Battery', 'StatusLowBattery'))).resolves.toBe(1);
        await expect(fixture.read(fixture.characteristic('Battery', 'ChargingState'))).resolves.toBe(1);
    });
    test('non-rechargeable sensors do not claim to be charging', async () => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: false, battery_percentage: 60});
        await expect(fixture.read(fixture.characteristic('Battery', 'ChargingState'))).resolves.toBe(2);
    });
    test('invalid telemetry reports No Response instead of a normal battery', async () => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: false, battery_percentage: 'invalid'});
        await expect(fixture.read(fixture.characteristic('Battery', 'BatteryLevel'))).rejects.toMatchObject({hapStatus: -70402});
        await expect(fixture.read(fixture.characteristic('Battery', 'StatusLowBattery'))).rejects.toMatchObject({hapStatus: -70402});
    });
    test('noBattery disables the service', () => {
        const fixture = sensorFixture(ContactSensorAccessory, {doorcontact_state: false, battery_percentage: 60}, {noBattery: true});
        expect(fixture.services.has(HAP.Service.Battery.UUID)).toBe(false);
    });
});

describe.each(TYPES)('%s cloud-only updates', Type => {
    test('maps initial cloud status and MQTT updates without sending commands', async () => {
        const code = Type.sensor.codes[0];
        const api = {
            isConfigured: () => true,
            getStatus: jest.fn().mockResolvedValue([{code, value: Type === ContactSensorAccessory ? false : 'normal'}]),
            getDeviceInfo: jest.fn().mockResolvedValue({online: true}),
            sendCommands: jest.fn(),
        };
        const messaging = new EventEmitter();
        messaging.subscribeDevice = jest.fn();
        const log = {debug() {}, info() {}, warn() {}, error() {}};
        const backend = new TuyaCloudDevice({id: 'fixture-sensor', name: 'Fixture', cloudApi: api, messaging, log, connect: false});
        await backend._connect();
        const fixture = sensorFixture(Type, backend.state);
        backend.on('change', fixture.change);
        await expect(fixture.read(fixture.main)).resolves.toBe(0);
        const realtime = messaging.subscribeDevice.mock.calls[0][1];
        realtime([{code, value: Type === ContactSensorAccessory ? true : 'alarm'}]);
        await expect(fixture.read(fixture.main)).resolves.toBe(1);
        expect(api.sendCommands).not.toHaveBeenCalled();
        expect(fixture.device.update).not.toHaveBeenCalled();
        backend.stop();
    });
});
