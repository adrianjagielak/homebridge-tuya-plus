'use strict';

const EventEmitter = require('events');
const TuyaCloudDevice = require('../lib/TuyaCloudDevice');

const log = {info: () => {}, warn: () => {}, error: () => {}, debug: () => {}};

function makeApi(status = [{code: 'switch_1', value: false}, {code: 'battery_percentage', value: 99}]) {
    return {
        isConfigured: () => true,
        getStatus: jest.fn().mockResolvedValue(status),
        getDeviceInfo: jest.fn().mockResolvedValue({online: true}),
        sendCommands: jest.fn().mockResolvedValue(true),
        sendProperties: jest.fn().mockResolvedValue(true)
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

    test('a translated write is dispatched to the (iot-03) commands API', async () => {
        const api = makeApi();
        api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'wfh_close', dp_id: 102, value: false}]);
        const dev = makeDevice(api, null, {key: 'abc'});
        await dev._connect();

        await dev.update({'102': true});
        expect(api.sendCommands).toHaveBeenCalledWith('dev1', [{code: 'wfh_close', value: true}]);
        expect(api.sendProperties).not.toHaveBeenCalled();
    });

    // A fully-custom device (e.g. a gate controller) is rejected by every /commands
    // API with 2008; the plugin must fall back to the thing-model property endpoint
    // on its own, with no configuration.
    describe('automatic control-endpoint fallback', () => {
        const gate = async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'wfh_close', dp_id: 102, value: false}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();
            return {api, dev};
        };

        test('a 2008 from commands falls back to the thing-model property endpoint', async () => {
            const {api, dev} = await gate();
            api.sendCommands.mockRejectedValue(new Error('POST /v1.0/iot-03/devices/dev1/commands failed: command or value not support (code 2008)'));

            await expect(dev.update({'102': true})).resolves.toBe(true);
            expect(api.sendCommands).toHaveBeenCalledWith('dev1', [{code: 'wfh_close', value: true}]);
            expect(api.sendProperties).toHaveBeenCalledWith('dev1', [{code: 'wfh_close', value: true}]);
        });

        test('once the property endpoint works it is used directly (no repeat doomed command)', async () => {
            const {api, dev} = await gate();
            api.sendCommands.mockRejectedValue(new Error('command or value not support (code 2008)'));

            await dev.update({'102': true}); // probes: commands → properties
            await dev.update({'102': false}); // should go straight to properties
            expect(api.sendCommands).toHaveBeenCalledTimes(1);
            expect(api.sendProperties).toHaveBeenCalledTimes(2);
        });

        test('a non-instruction failure (network) does NOT probe the thing model', async () => {
            const {api, dev} = await gate();
            api.sendCommands.mockRejectedValue(new Error('request timed out'));

            await expect(dev.update({'102': true})).resolves.toBe(false);
            expect(api.sendProperties).not.toHaveBeenCalled();
        });

        test('the property fallback is probed only once when it also fails', async () => {
            const {api, dev} = await gate();
            api.sendCommands.mockRejectedValue(new Error('command or value not support (code 2008)'));
            api.sendProperties.mockRejectedValue(new Error('command or value not support (code 2008)'));

            await dev.update({'102': true});
            await dev.update({'102': true});
            expect(api.sendProperties).toHaveBeenCalledTimes(1);
            expect(api.sendCommands).toHaveBeenCalledTimes(2);
        });

        // The crux: a single device with a normal DP (standard instruction set) and
        // a custom DP (thing model only) must drive EACH over its own endpoint.
        test('a mixed device routes each data-point to the endpoint it accepts', async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([
                {code: 'switch_1', dp_id: 1, value: false},   // standard → commands
                {code: 'wfh_open', dp_id: 101, value: false}  // custom → properties only
            ]);
            // The commands API accepts switch_1 but rejects any batch containing wfh_open.
            api.sendCommands.mockImplementation((id, cmds) =>
                cmds.some(c => c.code === 'wfh_open')
                    ? Promise.reject(new Error('command or value not support (code 2008)'))
                    : Promise.resolve(true));
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();

            await dev.update({'1': true});    // learns switch_1 → commands
            await dev.update({'101': true});  // commands 2008 → learns wfh_open → properties

            api.sendCommands.mockClear();
            api.sendProperties.mockClear();

            // A write touching both now splits: switch_1 over commands, wfh_open over properties.
            await expect(dev.update({'1': false, '101': true})).resolves.toBe(true);
            expect(api.sendCommands).toHaveBeenCalledWith('dev1', [{code: 'switch_1', value: false}]);
            expect(api.sendProperties).toHaveBeenCalledWith('dev1', [{code: 'wfh_open', value: true}]);
        });

        // HomeKit often double-sends a write; running the two concurrently used to
        // race the learning (the 2nd saw the code "tried" but not yet learned and
        // failed). Serializing writes per device fixes it.
        test('concurrent duplicate writes of an unknown code are serialized, not raced', async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'Power', dp_id: 1, value: false}]);
            api.sendCommands.mockImplementation((id, cmds) =>
                cmds.some(c => c.code === 'Power')
                    ? Promise.reject(new Error('command or value not support (code 2008)'))
                    : Promise.resolve(true));
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();
            const warn = jest.spyOn(log, 'warn');

            const [a, b] = await Promise.all([dev.update({'1': true}), dev.update({'1': true})]);

            expect(a).toBe(true);
            expect(b).toBe(true);
            expect(warn).not.toHaveBeenCalled();               // the 2nd write didn't spuriously fail
            expect(api.sendCommands).toHaveBeenCalledTimes(1);  // only the 1st probed commands
            jest.restoreAllMocks();
        });
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

    describe('cloud state sync', () => {
        test('the post-write catch-up re-reads the shadow and emits the resulting change', async () => {
            const api = makeApi();
            let rs = 13;
            api.getShadowProperties = jest.fn(async () => [{code: 'return_state', dp_id: 105, value: rs}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect(); // state: return_state=13, '105'=13

            const changes = [];
            dev.on('change', c => changes.push(c));
            rs = 12; // the gate is now "opening" in the cloud
            await dev._catchupOnce();
            expect(changes[0]).toEqual({return_state: 12, '105': 12});
        });

        test('a successful cloud write arms a state catch-up', async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'switch_1', dp_id: 1, value: false}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();
            expect(dev._catchupTimers).toBeNull();
            await dev.update({'1': true});
            expect(Array.isArray(dev._catchupTimers)).toBe(true);
            dev.stop();
        });

        test('a realtime update cancels the pending catch-up (no redundant read on MQTT-covered devices)', async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'switch_1', dp_id: 1, value: false}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();
            await dev.update({'1': true});
            expect(Array.isArray(dev._catchupTimers)).toBe(true);

            dev._onRealtime([{code: 'switch_1', value: true}]); // MQTT delivers → catch-up not needed
            expect(dev._catchupTimers).toBeNull();
            dev.stop();
        });

        test('a refresh reads via the shadow, so a thing-model device whose /status is empty still updates', async () => {
            const api = makeApi();
            let rs = 13;
            api.getStatus = jest.fn().mockResolvedValue([]); // thing-model-only device: /status comes back empty
            api.getShadowProperties = jest.fn(async () => [{code: 'return_state', dp_id: 105, value: rs}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();

            const changes = [];
            dev.on('change', c => changes.push(c));
            rs = 12;
            await dev._refreshState();

            expect(api.getShadowProperties).toHaveBeenCalled();
            expect(changes.some(c => c['105'] === 12)).toBe(true);
            expect(dev.state['105']).toBe(12); // not wiped by the empty /status
        });
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

    describe('write-failure handling (no log spam)', () => {
        afterEach(() => jest.restoreAllMocks());

        // A LAN-style accessory (numeric dps) over a cloud project that never
        // learned the id→code map: the write can't be addressed, so it must not be
        // fired (it would always be a 2008), and the cause is surfaced just once.
        test('a numeric write with no learned code map is skipped, not sent, and surfaced once', async () => {
            const api = makeApi(); // /status only → no dp map
            const dev = makeDevice(api, null, {key: 'abc'}); // LAN-capable, LAN down here
            await dev._connect();
            expect(dev.codeByDpId).toEqual({});

            const warn = jest.spyOn(log, 'warn');
            const debug = jest.spyOn(log, 'debug');

            expect(dev.update({'1': true})).toBe(false);
            expect(api.sendCommands).not.toHaveBeenCalled();
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain('over the Tuya Cloud');

            dev.update({'1': true}); // identical → quiet at debug, still not sent
            expect(warn).toHaveBeenCalledTimes(1);
            expect(debug).toHaveBeenCalledWith(expect.stringContaining('cloud write skipped'));
            expect(api.sendCommands).not.toHaveBeenCalled();
        });

        test('the undeliverable-write note is harmless (debug) while the device is reachable over the LAN', async () => {
            const dev = makeDevice(makeApi(), null, {key: 'abc', isLanConnected: () => true});
            await dev._connect();
            const warn = jest.spyOn(log, 'warn');
            const debug = jest.spyOn(log, 'debug');

            expect(dev.update({'1': true})).toBe(false);
            expect(warn).not.toHaveBeenCalled();
            expect(debug).toHaveBeenCalledWith(expect.stringContaining('over the Tuya Cloud'));
        });

        test('a cloud-only device (no key) surfaces the undeliverable write at error level', async () => {
            const dev = makeDevice(makeApi()); // no key → cloud is the only path
            await dev._connect();
            const error = jest.spyOn(log, 'error');
            const warn = jest.spyOn(log, 'warn');

            expect(dev.update({'1': true})).toBe(false);
            expect(warn).not.toHaveBeenCalled();
            expect(error).toHaveBeenCalledTimes(1);
        });

        // A genuinely dispatched command that the cloud rejects (e.g. a real 2008
        // on a mapped code): surface once, then suppress identical repeats to debug.
        test('a repeated cloud command failure is surfaced once then suppressed to debug', async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'switch_1', dp_id: 1, value: false}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();

            const warn = jest.spyOn(log, 'warn');
            const debug = jest.spyOn(log, 'debug');
            const ex = new Error('POST /v1.0/iot-03/devices/dev1/commands failed: command or value not support (code 2008)');
            api.sendCommands.mockRejectedValue(ex);
            api.sendProperties.mockRejectedValue(ex); // thing-model fallback can't rescue it either

            await dev.update({'1': true}); // mapped → dispatched → rejected by both endpoints
            expect(api.sendCommands).toHaveBeenCalledWith('dev1', [{code: 'switch_1', value: true}]);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0][0]).toContain('code 2008');

            await dev.update({'1': true}); // identical failure → quiet
            expect(warn).toHaveBeenCalledTimes(1);
            expect(debug).toHaveBeenCalledWith(expect.stringContaining('still failing'));
        });

        test('a command failure re-surfaces after an intervening success', async () => {
            const api = makeApi();
            api.getShadowProperties = jest.fn().mockResolvedValue([{code: 'switch_1', dp_id: 1, value: false}]);
            const dev = makeDevice(api, null, {key: 'abc'});
            await dev._connect();
            const warn = jest.spyOn(log, 'warn');
            api.sendProperties.mockRejectedValue(new Error('command or value not support (code 2008)')); // fallback can't rescue

            api.sendCommands.mockRejectedValueOnce(new Error('command or value not support (code 2008)'));
            await dev.update({'1': true});
            expect(warn).toHaveBeenCalledTimes(1);

            api.sendCommands.mockResolvedValueOnce(true); // success clears the dedup
            await dev.update({'1': true});

            api.sendCommands.mockRejectedValueOnce(new Error('command or value not support (code 2008)'));
            await dev.update({'1': true});
            expect(warn).toHaveBeenCalledTimes(2);
        });
    });
});
