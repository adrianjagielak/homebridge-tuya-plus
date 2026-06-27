'use strict';

// Mock every module that would touch the network or HAP, so we can exercise the
// platform's orchestration (cloud-session setup, per-device cloud policy, and
// discovery -> attachLan routing) in isolation.
jest.mock('../lib/TuyaDevice', () => jest.fn().mockImplementation(function(props) {
    this.context = {...props};
    this.cloud = props.cloudApi ? {} : null; // truthy iff a shared cloud session was handed in
    this.attachLan = jest.fn();
    this._connect = jest.fn();
}));
jest.mock('../lib/TuyaAccessory', () => jest.fn().mockImplementation(function(props) {
    this.context = {...props};
    this._connect = jest.fn();
}));
jest.mock('../lib/TuyaCloudApi', () => jest.fn().mockImplementation(function(cfg) {
    this.endpoint = 'https://openapi.example.com';
    this.cfg = cfg;
    this.getDeviceInfo = jest.fn();
}));
jest.mock('../lib/TuyaCloudMessaging', () => jest.fn().mockImplementation(function() {}));
jest.mock('../lib/TuyaDiscovery', () => ({
    start: jest.fn(function() { return this; }),
    on: jest.fn(function() { return this; })
}));

const TuyaDevice = require('../lib/TuyaDevice');
const TuyaAccessory = require('../lib/TuyaAccessory');
const TuyaCloudApi = require('../lib/TuyaCloudApi');
const TuyaCloudMessaging = require('../lib/TuyaCloudMessaging');
const TuyaDiscovery = require('../lib/TuyaDiscovery');

const makeHap = () => ({
    Characteristic: class { setProps() { return this; } getDefaultValue() { return 0; } },
    Formats: {FLOAT: 'float', UINT32: 'uint32', UINT16: 'uint16'},
    Perms: {READ: 'pr', NOTIFY: 'ev', WRITE: 'pw'},
    Categories: {OTHER: 1, SWITCH: 8, SPRINKLER: 28},
    Service: {AccessoryInformation: {UUID: '3E'}},
    uuid: {generate: s => 'uuid:' + s}
});

// Load the platform factory and capture the registered platform class.
const factory = require('../index');
function getPlatformClass() {
    let cls;
    factory({
        platformAccessory: function() {},
        hap: makeHap(),
        registerPlatform: (pluginName, platformName, c) => { cls = c; }
    });
    return cls;
}

function makeLog() {
    const log = jest.fn();
    log.info = jest.fn(); log.warn = jest.fn(); log.error = jest.fn(); log.debug = jest.fn();
    return log;
}

function makeApi() {
    return {hap: makeHap(), on: jest.fn(), registerPlatformAccessories: jest.fn(), unregisterPlatformAccessories: jest.fn()};
}

function run(config) {
    const Platform = getPlatformClass();
    const platform = new Platform(makeLog(), config, makeApi());
    platform.addAccessory = jest.fn(); // bypass HAP accessory creation
    platform.discoverDevices();
    return platform;
}

const propsFor = id => {
    const call = TuyaDevice.mock.calls.find(c => c[0].id === id);
    return call && call[0];
};
const instanceFor = id => TuyaDevice.mock.instances.find(i => i.context && i.context.id === id);

const SW = (extra = {}) => ({id: 'bf11111111111111', key: 'k1', type: 'switch', name: 'Switch', ...extra});
// A keyless device can't speak the LAN protocol, so it is cloud-only.
const SLEEPY = (extra = {}) => ({id: 'bf22222222222222', type: 'irrigationsystem', name: 'Sprinklers', ...extra});
const CLOUD = {accessId: 'aid', accessKey: 'akey', region: 'eu'};

// discoverDevices schedules a long discovery-timeout timer; fake timers keep it
// from holding the event loop open after the tests finish.
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('TuyaLan — cloud session setup', () => {
    test('no cloud config → no session, devices are pure-LAN', () => {
        run({devices: [SW()]});
        expect(TuyaCloudApi).not.toHaveBeenCalled();
        expect(propsFor('bf11111111111111').cloudApi).toBeUndefined();
    });

    test('a top-level cloud block creates the single shared session', () => {
        run({cloud: CLOUD, devices: [SW()]});
        expect(TuyaCloudApi).toHaveBeenCalledTimes(1);
        expect(TuyaCloudApi.mock.calls[0][0]).toMatchObject({accessId: 'aid', accessKey: 'akey', region: 'eu'});
        expect(TuyaCloudMessaging).toHaveBeenCalledTimes(1);
    });
});

describe('TuyaLan — cloud participation', () => {
    test('with a session, every device shares the one global fallback', () => {
        run({cloud: CLOUD, devices: [SW(), SLEEPY()]});
        expect(propsFor('bf11111111111111').cloudApi).toBeDefined(); // LAN device, cloud fallback
        expect(propsFor('bf22222222222222').cloudApi).toBeDefined(); // keyless, cloud-only
    });

    test('without a session, no device gets a cloud backend', () => {
        run({devices: [SW()]});
        expect(propsFor('bf11111111111111').cloudApi).toBeUndefined();
    });
});

