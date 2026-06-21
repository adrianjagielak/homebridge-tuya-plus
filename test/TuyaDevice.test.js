'use strict';

// The LAN backend opens real TCP sockets; stub it so attachLan() can be tested
// without touching the network. Cloud backend stays real (it's inert with
// connect:false).
jest.mock('../lib/TuyaAccessory', () => jest.fn().mockImplementation(function(props) {
    this.context = {...props};
    this.connected = false;
    this.state = {};
    this.update = jest.fn().mockReturnValue(true);
    this.on = jest.fn();
    this._connect = jest.fn();
}));

const EventEmitter = require('events');
const TuyaDevice = require('../lib/TuyaDevice');
const TuyaCloudDevice = require('../lib/TuyaCloudDevice');

const log = {info: () => {}, warn: () => {}, error: () => {}, debug: () => {}};

// A minimal stand-in for either backend (TuyaAccessory / TuyaCloudDevice): an
// EventEmitter exposing the surface TuyaDevice routes through.
function fakeBackend(extra = {}) {
    const b = new EventEmitter();
    b.connected = false;
    b.state = {};
    b.update = jest.fn().mockReturnValue(true);
    b.codeByDpId = {};
    b.dpIdByCode = {};
    b._connect = jest.fn();
    return Object.assign(b, extra);
}

function makeDevice(props = {}) {
    return new TuyaDevice({id: 'dev1', key: 'k', name: 'Lamp', type: 'switch', log, connect: false, ...props});
}

// Attach fake backends to a device and wire their events (white-box, so the merge
// / fallback logic can be exercised without any real network).
function withBackends(dev, {lan, cloud} = {}) {
    if (cloud) { dev.cloud = cloud; dev._wire(cloud, 'cloud'); }
    if (lan) { dev.lan = lan; dev._wire(lan, 'lan'); }
    return dev;
}

describe('TuyaDevice — connectivity', () => {
    test('connected reflects either backend', () => {
        const dev = makeDevice();
        const lan = fakeBackend();
        const cloud = fakeBackend();
        withBackends(dev, {lan, cloud});

        expect(dev.connected).toBe(false);
        lan.connected = true;
        expect(dev.connected).toBe(true);
        lan.connected = false;
        cloud.connected = true;
        expect(dev.connected).toBe(true);
    });

    test("'connect' is emitted once, on the first backend to connect", () => {
        const dev = makeDevice();
        const lan = fakeBackend();
        const cloud = fakeBackend();
        withBackends(dev, {lan, cloud});

        let connects = 0;
        dev.on('connect', () => connects++);
        lan.emit('connect');
        cloud.emit('connect');
        expect(connects).toBe(1);
    });
});

describe('TuyaDevice — pure LAN (no cloud) preserves legacy behaviour', () => {
    test('update returns the synchronous boolean from the LAN backend', () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true});
        withBackends(dev, {lan});

        lan.update.mockReturnValue(true);
        expect(dev.update({'1': false})).toBe(true);
        expect(lan.update).toHaveBeenCalledWith({'1': false});

        lan.update.mockReturnValue(false);
        expect(dev.update({'1': true})).toBe(false);
    });

    test('update is false when there is no transport at all', () => {
        const dev = makeDevice();
        expect(dev.update({'1': true})).toBe(false);
    });
});

describe('TuyaDevice — state merge & registration', () => {
    test('first change drives registration and exposes the merged state', () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true, state: {'1': true, '2': 50}});
        withBackends(dev, {lan});

        const seen = [];
        dev.on('change', (changes, state) => seen.push({changes, state}));
        lan.emit('change');

        expect(seen).toHaveLength(1);
        expect(seen[0].state).toEqual({'1': true, '2': 50});
    });

    test('LAN wins over the cloud while connected; cloud-only DPs are kept; LAN is mirrored to codes', () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true, state: {'1': true}});
        const cloud = fakeBackend({
            connected: true,
            state: {'switch_led': false, '1': false, 'battery_percentage': 80},
            codeByDpId: {'1': 'switch_led'},
            dpIdByCode: {'switch_led': '1'}
        });
        withBackends(dev, {lan, cloud});

        lan.emit('change');
        expect(dev.state['1']).toBe(true);                 // LAN value wins
        expect(dev.state['switch_led']).toBe(true);        // …mirrored to its code
        expect(dev.state['battery_percentage']).toBe(80);  // cloud-only DP retained
    });

    test('when the LAN drops, the cloud takes over and the change is emitted', () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true, state: {'1': true}});
        const cloud = fakeBackend({connected: true, state: {'1': false}});
        withBackends(dev, {lan, cloud});

        lan.emit('change');
        expect(dev.state['1']).toBe(true);

        lan.connected = false; // LAN lost
        const seen = [];
        dev.on('change', changes => seen.push(changes));
        cloud.emit('change');

        expect(dev.state['1']).toBe(false);
        expect(seen[0]).toEqual({'1': false});
    });
});

