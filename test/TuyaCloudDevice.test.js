'use strict';

const EventEmitter = require('events');
const TuyaCloudDevice = require('../lib/TuyaCloudDevice');

const log = {info: () => {}, warn: () => {}, error: () => {}, debug: () => {}};

function makeApi(status = [{code: 'switch_1', value: false}, {code: 'battery_percentage', value: 99}]) {
    return {
        isConfigured: () => true,
        getStatus: jest.fn().mockResolvedValue(status),
        getDeviceInfo: jest.fn().mockResolvedValue({online: true}),
        sendCommands: jest.fn().mockResolvedValue(true)
    };
}

function makeDevice(api, messaging = null, extra = {}) {
    return new TuyaCloudDevice({
        cloudApi: api, messaging, log,
        id: 'dev1', name: 'Sprinklers', type: 'irrigationsystem', cloud: true,
        connect: false, ...extra
    });
}

describe('TuyaCloudDevice', () => {
    test('connect reads status and emits connect then change (state keyed by code)', async () => {
        const api = makeApi();
        const dev = makeDevice(api);

        const events = [];
        dev.on('connect', () => events.push('connect'));
        dev.on('change', (changes, state) => events.push({changes, state}));

        await dev._connect();

        expect(dev.connected).toBe(true);
        expect(dev.state).toEqual({switch_1: false, battery_percentage: 99});
        expect(events[0]).toBe('connect');
        expect(events[1].state).toEqual({switch_1: false, battery_percentage: 99});
        expect(api.getStatus).toHaveBeenCalledWith('dev1');
    });

    test('update sends code/value commands and does NOT mutate local state', async () => {
        const api = makeApi();
        const dev = makeDevice(api);
        await dev._connect();

        const before = {...dev.state};
        dev.update({switch_1: true});

        expect(api.sendCommands).toHaveBeenCalledWith('dev1', [{code: 'switch_1', value: true}]);
        expect(dev.state).toEqual(before); // optimism lives in the accessory, not here
    });

    test('update is a no-op (no throw) before connect', () => {
        const api = makeApi();
        const dev = makeDevice(api);
        expect(dev.connected).toBe(false);
        expect(() => dev.update({switch_1: true})).not.toThrow();
        expect(api.sendCommands).not.toHaveBeenCalled();
    });

    test('applyStatus emits only the changed data-points', async () => {
        const api = makeApi();
        const dev = makeDevice(api);
        await dev._connect();

        const changes = [];
        dev.on('change', c => changes.push(c));

        dev._applyStatus([{code: 'switch_1', value: true}, {code: 'battery_percentage', value: 99}]);
        expect(changes).toHaveLength(1);
        expect(changes[0]).toEqual({switch_1: true}); // battery unchanged → not emitted
        expect(dev.state.switch_1).toBe(true);

        changes.length = 0;
        dev._applyStatus([{code: 'switch_1', value: true}]); // nothing changed
        expect(changes).toHaveLength(0);
    });

    test('connect reflects the device online status (offline → not connected)', async () => {
        const api = makeApi();
        api.getDeviceInfo.mockResolvedValue({online: false});
        const dev = makeDevice(api);
        await dev._connect();
        expect(api.getDeviceInfo).toHaveBeenCalledWith('dev1');
        expect(dev.connected).toBe(false);
    });

    test('online lookup failure → assume reachable (never block control)', async () => {
        const api = makeApi();
        api.getDeviceInfo.mockRejectedValue(new Error('no device-management permission'));
        const dev = makeDevice(api);
        await dev._connect();
        expect(dev.connected).toBe(true);
    });

    test('a state refresh re-checks online and flips connected', async () => {
        const api = makeApi();
        const dev = makeDevice(api);
        await dev._connect();
        expect(dev.connected).toBe(true);

        api.getDeviceInfo.mockResolvedValue({online: false});
        await dev._refreshState();
        expect(dev.connected).toBe(false);
    });

    test('subscribes to realtime and re-reads state when the stream (re)connects', async () => {
        const api = makeApi();
        const messaging = Object.assign(new EventEmitter(), {
            connected: false,
            subscribeDevice: jest.fn()
        });
        const dev = makeDevice(api, messaging);
        await dev._connect();

        expect(messaging.subscribeDevice).toHaveBeenCalledWith('dev1', expect.any(Function));

        // A realtime message routed back to the device updates its state.
        const handler = messaging.subscribeDevice.mock.calls[0][1];
        const changes = [];
        dev.on('change', c => changes.push(c));
        handler([{code: 'switch_2', value: true}]);
        expect(dev.state.switch_2).toBe(true);
        expect(changes[0]).toEqual({switch_2: true});

        // On 'online' the device re-reads the full state (catch-up).
        api.getStatus.mockClear();
        messaging.emit('online');
        await new Promise(r => setImmediate(r));
        expect(api.getStatus).toHaveBeenCalledWith('dev1');
    });
});
