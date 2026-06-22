'use strict';

// Protocol-level tests for TuyaAccessory.
//
// Covers version routing (3.1 - 3.5), packet construction/parsing for the
// 0x55AA (ECB/HMAC) and 0x6699 (GCM) stacks, the 3.4+/3.5+ session-key
// handshake, and forward compatibility: a device reporting a newer protocol
// version (e.g. a future 3.6) must be served by the newest (3.5/GCM) stack
// with the reported version string in payload headers - never by a broken
// mix of legacy paths.

const crypto = require('crypto');
const EventEmitter = require('events');
const TuyaAccessory = require('../lib/TuyaAccessory');
const TuyaDiscovery = require('../lib/TuyaDiscovery');

const KEY = '0123456789abcdef'; // 16-byte AES-128 local key

const makeLog = () => {
    const log = jest.fn();
    log.info = jest.fn();
    log.warn = jest.fn();
    log.error = jest.fn();
    log.debug = jest.fn();
    return log;
};

const makeDevice = (version, extra = {}) => new TuyaAccessory({
    id: 'bf1234567890abcdef12',
    key: KEY,
    ip: '192.168.1.50',
    name: 'Protocol Test Device',
    version,
    connect: false,
    log: makeLog(),
    ...extra,
});

const attachSocketStub = device => {
    const written = [];
    device.connected = true;
    device._socket = {
        write: buf => { written.push(buf); return true; },
        _ping: jest.fn(),
    };
    return written;
};

// ---- 0x6699 (3.5+) frame helpers, mirroring the documented format ----

const buildPacket35 = (key, cmd, seq, plainPayload) => {
    const iv = crypto.randomBytes(12);
    const unknown = Buffer.alloc(2);
    const seqBuf = Buffer.alloc(4); seqBuf.writeUInt32BE(seq, 0);
    const cmdBuf = Buffer.alloc(4); cmdBuf.writeUInt32BE(cmd, 0);
    const lenBuf = Buffer.alloc(4); lenBuf.writeUInt32BE(12 + plainPayload.length + 16, 0);
    const aad = Buffer.concat([unknown, seqBuf, cmdBuf, lenBuf]);

    const cipher = crypto.createCipheriv('aes-128-gcm', key, iv);
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plainPayload), cipher.final()]);
    const tag = cipher.getAuthTag();

    return Buffer.concat([
        Buffer.from('00006699', 'hex'),
        aad,
        iv,
        encrypted,
        tag,
        Buffer.from('00009966', 'hex'),
    ]);
};

const decryptPacket35 = (key, pkt) => {
    const len = pkt.length;
    const iv = pkt.slice(18, 30);
    const encrypted = pkt.slice(30, len - 20);
    const tag = pkt.slice(len - 20, len - 4);
    const aad = pkt.slice(4, 18);

    const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
};

// "3.x" + 12 null bytes + retcode-less payload (client -> device has no retcode)
const versionHeader = version => Buffer.concat([Buffer.from(version), Buffer.alloc(12)]);

// PKCS#7 used by 3.4 (ECB without auto padding)
const pkcs7pad = data => {
    const padding = 0x10 - (data.length & 0xf);
    return Buffer.concat([data, Buffer.alloc(padding, padding)]);
};

const ecbEncrypt = (key, data) => {
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    cipher.setAutoPadding(false);
    const out = cipher.update(pkcs7pad(data));
    cipher.final();
    return out;
};

const hmac256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// CRC32 as used by the 3.2/3.3 frames
const crc32Table = (() => {
    const table = [];
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 8; j > 0; j--) crc = (crc & 1) ? (crc >>> 1) ^ 3988292384 : crc >>> 1;
        table.push(crc);
    }
    return table;
})();
const crc32 = buffer => {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) crc = crc32Table[buffer[i] ^ (crc & 0xff)] ^ (crc >>> 8);
    return ~crc;
};

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

