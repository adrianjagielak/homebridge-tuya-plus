'use strict';

const {execFile} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {defaultConfigPaths, findConfigPath, listLights, selectLight, findLanGroups, lanGroupSnippet} = require('../lib/LanGroupDiscovery');
const {KEY, ADDRESS, frame, packet, pcap} = require('./support/lan-group-capture');

const CLI = path.join(__dirname, '../bin/cli-group-find.js');
const makeConfig = () => ({platforms: [
    {platform: 'Other', devices: [{id: 'unrelated', name: 'Example light', type: 'RGBTWLight', key: KEY}]},
    {platform: 'TuyaLan', devices: [
        {id: 'plug', name: 'Plug', type: 'Outlet', key: KEY},
        {id: 'light', name: 'Example light', type: 'RGBTWLight', key: KEY, ip: ADDRESS, dpPower: 1},
        {id: 'light2', type: 'TWLight', key: KEY}
    ]}
]});

describe('saved light selection', () => {
    test('lists only TuyaLan lights and never includes keys', () => {
        const lights = listLights(makeConfig());
        expect(lights.map(light => light.id)).toEqual(['light', 'light2']);
        expect(JSON.stringify(lights)).not.toContain(KEY);
    });
    test('selects a light by id or case-insensitive name, ignoring other platforms', () => {
        expect(selectLight(makeConfig(), 'light').id).toBe('light');
        expect(selectLight(makeConfig(), 'example LIGHT').id).toBe('light');
    });
    test.each([
        ['missing', 'No TuyaLan device'],
        ['plug', 'not a light'],
        ['', '--device']
    ])('rejects %p', (selector, message) => {
        expect(() => selectLight(makeConfig(), selector)).toThrow(message);
    });
    test('asks for the id when several devices share a name', () => {
        const config = makeConfig();
        config.platforms[1].devices.push({id: 'light3', name: 'Example light', type: 'TWLight'});
        expect(() => selectLight(config, 'Example light')).toThrow('device id');
        expect(selectLight(config, 'light3').id).toBe('light3');
    });
    test('finds the first existing config path', () => {
        expect(defaultConfigPaths('/home/example')[0]).toBe(path.join('/home/example', '.homebridge', 'config.json'));
        expect(findConfigPath(['/nonexistent/config.json', __filename])).toBe(__filename);
        expect(findConfigPath(['/nonexistent/config.json'])).toBeUndefined();
    });
});

describe('group search', () => {
    test('returns the observed group and a config snippet without the key', () => {
        const result = findLanGroups(pcap([packet(frame())]), {key: KEY, ip: ADDRESS});
        expect(result.groups).toEqual([{cid: '0058', mbid: 'c020', address: ADDRESS, commands: 1}]);
        expect(lanGroupSnippet(result.groups[0])).toEqual({lanGroup: {cid: '0058', mbid: 'c020'}});
        expect(JSON.stringify(result)).not.toContain(KEY);
    });
    test('rejects a forced protocol the group transport does not support', () => {
        expect(() => findLanGroups(pcap([packet(frame())]), {key: KEY, forceVersion: '3.5'})).toThrow('3.3');
        expect(findLanGroups(pcap([packet(frame())]), {key: KEY, forceVersion: '3.3'}).groups).toHaveLength(1);
    });
});

describe('tuya-lan-group-find CLI', () => {
    let directory, capturePath, configPath;
    beforeAll(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tuya-group-cli-'));
        capturePath = path.join(directory, 'capture.pcap');
        configPath = path.join(directory, 'config.json');
        fs.writeFileSync(capturePath, pcap([packet(frame())]));
        fs.writeFileSync(configPath, JSON.stringify(makeConfig()));
    });
    afterAll(() => fs.rmSync(directory, {recursive: true, force: true}));
    const run = args => new Promise(resolve => {
        execFile(process.execPath, [CLI, ...args], (error, stdout, stderr) => resolve({code: error ? error.code : 0, stdout, stderr}));
    });

    test('reads the key and IP of a saved light and prints a lanGroup snippet', async () => {
        const {code, stdout} = await run(['--config', configPath, '--device', 'Example light', capturePath]);
        expect(code).toBe(0);
        expect(stdout).toContain('cid 0058, mbid c020');
        expect(stdout).toContain('"lanGroup"');
        expect(stdout).not.toContain(KEY);
    });
    test('accepts a key directly and prints JSON', async () => {
        const {code, stdout} = await run(['--key', KEY, '--ip', ADDRESS, '--json', capturePath]);
        expect(code).toBe(0);
        expect(JSON.parse(stdout).groups[0]).toMatchObject({cid: '0058', mbid: 'c020'});
    });
    test('lists saved lights when no device is chosen', async () => {
        const {code, stderr} = await run(['--config', configPath, capturePath]);
        expect(code).toBe(1);
        expect(stderr).toContain('light2');
        expect(stderr).not.toContain('plug');
        expect(stderr).not.toContain(KEY);
    });
    test('exits with 2 and a hint when no group is found', async () => {
        const {code, stdout} = await run(['--key', KEY, '--ip', '192.0.2.99', capturePath]);
        expect(code).toBe(2);
        expect(stdout).toContain('No traffic to the light');
    });
    test('reports unreadable captures as errors', async () => {
        const {code, stderr} = await run(['--key', KEY, path.join(directory, 'missing.pcap')]);
        expect(code).toBe(1);
        expect(stderr).toContain('Unable to read the capture');
    });
});
