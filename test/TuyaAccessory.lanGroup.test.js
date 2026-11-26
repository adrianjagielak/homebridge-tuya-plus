'use strict';

const crypto = require('crypto');
const TuyaAccessory = require('../lib/TuyaAccessory');
const TuyaDevice = require('../lib/TuyaDevice');
const SimpleLightAccessory = require('../lib/SimpleLightAccessory');
const RGBTWLightAccessory = require('../lib/RGBTWLightAccessory');
const {makeInstance} = require('./support/mocks');

const KEY = '0123456789abcdef';
const GROUP = {cid: '0058', mbid: 'c020'};
const makeLog = () => Object.assign(jest.fn(), {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn()
});
const makeDevice = (extra = {}) => new TuyaAccessory({
    id: 'bf1234567890abcdef12', key: KEY, ip: '192.168.1.50',
    name: 'Group test', version: '3.3', connect: false,
    log: makeLog(), lanGroup: GROUP, ...extra
});
const attachSocket = device => {
    device.connected = true;
    device._socket = {write: jest.fn(() => true)};
    return device._socket.write;
};

// The captured ALUSSO envelope, re-encrypted using a public test key.
// No user key or encrypted user traffic is stored in the repository.
const GOLDEN_OFF = '000055aa000000010000000d00000057332e3300000000000000000000000035dc001e766f5da604f317f994e31d0aa6a13c184f585a8b6b802aa8f554364786f7db64a0e6c864cc800319eea3cdf3337a3659280b727173aa5ac18f64d99d2a084ddb0000aa55';
const report = (data, cmd = 8) => {
    const cipher = crypto.createCipheriv('aes-128-ecb', KEY, null);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
    // The device reports include metadata after the version, not just zeros.
    const header = Buffer.from('332e33000000000000514f00000001', 'hex');
    const packet = Buffer.concat([Buffer.alloc(20), header, encrypted, Buffer.alloc(8)]);
    packet.writeUInt32BE(0x55aa, 0);
    packet.writeUInt32BE(cmd, 8);
    packet.writeUInt32BE(packet.length - 16, 12);
    packet.writeUInt32BE(0xaa55, packet.length - 4);
    return {msg: packet};
};
const receive = (device, data, cmd = 8) => {
    const done = jest.fn();
    device._msgHandler_3_3(report(data, cmd), done);
    expect(done).toHaveBeenCalledTimes(1);
};

describe('Galaxy Link LAN group transport', () => {
    test('emits the verified group OFF frame byte for byte', () => {
        const device = makeDevice();
        const write = attachSocket(device);
        expect(device.update({'1': false})).toBe(true);
        expect(write.mock.calls[0][0].toString('hex')).toBe(GOLDEN_OFF);
    });

    test('does not append a device-only empty update to a group write', () => {
        const device = makeDevice({sendEmptyUpdate: true});
        const write = attachSocket(device);
        device.update({'1': true});
        expect(write).toHaveBeenCalledTimes(1);
        expect(write.mock.calls[0][0].readUInt32BE(8)).toBe(13);
    });

    test('ordinary devices retain their command 7 write envelope', () => {
        const device = makeDevice({lanGroup: undefined});
        const write = attachSocket(device);
        device.update({'1': false});
        const packet = write.mock.calls[0][0];
        expect(packet.readUInt32BE(8)).toBe(7);
        const decipher = crypto.createDecipheriv('aes-128-ecb', KEY, null);
        const plain = Buffer.concat([decipher.update(packet.subarray(31, -8)), decipher.final()]);
        expect(JSON.parse(plain)).toMatchObject({devId: device.context.id, dps: {'1': false}});
    });

    test('accepts reports only from the configured group', () => {
        const device = makeDevice();
        receive(device, {...GROUP, ctype: 2, dps: {'1': true}});
        expect(device.state['1']).toBe(true);
        receive(device, {...GROUP, cid: '0059', ctype: 2, dps: {'1': false}});
        receive(device, {...GROUP, mbid: 'c021', ctype: 2, dps: {'1': false}});
        receive(device, {...GROUP, ctype: 0, dps: {'1': false}});
        receive(device, {dps: {'1': false}});
        expect(device.state['1']).toBe(true);
    });

    test('uses only the first device-query response to bootstrap registration', () => {
        const device = makeDevice();
        receive(device, {dps: {'1': true, '3': 500}}, 10);
        expect(device.state).toEqual({'1': true, '3': 500});
        receive(device, {...GROUP, ctype: 2, dps: {'1': false}});
        receive(device, {dps: {'1': true}}, 10);
        expect(device.state['1']).toBe(false);
    });

    test('retains the existing device-query frame for startup', () => {
        const device = makeDevice();
        const write = attachSocket(device);
        device.update();
        expect(write.mock.calls[0][0].readUInt32BE(8)).toBe(10);
    });

    test.each([
        {version: '3.4'},
        {lanGroup: {cid: '58', mbid: 'c020'}},
        {lanGroup: {cid: '0058'}},
        {lanGroup: {cid: '0058', mbid: 'zzzz'}},
        {lanGroup: true}
    ])('invalid group config disables LAN without throwing: %j', extra => {
        const device = makeDevice(extra);
        const write = attachSocket(device);
        expect(device.update({'1': false})).toBe(false);
        expect(write).not.toHaveBeenCalled();
        expect(device.log.error).toHaveBeenCalledTimes(1);
    });

    test('normalizes hexadecimal address casing', () => {
        expect(makeDevice({lanGroup: {cid: '005A', mbid: 'C020'}}).context.lanGroup)
            .toEqual({cid: '005a', mbid: 'c020'});
    });

    test('does not fall back to a cloud command addressed to one fitting', () => {
        const device = new TuyaDevice({cloudApi: {}, lanGroup: GROUP, connect: false, log: makeLog()});
        expect(device.cloud).toBeNull();
        expect(device.update({'1': true})).toBe(false);
    });
});