describe('protocol version normalization', () => {
    test.each([
        ['3.1', '3.1', 3.1],
        ['3.3', '3.3', 3.3],
        [3.3, '3.3', 3.3],     // numbers from config.json
        ['3.4', '3.4', 3.4],
        [3.4, '3.4', 3.4],
        ['3.5', '3.5', 3.5],
        ['3.6', '3.6', 3.6],   // future version: kept verbatim for headers
        [3.6, '3.6', 3.6],
        [undefined, '3.5', 3.5],
        ['', '3.5', 3.5],
    ])('version %p becomes context %p / numeric %p', (input, expectedStr, expectedNum) => {
        const device = makeDevice(input);
        expect(device.context.version).toBe(expectedStr);
        expect(device._protocolVersion).toBe(expectedNum);
    });

    test('unparseable version falls back to 3.5 with a warning', () => {
        const device = makeDevice('bananas');
        expect(device.context.version).toBe('3.5');
        expect(device._protocolVersion).toBe(3.5);
        expect(device.log.warn).toHaveBeenCalled();
    });

    test('versions newer than 3.5 log an informational note', () => {
        const device = makeDevice('3.6');
        expect(device.log.info).toHaveBeenCalledWith(expect.stringContaining('3.6'));
    });
});

describe('message handler routing', () => {
    const HANDLERS = ['_msgHandler_3_1', '_msgHandler_3_3', '_msgHandler_3_4', '_msgHandler_3_5'];

    const selectedHandler = async version => {
        const spies = {};
        HANDLERS.forEach(name => {
            spies[name] = jest.spyOn(TuyaAccessory.prototype, name)
                .mockImplementation((task, callback) => callback());
        });

        const device = makeDevice(version);
        await device._msgQueue.push({msg: Buffer.alloc(0)});

        const called = HANDLERS.filter(name => spies[name].mock.calls.length > 0);
        expect(called).toHaveLength(1);
        return called[0];
    };

    test.each([
        ['3.1', '_msgHandler_3_1'],
        ['3.2', '_msgHandler_3_3'], // 3.2 shares the 3.3 stack
        ['3.3', '_msgHandler_3_3'],
        [3.3, '_msgHandler_3_3'],
        ['3.4', '_msgHandler_3_4'],
        [3.4, '_msgHandler_3_4'],
        ['3.5', '_msgHandler_3_5'],
        ['3.6', '_msgHandler_3_5'], // newer than 3.5: newest stack
        [3.6, '_msgHandler_3_5'],
        [undefined, '_msgHandler_3_5'],
    ])('version %p uses %s', async (version, expected) => {
        expect(await selectedHandler(version)).toBe(expected);
    });
});

describe('send routing', () => {
    const SENDERS = ['_send_3_1', '_send_3_3', '_send_3_4', '_send_3_5'];

    const selectedSender = version => {
        const spies = {};
        SENDERS.forEach(name => {
            spies[name] = jest.spyOn(TuyaAccessory.prototype, name).mockReturnValue(true);
        });

        const device = makeDevice(version);
        device.connected = true;
        device._send({cmd: 9});

        const called = SENDERS.filter(name => spies[name].mock.calls.length > 0);
        expect(called).toHaveLength(1);
        return called[0];
    };

    test.each([
        ['3.1', '_send_3_1'],
        ['3.2', '_send_3_3'],
        ['3.3', '_send_3_3'],
        [3.3, '_send_3_3'],
        ['3.4', '_send_3_4'],
        [3.4, '_send_3_4'],
        ['3.5', '_send_3_5'],
        ['3.6', '_send_3_5'],
        [3.6, '_send_3_5'],
    ])('version %p uses %s', (version, expected) => {
        expect(selectedSender(version)).toBe(expected);
    });
});

