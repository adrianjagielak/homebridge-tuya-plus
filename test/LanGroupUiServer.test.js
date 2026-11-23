'use strict';

const {fork} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {KEY, ADDRESS, frame, packet, pcap} = require('./support/lan-group-capture');

test('custom UI server discovers a selected group over its real IPC API without saving or exposing keys', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tuya-group-ui-'));
    const configPath = path.join(directory, 'config.json');
    const contents = JSON.stringify({platforms: [{platform: 'TuyaLan', devices: [{id: 'example', name: 'Light', type: 'RGBTWLight', ip: ADDRESS, key: KEY}]}]});
    await fs.writeFile(configPath, contents, {mode: 0o600});
    const child = fork(path.join(__dirname, '../homebridge-ui/server.js'), [], {
        env: {...process.env, HOMEBRIDGE_CONFIG_PATH: configPath}, silent: true
    });
    let logs = '';
    child.stdout.on('data', data => { logs += data; });
    child.stderr.on('data', data => { logs += data; });
    const receive = predicate => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { child.off('message', handle); reject(new Error('UI server IPC timed out')); }, 3000);
        const handle = message => { if (predicate(message)) { clearTimeout(timeout); child.off('message', handle); resolve(message); } };
        child.on('message', handle);
    });
    const request = async (route, body, requestId) => {
        const response = receive(message => message.action === 'response' && message.payload.requestId === requestId);
        child.send({action: 'request', path: route, body, requestId});
        return (await response).payload;
    };
    try {
        await receive(message => message.action === 'ready');
        const devices = await request('/group-search/devices', {}, 'list');
        expect(devices.success).toBe(true);
        expect(devices.data[0].id).toBe('example');
        expect(JSON.stringify(devices)).not.toContain(KEY);
        const result = await request('/group-search/analyse', {
            platformIndex: 0, deviceIndex: 0, deviceId: 'example', capture: pcap([packet(frame())]).toString('base64')
        }, 'analyse');
        expect(result.success).toBe(true);
        expect(result.data.groups[0]).toMatchObject({cid: '0058', mbid: 'c020'});
        const capture = pcap([packet(frame())]);
        const begin = await request('/group-search/upload', {
            platformIndex: 0, deviceIndex: 0, deviceId: 'example', size: capture.length,
            offset: 0, part: capture.subarray(0, 60).toString('base64')
        }, 'begin');
        expect(begin.data.done).toBe(false);
        const complete = await request('/group-search/upload', {
            size: capture.length, offset: 60, uploadId: begin.data.uploadId,
            part: capture.subarray(60).toString('base64')
        }, 'complete');
        expect(complete.data.result.groups[0]).toMatchObject({cid: '0058', mbid: 'c020'});
        const failure = await request('/group-search/analyse', {deviceIndex: -1}, 'invalid');
        expect(failure.success).toBe(false);
        expect(JSON.stringify(result)).not.toContain(KEY);
        expect(logs).not.toContain(KEY);
        expect(await fs.readFile(configPath, 'utf8')).toBe(contents);
    } finally {
        child.kill();
        await fs.rm(directory, {recursive: true, force: true});
    }
});
