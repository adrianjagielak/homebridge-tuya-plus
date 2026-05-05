'use strict';

// Regression guard for HomeKit accessory identity.
//
// HomeKit identifies accessories by UUID. Every UUID this plugin produces
// must be derived from the legacy seed 'homebridge-tuya' (the PLUGIN_NAME
// used in v3.4.0 and earlier) - NOT from the current npm package name
// 'homebridge-tuya-plus'. v3.5.0 broke this and reset every device in
// HomeKit; v3.5.1 restored it.
//
// These tests fail loudly if anyone "cleans up" the seed back to PLUGIN_NAME.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

// HAP-NodeJS's uuid.generate algorithm, reproduced here so the test does not
// require pulling in homebridge or hap-nodejs. Matches
// https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/util/uuid.ts
function hapGenerate(data) {
    const sha1 = crypto.createHash('sha1').update(data).digest('hex');
    let i = -1;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        i += 1;
        if (c === 'y') return ((parseInt(sha1[i], 16) & 0x3) | 0x8).toString(16);
        return sha1[i];
    });
}

describe('index.js UUID seed constants', () => {
    test("UUID_SEED is 'homebridge-tuya' (legacy v3.4.0 PLUGIN_NAME)", () => {
        expect(indexSource).toMatch(/const\s+UUID_SEED\s*=\s*'homebridge-tuya'\s*;/);
    });

    test("PLUGIN_NAME is 'homebridge-tuya-plus' (current npm package name)", () => {
        expect(indexSource).toMatch(/const\s+PLUGIN_NAME\s*=\s*'homebridge-tuya-plus'\s*;/);
    });

    test('every UUID.generate(...) call uses UUID_SEED, never PLUGIN_NAME', () => {
        const calls = indexSource.match(/UUID\.generate\([^)]*\)/g) || [];
        expect(calls.length).toBeGreaterThan(0);
        for (const call of calls) {
            expect(call).toMatch(/UUID_SEED/);
            expect(call).not.toMatch(/PLUGIN_NAME/);
        }
    });
});

describe('UUID stability against v3.4.0', () => {
    // Pinned outputs derived from `homebridge-tuya:<deviceId>` (the v3.4.0
    // seed). If any of these change, every existing user's HomeKit identity
    // resets on upgrade.
    const fixtures = [
        {
            seed: 'homebridge-tuya:bf1234567890abcdef1235',
            uuid: 'f7bd0a51-7bb8-4405-9ea6-d3da81023f2f',
        },
        {
            seed: 'homebridge-tuya:fake:device-001',
            uuid: '4922e84f-cbd0-415f-8ad4-43d7891ace87',
        },
    ];

    test.each(fixtures)('UUID for "$seed" is stable', ({ seed, uuid }) => {
        expect(hapGenerate(seed)).toBe(uuid);
    });

    test('legacy seed and v3.5.0 broken seed produce different UUIDs', () => {
        const id = 'bf1234567890abcdef1234';
        expect(hapGenerate('homebridge-tuya:' + id))
            .not.toBe(hapGenerate('homebridge-tuya-plus:' + id));
    });
});
