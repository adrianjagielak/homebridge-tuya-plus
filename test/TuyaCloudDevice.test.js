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
        expect(dev.update({switch_1: true})).toBe(false);
        expect(api.sendCommands).not.toHaveBeenCalled();
    });

    test('update resolves to the cloud command result so failures are awaitable', async () => {
        const api = makeApi();
        const dev = makeDevice(api);
        await dev._connect();

        api.sendCommands.mockResolvedValueOnce(true);
        await expect(dev.update({switch_1: true})).resolves.toBe(true);

        api.sendCommands.mockResolvedValueOnce(false);
        await expect(dev.update({switch_1: true})).resolves.toBe(false);
    });

    test('update resolves to false (never rejects) when the cloud request throws', async () => {
        const api = makeApi();
        const dev = makeDevice(api);
        await dev._connect();

        api.sendCommands.mockRejectedValueOnce(new Error('network down'));
        await expect(dev.update({switch_1: true})).resolves.toBe(false);
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

    test('builds the code<->dp_id map and dual-keys state from the shadow', async () => {
        const props = [{code: 'switch_1', dp_id: 1, value: false}, {code: 'battery_percentage', dp_id: 46, value: 99}];
        const api = makeApi();
        api.getShadowProperties = jest.fn().mockResolvedValue(props);
        const dev = makeDevice(api);
        await dev._connect();

        expect(api.getShadowProperties).toHaveBeenCalledWith('dev1');
        expect(dev.codeByDpId).toEqual({'1': 'switch_1', '46': 'battery_percentage'});
        expect(dev.dpIdByCode).toEqual({'switch_1': '1', 'battery_percentage': '46'});
        // state is addressable by BOTH the cloud code and the numeric LAN dp id
        expect(dev.state).toEqual({switch_1: false, '1': false, battery_percentage: 99, '46': 99});
    });

    test('update translates a numeric dp id to its cloud code', async () => {
        const api = makeApi();
        api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'switch_1', dp_id: 1, value: false}]);
        const dev = makeDevice(api);
        await dev._connect();

        dev.update({'1': true}); // a LAN-style numeric write
        expect(api.sendCommands).toHaveBeenCalledWith('dev1', [{code: 'switch_1', value: true}]);
    });

    test('realtime code-only deltas are mirrored to numeric ids via the learned map', async () => {
        const api = makeApi();
        api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'switch_1', dp_id: 1, value: false}]);
        const dev = makeDevice(api);
        await dev._connect();

        const changes = [];
        dev.on('change', c => changes.push(c));
        dev._applyStatus([{code: 'switch_1', value: true}]); // code-only (as MQTT delivers)
        expect(dev.state.switch_1).toBe(true);
        expect(dev.state['1']).toBe(true);
        expect(changes[0]).toEqual({switch_1: true, '1': true});
    });

    test('falls back to /status (code-only) when the shadow is unavailable', async () => {
        const api = makeApi();
        api.getShadowProperties = jest.fn().mockResolvedValue(null);
        const dev = makeDevice(api);
        await dev._connect();

        expect(dev.codeByDpId).toEqual({});
        expect(dev.state).toEqual({switch_1: false, battery_percentage: 99}); // code-only, no numeric mirror
        expect(api.getStatus).toHaveBeenCalledWith('dev1');
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

    describe('connect-failure handling (no log spam)', () => {
        afterEach(() => jest.restoreAllMocks());

        test('a repeated failure is surfaced once, suppressed after, and backs off', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi(), null, {key: 'abc'}); // LAN-capable → fallback
                const warn = jest.spyOn(log, 'warn');
                const debug = jest.spyOn(log, 'debug');
                const err = new Error('GET /v1.0/devices/dev1/status failed: permission deny (code 1106)');

                dev._onConnectFailure(err);
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.mock.calls[0][0]).toContain('permission deny (code 1106)');
                expect(dev._retryDelay).toBe(30000);

                dev._onConnectFailure(err); // identical → not surfaced again, just debug + backoff
                expect(warn).toHaveBeenCalledTimes(1);
                expect(debug).toHaveBeenCalledWith(expect.stringContaining('still failing'));
                expect(dev._retryDelay).toBe(60000);

                dev._onConnectFailure(err);
                expect(dev._retryDelay).toBe(120000);
            } finally {
                jest.useRealTimers();
            }
        });

        test('a cloud-only device (no key) surfaces the failure at error level', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi()); // no key → cloud is the only path
                const error = jest.spyOn(log, 'error');
                const warn = jest.spyOn(log, 'warn');

                dev._onConnectFailure(new Error('permission deny (code 1106)'));
                expect(warn).not.toHaveBeenCalled();
                expect(error).toHaveBeenCalledTimes(1);
                expect(error.mock.calls[0][0]).toContain('cloud-only');
            } finally {
                jest.useRealTimers();
            }
        });

        test('a device reachable over the LAN logs the fallback failure as harmless (debug, not warn)', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi(), null, {key: 'abc', isLanConnected: () => true});
                const warn = jest.spyOn(log, 'warn');
                const debug = jest.spyOn(log, 'debug');

                dev._onConnectFailure(new Error('permission deny (code 1106)'));

                expect(warn).not.toHaveBeenCalled();
                expect(debug).toHaveBeenCalledTimes(1);
                expect(debug.mock.calls[0][0]).toContain('reachable over the LAN');
            } finally {
                jest.useRealTimers();
            }
        });

        test('the same failure re-surfaces (debug → warn) when the LAN path drops', () => {
            jest.useFakeTimers();
            try {
                let lanUp = true;
                const dev = makeDevice(makeApi(), null, {key: 'abc', isLanConnected: () => lanUp});
                const warn = jest.spyOn(log, 'warn');
                const err = new Error('permission deny (code 1106)');

                dev._onConnectFailure(err);        // LAN up → harmless, debug only
                expect(warn).not.toHaveBeenCalled();

                lanUp = false;
                dev._onConnectFailure(err);        // identical error, but LAN now down → surfaced
                expect(warn).toHaveBeenCalledTimes(1);
                expect(warn.mock.calls[0][0]).toContain("isn't reachable over the LAN");
            } finally {
                jest.useRealTimers();
            }
        });

        test('permission-deny adds the offline-unbinding hint; an unrelated error does not', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi(), null, {key: 'abc'}); // LAN-capable, LAN down
                const warn = jest.spyOn(log, 'warn');

                dev._onConnectFailure(new Error('permission deny (code 1106)'));
                expect(warn.mock.calls[0][0]).toContain('offline for a long time');

                dev._onConnectFailure(new Error('request timed out'));
                expect(warn.mock.calls[1][0]).not.toContain('offline for a long time');
            } finally {
                jest.useRealTimers();
            }
        });

        test('a different error message is surfaced again, not suppressed', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi(), null, {key: 'abc'});
                const warn = jest.spyOn(log, 'warn');

                dev._onConnectFailure(new Error('permission deny (code 1106)'));
                dev._onConnectFailure(new Error('request timed out'));
                expect(warn).toHaveBeenCalledTimes(2);
            } finally {
                jest.useRealTimers();
            }
        });

        test('backoff is capped at 30 minutes', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi(), null, {key: 'abc'});
                jest.spyOn(log, 'warn');
                jest.spyOn(log, 'debug');
                const err = new Error('permission deny (code 1106)');

                for (let i = 0; i < 20; i++) dev._onConnectFailure(err);
                expect(dev._retryDelay).toBe(1800000);
            } finally {
                jest.useRealTimers();
            }
        });

        test('reconnecting after a failure logs recovery once and resets backoff', async () => {
            const dev = makeDevice(makeApi(), null, {key: 'abc'});
            dev._lastConnectError = 'permission deny (code 1106)';
            dev._retryDelay = 240000;
            const info = jest.spyOn(log, 'info');

            await dev._connect(); // mocked api resolves → success path runs

            expect(dev._lastConnectError).toBeNull();
            expect(dev._retryDelay).toBe(0);
            expect(info).toHaveBeenCalledWith(expect.stringContaining('connection restored'));
        });

        test('a stopped device does not schedule another retry', () => {
            jest.useFakeTimers();
            try {
                const dev = makeDevice(makeApi(), null, {key: 'abc'});
                jest.spyOn(log, 'warn');
                dev.stop();
                dev._onConnectFailure(new Error('permission deny (code 1106)'));
                expect(dev._retryTimer).toBeNull();
            } finally {
                jest.useRealTimers();
            }
        });
    });
});