describe('TuyaLan — discovery routing', () => {
    test('only keyed devices are discovered; keyless ones are cloud-only', () => {
        run({cloud: CLOUD, devices: [SW(), SLEEPY()]});
        expect(TuyaDiscovery.start).toHaveBeenCalledTimes(1);
        expect(TuyaDiscovery.start.mock.calls[0][0].ids).toEqual(['bf11111111111111']);
    });

    test('a discovered device is handed its LAN target via attachLan', () => {
        run({cloud: CLOUD, devices: [SW()]});
        // capture the 'discover' handler registered on the discovery emitter
        const onDiscover = TuyaDiscovery.on.mock.calls.find(c => c[0] === 'discover');
        expect(onDiscover).toBeDefined();
        onDiscover[1]({id: 'bf11111111111111', ip: '10.0.0.7', version: '3.3'});
        const inst = instanceFor('bf11111111111111');
        expect(inst.attachLan).toHaveBeenCalledWith({ip: '10.0.0.7', version: '3.3'});
    });

    test('a cloud-only configuration starts no LAN discovery', () => {
        run({cloud: CLOUD, devices: [SLEEPY()]});
        expect(TuyaDiscovery.start).not.toHaveBeenCalled();
    });
});

describe('TuyaLan — debug.forceCloudFallback', () => {
    test('skips LAN discovery so a keyed device never attaches a LAN backend', () => {
        run({cloud: CLOUD, debug: {forceCloudFallback: true}, devices: [SW()]});
        expect(TuyaDiscovery.start).not.toHaveBeenCalled();
        expect(TuyaDiscovery.on).not.toHaveBeenCalled();
        expect(instanceFor('bf11111111111111').attachLan).not.toHaveBeenCalled();
    });

    test('the forced device keeps its shared cloud session as its only transport', () => {
        run({cloud: CLOUD, debug: {forceCloudFallback: true}, devices: [SW()]});
        expect(propsFor('bf11111111111111').cloudApi).toBeDefined();
    });

    test('off (or absent) leaves discovery running as usual', () => {
        run({cloud: CLOUD, debug: {forceCloudFallback: false}, devices: [SW()]});
        expect(TuyaDiscovery.start).toHaveBeenCalledTimes(1);
    });

    test('lenient boolean spellings are accepted', () => {
        run({cloud: CLOUD, debug: {forceCloudFallback: 'true'}, devices: [SW()]});
        expect(TuyaDiscovery.start).not.toHaveBeenCalled();
    });

    test('without a cloud session, the unreachable device is reported as an error', () => {
        const platform = run({debug: {forceCloudFallback: true}, devices: [SW()]});
        expect(TuyaDiscovery.start).not.toHaveBeenCalled();
        expect(platform.log.error).toHaveBeenCalled();
    });
});

describe('TuyaLan — debug.logDebugAsInfo', () => {
    // The platform wraps its logger and threads it down to every
    // device/accessory/cloud component, so promoting it once routes the
    // plugin's whole debug stream to info. Build the platform directly here to
    // keep a handle on the underlying logger mock the wrapper delegates to.
    function platformWith(config) {
        const Platform = getPlatformClass();
        const rawLog = makeLog();
        return [new Platform(rawLog, config, makeApi()), rawLog];
    }

    test('routes a debug line to info', () => {
        const [platform, rawLog] = platformWith({debug: {logDebugAsInfo: true}, devices: [SW()]});
        platform.log.debug('hello', 1);
        expect(rawLog.info).toHaveBeenCalledWith('hello', 1);
        expect(rawLog.debug).not.toHaveBeenCalledWith('hello', 1);
    });

    test('the wrapped logger passes the callable form and info/warn/error straight through', () => {
        const [platform, rawLog] = platformWith({debug: {logDebugAsInfo: true}, devices: [SW()]});
        platform.log('plain');
        platform.log.warn('careful');
        platform.log.error('broke');
        expect(rawLog).toHaveBeenCalledWith('plain');
        expect(rawLog.warn).toHaveBeenCalledWith('careful');
        expect(rawLog.error).toHaveBeenCalledWith('broke');
    });

    test('off (or absent) leaves the logger untouched and debug going to debug', () => {
        const [platform, rawLog] = platformWith({devices: [SW()]});
        expect(platform.log).toBe(rawLog);
        platform.log.debug('quiet');
        expect(rawLog.debug).toHaveBeenCalledWith('quiet');
        expect(rawLog.info).not.toHaveBeenCalledWith('quiet');
    });

    test('lenient boolean spellings are accepted', () => {
        const [platform, rawLog] = platformWith({debug: {logDebugAsInfo: 'true'}, devices: [SW()]});
        platform.log.debug('promote me');
        expect(rawLog.info).toHaveBeenCalledWith('promote me');
    });
});