describe('0x6699 (3.5+) sends', () => {
    test('control packet for a 3.6 device is valid GCM with a 3.6 version header', () => {
        const device = makeDevice('3.6');
        const written = attachSocketStub(device);

        expect(device.update({1: true})).toBe(true);
        expect(written).toHaveLength(1);

        const pkt = written[0];
        expect(pkt.readUInt32BE(0)).toBe(0x00006699);
        expect(pkt.readUInt32BE(pkt.length - 4)).toBe(0x00009966);
        expect(pkt.readUInt32BE(10)).toBe(13); // CONTROL_NEW
        // length field counts IV + ciphertext + tag
        expect(pkt.readUInt32BE(14)).toBe(pkt.length - 22);

        const plain = decryptPacket35(KEY, pkt); // throws on AAD/tag mismatch
        expect(plain.slice(0, 3).toString()).toBe('3.6');
        expect([...plain.slice(3, 15)].every(b => b === 0)).toBe(true);

        const json = JSON.parse(plain.slice(15).toString());
        expect(json.protocol).toBe(5);
        expect(json.data.dps).toEqual({'1': true});
        expect(json.data.devId).toBe(device.context.id);
    });

    test('initial query for 3.5+/3.6 devices uses DP_QUERY_NEW (16) without version header', () => {
        const device = makeDevice('3.6');
        const written = attachSocketStub(device);

        device.update();
        const pkt = written[0];
        expect(pkt.readUInt32BE(10)).toBe(16);

        const json = JSON.parse(decryptPacket35(KEY, pkt).toString());
        expect(json.gwId).toBe(device.context.id);
        expect(json.devId).toBe(device.context.id);
    });

    test('control packet for a 3.5 device keeps the 3.5 version header', () => {
        const device = makeDevice('3.5');
        const written = attachSocketStub(device);

        device.update({2: 'low'});
        const plain = decryptPacket35(KEY, written[0]);
        expect(plain.slice(0, 3).toString()).toBe('3.5');
    });
});

describe('0x6699 (3.5+) receives', () => {
    const statusPayload = (version, dps) => Buffer.concat([
        Buffer.alloc(4), // return code
        versionHeader(version),
        Buffer.from(JSON.stringify({protocol: 4, t: 1750000000, data: {dps}})),
    ]);

    test('a 3.6 device status push decodes and updates state', async () => {
        const device = makeDevice('3.6');
        const changes = [];
        device.on('change', c => changes.push(c));

        const pkt = buildPacket35(KEY, 8, 7, statusPayload('3.6', {'1': true, '4': 22}));
        await new Promise(resolve => device._msgHandler_3_5({msg: pkt}, resolve));

        expect(changes).toEqual([{'1': true, '4': 22}]);
        expect(device.state).toEqual({'1': true, '4': 22});
    });

    test('version header mismatch is tolerated (device answers 3.5, configured 3.6)', async () => {
        const device = makeDevice('3.6');
        const pkt = buildPacket35(KEY, 8, 8, statusPayload('3.5', {'20': false}));
        await new Promise(resolve => device._msgHandler_3_5({msg: pkt}, resolve));
        expect(device.state).toEqual({'20': false});
    });

    test('DP_QUERY_NEW (16) responses without version header decode', async () => {
        const device = makeDevice('3.5');
        const payload = Buffer.concat([
            Buffer.alloc(4),
            Buffer.from(JSON.stringify({dps: {'1': false}})),
        ]);
        const pkt = buildPacket35(KEY, 16, 2, payload);
        await new Promise(resolve => device._msgHandler_3_5({msg: pkt}, resolve));
        expect(device.state).toEqual({'1': false});
    });

    test('messages are decrypted with the session key once negotiated', async () => {
        const device = makeDevice('3.6');
        device.session_key = crypto.randomBytes(16);

        const pkt = buildPacket35(device.session_key, 8, 9, statusPayload('3.6', {'3': 'auto'}));
        await new Promise(resolve => device._msgHandler_3_5({msg: pkt}, resolve));
        expect(device.state).toEqual({'3': 'auto'});
    });
});

