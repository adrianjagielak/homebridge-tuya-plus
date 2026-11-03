'use strict';

const OccupancySensorAccessory = require('../lib/OccupancySensorAccessory');
const {HAP, makeInstance, makeMockService, makeMockCharacteristic} = require('./support/mocks');

function makeSensor(state = {'1': 'presence', '104': 25}, context = {}) {
    const fixture = makeInstance(OccupancySensorAccessory, state, {type: 'OccupancySensor', ...context});
    const occupancy = makeMockCharacteristic();
    const light = makeMockCharacteristic();
    const occupancyService = makeMockService(HAP.Service.OccupancySensor.UUID);
    const lightService = makeMockService(HAP.Service.LightSensor.UUID);
    occupancyService.displayName = fixture.device.context.name;
    lightService.displayName = fixture.device.context.name + ' Light';
    occupancyService.getCharacteristic.mockReturnValue(occupancy);
    lightService.getCharacteristic.mockReturnValue(light);
    fixture.accessory.getService.mockImplementation(type =>
        type === HAP.Service.OccupancySensor ? occupancyService : lightService);
    fixture.instance._registerCharacteristics(state);
    const change = fixture.device.on.mock.calls.find(([event]) => event === 'change')[1];
    return {...fixture, occupancy, light, change};
}

describe('OccupancySensorAccessory', () => {
    test('registers occupancy and light services with stable names', () => {
        const {instance, accessory, platform} = makeInstance(OccupancySensorAccessory);
        instance._registerPlatformAccessory();
        expect(accessory.addService).toHaveBeenCalledWith(HAP.Service.OccupancySensor, 'Test Device');
        expect(accessory.addService).toHaveBeenCalledWith(HAP.Service.LightSensor, 'Test Device Light');
        expect(platform.registerPlatformAccessories).toHaveBeenCalledWith(accessory);
    });

    test.each([['presence', 1], ['none', 0], ['absence', 0]])('maps %s to occupancy %s', (value, expected) => {
        const {occupancy} = makeSensor({'1': value, '104': 25});
        expect(occupancy.value).toBe(expected);
    });

    test('reads occupancy and illuminance through Homebridge getters', async () => {
        const {occupancy, light} = makeSensor();
        await expect(occupancy.onGet.mock.calls[0][0]()).resolves.toBe(1);
        await expect(light.onGet.mock.calls[0][0]()).resolves.toBe(25);
    });

    test('supports custom data points supplied as numbers or strings', async () => {
        const {instance, occupancy, light} = makeSensor({'5': 'presence', '8': '120'}, {dpOccupancy: 5, dpLight: '8'});
        expect(instance.dpOccupancy).toBe('5');
        expect(instance.dpLight).toBe('8');
        expect(occupancy.value).toBe(1);
        await expect(light.onGet.mock.calls[0][0]()).resolves.toBe(120);
    });

    test('updates occupancy without overwriting the last light reading', () => {
        const {occupancy, light, change} = makeSensor();
        light.updateValue.mockClear();
        change({'1': 'none'});
        expect(occupancy.value).toBe(0);
        expect(light.value).toBe(25);
        expect(light.updateValue).not.toHaveBeenCalled();
    });

    test('updates light without changing occupancy or emitting duplicate updates', () => {
        const {occupancy, light, change} = makeSensor();
        occupancy.updateValue.mockClear();
        light.updateValue.mockClear();
        change({'104': 42});
        change({'104': 42});
        expect(light.value).toBe(42);
        expect(light.updateValue).toHaveBeenCalledTimes(1);
        expect(occupancy.updateValue).not.toHaveBeenCalled();
    });

    test.each([[0, 0.0001], [0.00001, 0.0001], [100001, 100000]])('clamps %s lux to %s', (value, expected) => {
        const {light} = makeSensor({'1': 'none', '104': value});
        expect(light.value).toBe(expected);
    });

    test.each([undefined, null, '', 'invalid', -1, NaN, Infinity, false])('does not publish invalid light reading %s', async value => {
        const {light, change, device} = makeSensor();
        light.updateValue.mockClear();
        change({'104': value});
        expect(light.updateValue).not.toHaveBeenCalled();
        device.state['104'] = value;
        await expect(light.onGet.mock.calls[0][0]()).rejects.toMatchObject({hapStatus: -70402});
    });

    test('a missing illuminance DP does not prevent occupancy from working', async () => {
        const {occupancy, light} = makeSensor({'1': 'presence'});
        expect(light.updateValue).not.toHaveBeenCalled();
        await expect(occupancy.onGet.mock.calls[0][0]()).resolves.toBe(1);
    });

    test('reports No Response for both characteristics when disconnected', async () => {
        const {device, occupancy, light} = makeSensor();
        device.connected = false;
        await expect(occupancy.onGet.mock.calls[0][0]()).rejects.toMatchObject({hapStatus: -70402});
        await expect(light.onGet.mock.calls[0][0]()).rejects.toMatchObject({hapStatus: -70402});
        expect(device.update).not.toHaveBeenCalled();
    });
});