describe('TuyaLan — unconfigured device discovery', () => {
    const UNKNOWN = {id: 'bf99999999999999', ip: '10.0.0.9'};
    const BARE = 'Discovered a device that has not been configured yet (%s@%s).';
    const ENRICHED = 'Discovered a device that has not been configured yet: %s%s (%s@%s).';

    test('without a cloud session, the bare id@ip warning is logged', async () => {
        const platform = run({devices: [SW()]});
        await platform._warnUnconfiguredDevice(UNKNOWN);
        expect(platform.log.warn).toHaveBeenCalledWith(BARE, UNKNOWN.id, UNKNOWN.ip);
    });

    test('with a cloud session, the warning is enriched with the device name and product', async () => {
        const platform = run({cloud: CLOUD, devices: [SW()]});
        platform.cloudApi.getDeviceInfo.mockResolvedValue({name: 'Living Room Light', product_name: 'Smart Bulb', category: 'dj', online: true});

        await platform._warnUnconfiguredDevice(UNKNOWN);

        expect(platform.cloudApi.getDeviceInfo).toHaveBeenCalledWith(UNKNOWN.id);
        const [format, ...args] = platform.log.warn.mock.calls[0];
        expect(format).toBe(ENRICHED);
        const text = args.join(' ');
        expect(text).toContain('"Living Room Light"');
        expect(text).toContain('Smart Bulb');
        expect(text).toContain('category dj');
        expect(text).toContain(UNKNOWN.id);
    });

    test('a cloud lookup that fails falls back to the bare warning', async () => {
        const platform = run({cloud: CLOUD, devices: [SW()]});
        platform.cloudApi.getDeviceInfo.mockRejectedValue(new Error('device not found'));

        await platform._warnUnconfiguredDevice(UNKNOWN);

        expect(platform.log.warn).toHaveBeenCalledWith(BARE, UNKNOWN.id, UNKNOWN.ip);
        expect(platform.log.debug).toHaveBeenCalled();
    });

    test('a cloud record without a name falls back to the bare warning', async () => {
        const platform = run({cloud: CLOUD, devices: [SW()]});
        platform.cloudApi.getDeviceInfo.mockResolvedValue({online: true});

        await platform._warnUnconfiguredDevice(UNKNOWN);

        expect(platform.log.warn).toHaveBeenCalledWith(BARE, UNKNOWN.id, UNKNOWN.ip);
    });

    test('the discover handler routes an unconfigured device through the cloud lookup', () => {
        const platform = run({cloud: CLOUD, devices: [SW()]});
        platform.cloudApi.getDeviceInfo.mockResolvedValue(null);

        const onDiscover = TuyaDiscovery.on.mock.calls.find(c => c[0] === 'discover')[1];
        onDiscover(UNKNOWN);

        expect(platform.cloudApi.getDeviceInfo).toHaveBeenCalledWith(UNKNOWN.id);
    });
});

describe('TuyaLan — duplicate device ids', () => {
    // Two entries sharing an id resolve to one accessory UUID; configuring it twice
    // used to crash the child bridge (addAccessory read back its own wrapper and
    // tried to unregister it). The repeat must be dropped with a warning instead.
    test('a repeated id is configured once and warns', () => {
        const platform = run({devices: [SW(), SW()]});
        expect(TuyaDevice).toHaveBeenCalledTimes(1);
        expect(platform.addAccessory).toHaveBeenCalledTimes(1);
        expect(platform.log.warn).toHaveBeenCalled();
    });

    test('distinct ids are all configured', () => {
        run({devices: [SW(), SLEEPY()]});
        expect(TuyaDevice).toHaveBeenCalledTimes(2);
    });

    test('a repeated fake id is configured once', () => {
        run({devices: [SW({fake: true}), SW({fake: true})]});
        expect(TuyaAccessory).toHaveBeenCalledTimes(1);
    });
});

describe('TuyaLan — removeAccessory hardening', () => {
    function platformWith(PlatformAccessory) {
        let cls;
        factory({platformAccessory: PlatformAccessory, hap: makeHap(), registerPlatform: (n, p, c) => { cls = c; }});
        return new cls(makeLog(), {devices: [SW()]}, makeApi());
    }
    const PlatformAccessoryStub = function(name, uuid) { this.displayName = name; this.UUID = uuid; };

    test('a non-PlatformAccessory (e.g. an accessory wrapper) is never unregistered', () => {
        const platform = platformWith(PlatformAccessoryStub);
        expect(() => platform.removeAccessory({accessory: {}})).not.toThrow();
        expect(platform.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
        expect(platform.log.warn).toHaveBeenCalled();
    });

    test('a real PlatformAccessory is unregistered and dropped from the cache', () => {
        const platform = platformWith(PlatformAccessoryStub);
        const accessory = new PlatformAccessoryStub('Real', 'uuid:x');
        platform.cachedAccessories.set('uuid:x', accessory);
        platform.removeAccessory(accessory);
        expect(platform.api.unregisterPlatformAccessories).toHaveBeenCalledTimes(1);
        expect(platform.cachedAccessories.has('uuid:x')).toBe(false);
    });
});