describe('3.5+ session key negotiation', () => {
    test.each(['3.5', '3.6'])('handshake derives the session key and queries state (version %s)', async version => {
        jest.useFakeTimers();

        const device = makeDevice(version);
        const written = attachSocketStub(device);
        const connected = jest.fn();
        device.on('connect', connected);

        // Normally generated when the socket becomes ready (BIND / cmd 3)
        device._tmpLocalKey = crypto.randomBytes(16);

        // Device replies to BIND with: retcode + remote nonce + HMAC(local nonce)
        const remoteNonce = crypto.randomBytes(16);
        const sessNegResponse = Buffer.concat([
            Buffer.alloc(4),
            remoteNonce,
            hmac256(KEY, device._tmpLocalKey),
        ]);
        const pkt = buildPacket35(KEY, 4, 1, sessNegResponse);
        await new Promise(resolve => device._msgHandler_3_5({msg: pkt}, resolve));

        // Expected session key: GCM(localNonce XOR remoteNonce) under the local
        // key with IV = first 12 bytes of the local nonce
        const xored = Buffer.from(device._tmpLocalKey);
        for (let i = 0; i < xored.length; i++) xored[i] ^= remoteNonce[i];
        const cipher = crypto.createCipheriv('aes-128-gcm', KEY, device._tmpLocalKey.slice(0, 12));
        cipher.setAAD(Buffer.alloc(0));
        const expectedSessionKey = Buffer.concat([cipher.update(xored), cipher.final()]);

        expect(Buffer.isBuffer(device.session_key)).toBe(true);
        expect(device.session_key.equals(expectedSessionKey)).toBe(true);
        expect(connected).toHaveBeenCalled();

        // First write: SESS_KEY_NEG_FINISH (cmd 5) carrying HMAC(remote nonce),
        // still encrypted with the local key
        expect(written.length).toBe(2);
        expect(written[0].readUInt32BE(10)).toBe(5);
        expect(decryptPacket35(KEY, written[0]).equals(hmac256(KEY, remoteNonce))).toBe(true);

        // Second write: state query (cmd 16) already under the session key
        expect(written[1].readUInt32BE(10)).toBe(16);
        const query = JSON.parse(decryptPacket35(device.session_key, written[1]).toString());
        expect(query.gwId).toBe(device.context.id);

        jest.clearAllTimers();
    });

    test('handshake aborts on local-nonce HMAC mismatch', async () => {
        jest.useFakeTimers();

        const device = makeDevice('3.6');
        attachSocketStub(device);
        device._tmpLocalKey = crypto.randomBytes(16);

        const badResponse = Buffer.concat([
            Buffer.alloc(4),
            crypto.randomBytes(16),
            crypto.randomBytes(32), // wrong HMAC
        ]);
        const pkt = buildPacket35(KEY, 4, 1, badResponse);

        expect(() => device._msgHandler_3_5({msg: pkt}, () => {})).toThrow(/HMAC mismatch/);
        expect(device.session_key).toBeNull();

        jest.clearAllTimers();
    });
});

describe('0x55AA (3.4) stack', () => {
    test('control packet is ECB-encrypted with a 3.4 header and valid HMAC', () => {
        const device = makeDevice('3.4');
        const written = attachSocketStub(device);

        device.update({1: false});
        const pkt = written[0];
        const len = pkt.length;

        expect(pkt.readUInt32BE(0)).toBe(0x000055aa);
        expect(pkt.readUInt32BE(len - 4)).toBe(0x0000aa55);
        expect(pkt.readUInt32BE(8)).toBe(13); // CONTROL_NEW
        expect(pkt.readUInt32BE(12)).toBe(len - 16); // ciphertext + hmac + suffix

        const mac = pkt.slice(len - 36, len - 4);
        expect(mac.equals(hmac256(KEY, pkt.slice(0, len - 36)))).toBe(true);

        const decipher = crypto.createDecipheriv('aes-128-ecb', KEY, null);
        decipher.setAutoPadding(false);
        let plain = decipher.update(pkt.slice(16, len - 36));
        decipher.final();
        plain = plain.slice(0, plain.length - plain[plain.length - 1]);

        expect(plain.slice(0, 3).toString()).toBe('3.4');
        const json = JSON.parse(plain.slice(15).toString());
        expect(json.protocol).toBe(5);
        expect(json.data.dps).toEqual({'1': false});
    });

    test('status push (cmd 8) with retcode and encrypted 3.4 header updates state', async () => {
        const device = makeDevice('3.4');

        const plain = Buffer.concat([
            versionHeader('3.4'),
            Buffer.from(JSON.stringify({protocol: 4, t: 1750000000, data: {dps: {'5': 'mid'}}})),
        ]);
        const encrypted = ecbEncrypt(KEY, plain);

        const header = Buffer.alloc(16);
        header.writeUInt32BE(0x000055aa, 0);
        header.writeUInt32BE(3, 4); // seq
        header.writeUInt32BE(8, 8); // STATUS
        header.writeUInt32BE(4 + encrypted.length + 36, 12); // retcode + payload + hmac + suffix
        const retcode = Buffer.alloc(4);

        const body = Buffer.concat([header, retcode, encrypted]);
        const pkt = Buffer.concat([body, hmac256(KEY, body), Buffer.from('0000aa55', 'hex')]);

        await new Promise(resolve => device._msgHandler_3_4({msg: pkt}, resolve));
        expect(device.state).toEqual({'5': 'mid'});
    });
});