describe('TuyaDevice — writes with fallback', () => {
    test('LAN is used first when both backends are up', async () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true});
        const cloud = fakeBackend({connected: true, update: jest.fn().mockResolvedValue(true)});
        withBackends(dev, {lan, cloud});

        await expect(dev.update({'1': true})).resolves.toBe(true);
        expect(lan.update).toHaveBeenCalledWith({'1': true});
        expect(cloud.update).not.toHaveBeenCalled();
    });

    test('a failed LAN write falls back to the cloud', async () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true, update: jest.fn().mockReturnValue(false)});
        const cloud = fakeBackend({connected: true, update: jest.fn().mockResolvedValue(true)});
        withBackends(dev, {lan, cloud});

        await expect(dev.update({'1': true})).resolves.toBe(true);
        expect(cloud.update).toHaveBeenCalledWith({'1': true});
    });

    test('with the LAN down, writes go straight to the cloud (raw keys; the cloud translates)', async () => {
        const dev = makeDevice();
        const cloud = fakeBackend({connected: true, update: jest.fn().mockResolvedValue(true)});
        withBackends(dev, {cloud});

        await expect(dev.update({'switch_led': true})).resolves.toBe(true);
        expect(cloud.update).toHaveBeenCalledWith({'switch_led': true});
    });

    test('a code-style write is translated to numeric ids for the LAN', async () => {
        const dev = makeDevice();
        const lan = fakeBackend({connected: true, update: jest.fn().mockReturnValue(true)});
        const cloud = fakeBackend({connected: true, dpIdByCode: {'switch_led': '1'}, codeByDpId: {'1': 'switch_led'}});
        withBackends(dev, {lan, cloud});

        await dev.update({'switch_led': true});
        expect(lan.update).toHaveBeenCalledWith({'1': true});
    });

    test('update resolves false when nothing is reachable', async () => {
        const dev = makeDevice();
        const cloud = fakeBackend({connected: false, update: jest.fn()});
        withBackends(dev, {cloud});
        await expect(dev.update({'1': true})).resolves.toBe(false);
    });
});

describe('TuyaDevice — registration source guard', () => {
    test('a LAN-primary device defers cloud-driven registration until it has the map or the LAN grace elapses', () => {
        const dev = makeDevice();                  // has a key → LAN-primary
        dev.cloud = fakeBackend({codeByDpId: {}});  // cloud, but no numeric map yet

        expect(dev._mayRegisterFrom('lan')).toBe(true);
        expect(dev._mayRegisterFrom('cloud')).toBe(false);

        dev.cloud.codeByDpId = {'1': 'switch_led'}; // map learned → safe
        expect(dev._mayRegisterFrom('cloud')).toBe(true);

        dev.cloud.codeByDpId = {};
        dev._lanGraceElapsed = true;                // …or the LAN had its head start
        expect(dev._mayRegisterFrom('cloud')).toBe(true);
    });

    test('a cloud-primary or keyless device registers off the cloud immediately', () => {
        const primary = makeDevice({cloudPrimary: true});
        primary.cloud = fakeBackend({codeByDpId: {}});
        expect(primary._mayRegisterFrom('cloud')).toBe(true);

        const keyless = makeDevice({key: undefined});
        keyless.cloud = fakeBackend({codeByDpId: {}});
        expect(keyless._mayRegisterFrom('cloud')).toBe(true);
    });
});

describe('TuyaDevice — composition', () => {
    test('a cloud backend is built when a shared cloud session is supplied', () => {
        const api = {
            isConfigured: () => true,
            getStatus: jest.fn().mockResolvedValue([]),
            getDeviceInfo: jest.fn().mockResolvedValue({online: true}),
            sendCommands: jest.fn()
        };
        const dev = makeDevice({cloudApi: api});
        expect(dev.cloud).toBeInstanceOf(TuyaCloudDevice);
        expect(dev.lan).toBeNull();
    });

    test('no cloud backend without a shared session', () => {
        const dev = makeDevice();
        expect(dev.cloud).toBeNull();
    });

    test('attachLan builds the LAN backend with the discovered version (forceVersion still wins)', () => {
        const dev = makeDevice({ip: '10.0.0.5'});
        dev.attachLan({ip: '10.0.0.9', version: '3.3'});
        expect(dev.lan).not.toBeNull();
        expect(dev.lan.context.ip).toBe('10.0.0.9');
        expect(dev.lan.context.version).toBe('3.3');

        const forced = makeDevice({forceVersion: '3.5'});
        forced.attachLan({ip: '10.0.0.9', version: '3.3'});
        expect(forced.lan.context.version).toBe('3.5');
    });

    test('attachLan is a no-op without a local key (cloud-only device)', () => {
        const dev = makeDevice({key: undefined});
        dev.attachLan({ip: '10.0.0.9'});
        expect(dev.lan).toBeNull();
    });
});