describe('HomeKit group writes', () => {
    test('sends an ON request even when the cached group state is already ON', async () => {
        const {instance, device} = makeInstance(SimpleLightAccessory, {'1': true}, {lanGroup: GROUP});
        await instance.setMultiStateAsync({'1': true});
        expect(device.update).toHaveBeenCalledWith({'1': true});
    });

    test('retains duplicate-write suppression for ordinary fittings', async () => {
        const {instance, device} = makeInstance(SimpleLightAccessory, {'1': true});
        await instance.setMultiStateAsync({'1': true});
        expect(device.update).not.toHaveBeenCalled();
    });

    test('sends the same-state request through the callback API too', () => {
        const {instance, device} = makeInstance(SimpleLightAccessory, {'1': true}, {lanGroup: GROUP});
        const done = jest.fn();
        instance.setMultiState({'1': true}, done);
        expect(device.update).toHaveBeenCalledWith({'1': true});
        expect(done).toHaveBeenCalledWith(null);
    });
});

describe('existing RGB light controls through the group transport', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const makeLight = (state, group, extra = {}) => {
        const context = {
            type: 'RGBTWLight', colorFunction: 'HSB', minBrightness: 10,
            scaleBrightness: 1000, scaleWhiteColor: 1000,
            ...(group ? {lanGroup: GROUP} : {}), ...extra
        };
        const result = makeInstance(RGBTWLightAccessory, state, context);
        const transport = makeDevice({lanGroup: group ? GROUP : undefined});
        transport.state = {...state};
        const write = attachSocket(transport);
        result.device.update.mockImplementation(dps => transport.update(dps));
        result.instance._registerCharacteristics(result.device.state);
        const handlers = result.accessory._mockService._mockChar.onSet.mock.calls.map(call => call[0]);
        return {...result, write, handlers};
    };

    const decode = packet => {
        const decipher = crypto.createDecipheriv('aes-128-ecb', KEY, null);
        const plain = Buffer.concat([decipher.update(packet.subarray(31, -8)), decipher.final()]);
        return {command: packet.readUInt32BE(8), payload: JSON.parse(plain)};
    };

    const cases = [
        ['power', 'white', [[0, false]], ['1'], {}],
        ['white brightness', 'white', [[1, 75]], ['3'], {}],
        ['colour brightness', 'colour', [[1, 50]], ['5'], {}],
        ['white temperature', 'colour', [[2, 200]], ['2', '3', '4'], {}],
        ['hue and saturation', 'white', [[3, 120], [4, 80]], ['2', '5'], {}],
        ['custom brightness DP', 'white', [[1, 75]], ['33'], {dpBrightness: 33}]
    ];

    test.each(cases)('%s keeps the existing RGB handler DP values', async (name, mode, actions, expectedDps, context) => {
        const state = {'1': true, '2': mode, '3': 138, '4': 1000, '5': '000003d403e8', '33': 138};
        const individual = makeLight(state, false, context);
        const grouped = makeLight(state, true, context);
        for (const light of [individual, grouped]) {
            const pending = actions.map(([index, value]) => light.handlers[index](value));
            await jest.advanceTimersByTimeAsync(500);
            await Promise.all(pending);
        }
        const normalFrames = individual.write.mock.calls.map(([packet]) => decode(packet));
        const groupFrames = grouped.write.mock.calls.map(([packet]) => decode(packet));
        expect(normalFrames.length).toBeGreaterThan(0);
        expect(groupFrames.map(frame => frame.payload.dps)).toEqual(normalFrames.map(frame => frame.payload.dps));
        expect(Object.keys(Object.assign({}, ...groupFrames.map(frame => frame.payload.dps))).sort()).toEqual(expectedDps.sort());
        for (const frame of normalFrames) {
            expect(frame.command).toBe(7);
            expect(frame.payload).toHaveProperty('devId');
        }
        for (const frame of groupFrames) {
            expect(frame.command).toBe(13);
            expect(frame.payload).toEqual({cid: '0058', ctype: 2, dps: expect.any(Object), mbid: 'c020'});
        }
    });
});