describe('0x55AA (3.2/3.3) stack', () => {
    test('3.2 devices send control packets with a cleartext 3.2 header', () => {
        const device = makeDevice('3.2');
        const written = attachSocketStub(device);

        device.update({1: true});
        const pkt = written[0];
        const len = pkt.length;

        expect(pkt.readUInt32BE(0)).toBe(0x000055aa);
        expect(pkt.readUInt32BE(8)).toBe(7); // CONTROL
        expect(pkt.slice(16, 19).toString()).toBe('3.2');
        expect(pkt.readInt32BE(len - 8)).toBe(crc32(pkt.slice(0, len - 8)));

        const decipher = crypto.createDecipheriv('aes-128-ecb', KEY, '');
        const plain = Buffer.concat([decipher.update(pkt.slice(31, len - 8)), decipher.final()]);
        expect(JSON.parse(plain.toString()).dps).toEqual({'1': true});
    });

    test('3.3 devices keep the 3.3 cleartext header', () => {
        const device = makeDevice('3.3');
        const written = attachSocketStub(device);

        device.update({1: true});
        expect(written[0].slice(16, 19).toString()).toBe('3.3');
    });

    test('3.3 initial query uses DP_QUERY (10)', () => {
        const device = makeDevice('3.3');
        const written = attachSocketStub(device);

        device.update();
        expect(written[0].readUInt32BE(8)).toBe(10);
    });

    test('3.2 status messages decode through the 3.3 handler', async () => {
        const device = makeDevice('3.2');

        const json = Buffer.from(JSON.stringify({dps: {'1': true}}));
        const cipher = crypto.createCipheriv('aes-128-ecb', KEY, '');
        const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);

        const header = Buffer.alloc(16);
        header.writeUInt32BE(0x000055aa, 0);
        header.writeUInt32BE(1, 4);
        header.writeUInt32BE(8, 8); // STATUS
        header.writeUInt32BE(15 + encrypted.length + 8, 12);
        const pkt = Buffer.concat([
            header,
            versionHeader('3.2'),
            encrypted,
            Buffer.alloc(4), // crc (not validated on receive)
            Buffer.from('0000aa55', 'hex'),
        ]);

        await new Promise(resolve => device._msgHandler_3_3({msg: pkt}, resolve));
        expect(device.state).toEqual({'1': true});
    });
});

describe('discovery of 3.5+/3.6 devices', () => {
    const GCM_DISCOVERY_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest();

    afterEach(() => {
        TuyaDiscovery.removeAllListeners();
        TuyaDiscovery.discovered.clear();
        TuyaDiscovery.limitedIds.splice(0);
    });

    test('a 6699 broadcast advertising version 3.6 is passed through verbatim', () => {
        TuyaDiscovery.log = makeLog();

        const payload = Buffer.concat([
            Buffer.alloc(4),
            Buffer.from(JSON.stringify({ip: '192.168.1.99', gwId: 'bf9999999999999999ff', version: '3.6'})),
        ]);
        const pkt = buildPacket35(GCM_DISCOVERY_KEY, 0, 1, payload);

        const found = [];
        TuyaDiscovery.on('discover', d => found.push(d));
        TuyaDiscovery._handleV35(pkt, 7000, {address: '192.168.1.99'});

        expect(found).toHaveLength(1);
        expect(found[0].id).toBe('bf9999999999999999ff');
        expect(found[0].ip).toBe('192.168.1.99');
        expect(found[0].version).toBe('3.6');
    });
});

