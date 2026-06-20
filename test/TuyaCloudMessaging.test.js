'use strict';

const crypto = require('crypto');
const TuyaCloudMessaging = require('../lib/TuyaCloudMessaging');

const log = {info: () => {}, warn: () => {}, error: () => {}, debug: () => {}};

// Encrypt exactly like Tuya's msg_encrypted_version 2.0 (AES-128-GCM):
//   [ivLen(4 BE)][iv][ciphertext][tag(16)], key = password[8,24), AAD = 6-byte BE t.
function encryptGCM(plaintext, password, t) {
    const key = Buffer.from(('' + password).substring(8, 24), 'utf8');
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-128-gcm', key, iv);
    const aad = Buffer.allocUnsafe(6); aad.writeUIntBE(Number(t), 0, 6); c.setAAD(aad);
    const enc = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);
    const tag = c.getAuthTag();
    const ivLen = Buffer.allocUnsafe(4); ivLen.writeUIntBE(iv.length, 0, 4);
    return Buffer.concat([ivLen, iv, enc, tag]).toString('base64');
}

// AES-128-ECB / PKCS7 (msg_encrypted_version 1.0).
function encryptECB(plaintext, password) {
    const key = Buffer.from(('' + password).substring(8, 24), 'utf8');
    const c = crypto.createCipheriv('aes-128-ecb', key, null);
    return Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]).toString('base64');
}

// A messaging instance that won't try to open a real connection.
function makeIdle(password = 'abcdefgh0123456789WXYZ!!') {
    const mq = new TuyaCloudMessaging({api: {}, log});
    mq._started = true; // prevent start()
    mq.config = {password};
    return mq;
}

function envelope(payloadObj, password, {protocol = 4, t = Date.now(), mode = 'gcm'} = {}) {
    const data = mode === 'ecb'
        ? encryptECB(JSON.stringify(payloadObj), password)
        : encryptGCM(JSON.stringify(payloadObj), password, t);
    return Buffer.from(JSON.stringify({protocol, data, t}));
}

describe('TuyaCloudMessaging — decryption + dispatch', () => {
    test('decrypts a GCM status frame and delivers it to the subscribed device', () => {
        const mq = makeIdle();
        const received = [];
        mq.subscribeDevice('DEV1', status => received.push(status));

        const t = Date.now();
        mq._onMessage('topic', envelope(
            {devId: 'DEV1', status: [{code: 'switch_1', value: true, t}, {code: 'battery_percentage', value: 80, t}]},
            mq.config.password, {t}
        ));

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual([{code: 'switch_1', value: true, t}, {code: 'battery_percentage', value: 80, t}]);
    });

    test('decrypts a legacy ECB (v1.0) frame too', () => {
        const mq = makeIdle();
        const received = [];
        mq.subscribeDevice('DEV1', status => received.push(status));
        mq._onMessage('topic', envelope({devId: 'DEV1', status: [{code: 'switch_2', value: true}]}, mq.config.password, {mode: 'ecb'}));
        expect(received[0]).toEqual([{code: 'switch_2', value: true}]);
    });

    test('ignores messages for devices we did not subscribe', () => {
        const mq = makeIdle();
        const received = [];
        mq.subscribeDevice('DEV1', status => received.push(status));
        mq._onMessage('topic', envelope({devId: 'OTHER', status: [{code: 'switch_1', value: true}]}, mq.config.password, {}));
        expect(received).toHaveLength(0);
    });

    test('a frame that cannot be decrypted is dropped without throwing', () => {
        const mq = makeIdle();
        const received = [];
        mq.subscribeDevice('DEV1', status => received.push(status));
        // Encrypted with the wrong password → auth/decrypt fails.
        expect(() => mq._onMessage('topic', envelope({devId: 'DEV1', status: [{code: 'x', value: 1}]}, 'ZZZZZZZZwrongkeywrongkey', {}))).not.toThrow();
        expect(received).toHaveLength(0);
    });

    test('malformed JSON envelope is ignored', () => {
        const mq = makeIdle();
        mq.subscribeDevice('DEV1', () => { throw new Error('should not be called'); });
        expect(() => mq._onMessage('topic', Buffer.from('not json'))).not.toThrow();
    });

    test('reports whether realtime is available (mqtt installed)', () => {
        // mqtt is an (optional) dependency of this project, so it should load.
        expect(typeof TuyaCloudMessaging.isAvailable()).toBe('boolean');
    });
});
