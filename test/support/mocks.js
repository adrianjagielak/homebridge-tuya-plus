'use strict';

// HomeKit characteristic/service constant values (from HAP spec)
const HAP = {
    Characteristic: {
        On: { UUID: 'B0' },
        Brightness: { UUID: 'B3' },
        ColorTemperature: { UUID: 'CE' },
        Hue: { UUID: '13' },
        Saturation: { UUID: 'BF' },
        Name: { UUID: '23' },
        Active: { INACTIVE: 0, ACTIVE: 1, UUID: 'B0' },
        CurrentDoorState: { OPEN: 0, CLOSED: 1, OPENING: 2, CLOSING: 3, STOPPED: 4 },
        TargetDoorState: { OPEN: 0, CLOSED: 1 },
        CurrentHeaterCoolerState: { INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3 },
        TargetHeaterCoolerState: { AUTO: 0, HEAT: 1, COOL: 2 },
        PositionState: { DECREASING: 0, INCREASING: 1, STOPPED: 2 },
        LockPhysicalControls: { CONTROL_LOCK_DISABLED: 0, CONTROL_LOCK_ENABLED: 1 },
        TemperatureDisplayUnits: { CELSIUS: 0, FAHRENHEIT: 1 },
        SwingMode: { SWING_DISABLED: 0, SWING_ENABLED: 1 },
        AirQuality: { UNKNOWN: 0, EXCELLENT: 1, GOOD: 2, FAIR: 3, INFERIOR: 4, POOR: 5 },
        CurrentAirPurifierState: { INACTIVE: 0, IDLE: 1, PURIFYING_AIR: 2 },
        TargetAirPurifierState: { MANUAL: 0, AUTO: 1 },
        CurrentHumidifierDehumidifierState: { INACTIVE: 0, IDLE: 1, HUMIDIFYING: 2, DEHUMIDIFYING: 3 },
        TargetHumidifierDehumidifierState: { HUMIDIFIER_OR_DEHUMIDIFIER: 0, HUMIDIFIER: 1, DEHUMIDIFIER: 2 },
        LockTargetState: { UNSECURED: 0, SECURED: 1 },
        LockCurrentState: { UNSECURED: 0, SECURED: 1, JAMMED: 2, UNKNOWN: 3 },
        RotationDirection: { CLOCKWISE: 0, COUNTER_CLOCKWISE: 1 },
        RotationSpeed: { UUID: '29' },
        ValveType: { UUID: 'D5' },
        InUse: { UUID: 'D2' },
        SetDuration: { UUID: 'D3' },
        RemainingDuration: { UUID: 'D4' },
        HeatingThresholdTemperature: { UUID: '12' },
        CoolingThresholdTemperature: { UUID: '0D' },
        CurrentTemperature: { UUID: '11' },
        CurrentRelativeHumidity: { UUID: '10' },
        RelativeHumidityDehumidifierThreshold: { UUID: 'C9' },
        WaterLevel: { UUID: 'B5' },
        ProgrammableSwitchEvent: { SINGLE_PRESS: 0 },
        PM2_5Density: { UUID: 'C1' },
    },
    Service: {
        Lightbulb: { UUID: '43' },
        Outlet: { UUID: '47' },
        Switch: { UUID: '49' },
        Fan: { UUID: 'B7' },
        GarageDoorOpener: { UUID: '41' },
        WindowCovering: { UUID: '8C' },
        HeaterCooler: { UUID: '7B' },
        AirPurifier: { UUID: 'BB' },
        AirQualitySensor: { UUID: '8D' },
        HumidifierDehumidifier: { UUID: 'BD' },
        HumiditySensor: { UUID: '82' },
        TemperatureSensor: { UUID: '8A' },
        LockMechanism: { UUID: '45' },
        Valve: { UUID: 'D0' },
        Doorbell: { UUID: '41' },
        AccessoryInformation: { UUID: '3E' },
    },
    Formats: { FLOAT: 'float', UINT32: 'uint32', UINT16: 'uint16' },
    Perms: { READ: 'pr', NOTIFY: 'ev', WRITE: 'pw' },
};

function makeMockCharacteristic(initialValue = null) {
    const char = {
        value: initialValue,
        props: { perms: [] },
        updateValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
        onGet: jest.fn().mockReturnThis(),
        onSet: jest.fn().mockReturnThis(),
        on: jest.fn().mockReturnThis(),
        setProps: jest.fn().mockReturnThis(),
        setValue: jest.fn().mockImplementation(function(v) { this.value = v; return this; }),
        addCharacteristic: jest.fn().mockReturnThis(),
    };
    return char;
}

function makeMockService(uuid = 'test-uuid') {
    const char = makeMockCharacteristic();
    return {
        UUID: uuid,
        subtype: null,
        displayName: 'Test Service',
        characteristics: [],
        getCharacteristic: jest.fn().mockReturnValue(char),
        addCharacteristic: jest.fn().mockReturnValue(char),
        removeCharacteristic: jest.fn(),
        updateCharacteristic: jest.fn(),
        setPrimaryService: jest.fn(),
        _mockChar: char,
    };
}

function makeMockAccessory() {
    const service = makeMockService();
    return {
        UUID: 'test-accessory-uuid',
        displayName: 'Test Device',
        category: null,
        services: [],
        context: {},
        on: jest.fn(),
        addService: jest.fn().mockReturnValue(service),
        getService: jest.fn().mockReturnValue(service),
        getServiceById: jest.fn().mockReturnValue(null),
        removeService: jest.fn(),
        configureController: jest.fn(),
        _mockService: service,
    };
}

function makeMockDevice(state = {}, context = {}) {
    const device = {
        connected: true,
        state: { ...state },
        context: {
            name: 'Test Device',
            manufacturer: 'Generic',
            model: 'Generic',
            type: 'simplelight',
            version: '3.3',
            id: '12345678abcdef',
            ...context,
        },
        _connect: jest.fn(),
        once: jest.fn(),
        on: jest.fn(),
        update: jest.fn().mockReturnValue(true),
    };
    return device;
}

function makeMockPlatform() {
    const log = jest.fn();
    log.info = jest.fn();
    log.warn = jest.fn();
    log.error = jest.fn();
    log.debug = jest.fn();

    return {
        log,
        api: {
            hap: HAP,
            versionGreaterOrEqual: jest.fn().mockReturnValue(false),
        },
        registerPlatformAccessories: jest.fn(),
    };
}

// Build a BaseAccessory (or subclass) instance without triggering the device lifecycle.
// Pass isNew=false so _registerPlatformAccessory is skipped.
// The device.once/on calls are recorded but not triggered.
function makeInstance(AccessoryClass, deviceState = {}, deviceContext = {}) {
    const platform = makeMockPlatform();
    const accessory = makeMockAccessory();
    const device = makeMockDevice(deviceState, deviceContext);
    const instance = new AccessoryClass(platform, accessory, device, false);
    return { instance, platform, accessory, device };
}

module.exports = { HAP, makeInstance, makeMockPlatform, makeMockAccessory, makeMockDevice, makeMockCharacteristic, makeMockService };