// Many Tuya devices (e.g. LED ceiling lights) recycle their long-lived LAN
// sockets every few minutes, closing the connection with a TCP FIN ('end').
// The handler must tear that connection down and reconnect promptly instead of
// leaving a half-dead socket whose stale heartbeat timer later fires a
// misleading ERR_PING_TIMED_OUT - which used to be the only thing that
// triggered a reconnect.
describe('graceful disconnect handling', () => {
    const net = require('net');
    let realNetSocket;
    let createdSockets;

    const makeFakeSocket = () => {
        const s = new EventEmitter();
        s.destroyed = false;
        s.setKeepAlive = () => {};
        s.setNoDelay = () => {};
        s.connect = jest.fn();
        s.write = jest.fn(() => true);
        s.destroy = jest.fn(function destroy() { this.destroyed = true; });
        return s;
    };

    beforeEach(() => {
        jest.useFakeTimers();
        createdSockets = [];
        realNetSocket = net.Socket;
        // TuyaAccessory calls net.Socket() dynamically, so swapping the property
        // is enough to hand it a controllable fake (no real network I/O).
        net.Socket = function FakeSocket() {
            const s = makeFakeSocket();
            createdSockets.push(s);
            return s;
        };
    });

    afterEach(() => {
        net.Socket = realNetSocket;
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    // Bring a device up to a steady, connected state on a fake socket.
    const establish = device => {
        device._connect();
        const socket = device._socket;
        // An established connection has already cleared its connect watchdog.
        clearTimeout(socket._connTimeout);
        socket._connTimeout = null;
        device.connected = true;
        return socket;
    };

    test("a device-initiated 'end' clears the heartbeat, tears down, and schedules a reconnect without a spurious ping timeout", () => {
        const device = makeDevice('3.5');
        const socket = establish(device);

        // A heartbeat retry timer is in flight. With the old handler it survived
        // the disconnect and later emitted a misleading ERR_PING_TIMED_OUT.
        const pingErrors = [];
        socket.on('error', err => {
            if (err && err.message === 'ERR_PING_TIMED_OUT') pingErrors.push(err);
        });
        socket._pinger = setTimeout(
            () => device._socket.emit('error', new Error('ERR_PING_TIMED_OUT')),
            50
        );

        // The device closes the LAN connection on its own (TCP FIN -> 'end').
        socket.emit('end');

        expect(device.connected).toBe(false);
        expect(socket._pinger).toBeNull();             // stale timer cleared
        expect(socket.destroy).toHaveBeenCalledTimes(1); // socket torn down
        expect(socket._errorReconnect).toBeTruthy();     // a reconnect is scheduled

        // Advance well past where the leaked timer would have fired: it must not.
        jest.advanceTimersByTime(1000);
        expect(pingErrors).toHaveLength(0);

        // The log reflects a clean disconnect, never a ping failure. (A device
        // recycling its socket is routine, so the disconnect is logged at debug.)
        expect(device.log.debug).toHaveBeenCalledWith('Disconnected from', device.context.name);
        const logged = device.log.debug.mock.calls.flat().join(' ');
        expect(logged).not.toMatch(/ERR_PING_TIMED_OUT/);
    });

    test("the 'close' teardown clears any lingering heartbeat timer", () => {
        const device = makeDevice('3.5');
        const socket = establish(device);

        socket._pinger = setTimeout(() => {}, 10000);
        socket.emit('close');

        expect(socket._pinger).toBeNull();
        expect(device.connected).toBe(false);
    });
});
