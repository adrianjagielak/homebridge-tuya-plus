'use strict';

const {listLights, analyseCapture, createCaptureUpload} = require('../lib/LanGroupDiscovery');
const {applyGroup} = require('../homebridge-ui/public/group-config');
const {KEY, ADDRESS, frame, packet, pcap} = require('./support/lan-group-capture');
const makeConfig = () => ({platforms: [
    {platform: 'Other', devices: [{id: 'unrelated', key: KEY}]},
    {platform: 'TuyaLan', _bridge: {username: 'EXAMPLE', port: 12345}, devices: [
        {id: 'plug', type: 'Outlet', key: KEY},
        {id: 'light', name: 'Example light', type: 'RGBTWLight', key: KEY, ip: ADDRESS, dpPower: 1},
        {id: 'light2', type: 'TWLight', key: KEY}
    ]}
]});
const payload = () => ({platformIndex: 1, deviceIndex: 1, deviceId: 'light', capture: pcap([packet(frame())]).toString('base64')});

describe('selected light discovery and review', () => {
    test('lists only saved lights and never sends keys', () => {
        const result = listLights(makeConfig());
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({id: 'light', platformIndex: 1, deviceIndex: 1});
        expect(JSON.stringify(result)).not.toContain(KEY);
    });
    test('analyses the saved selection without changing configuration', () => {
        const config = makeConfig();
        const before = JSON.stringify(config);
        const result = analyseCapture(config, payload());
        expect(result.deviceId).toBe('light');
        expect(result.groups[0]).toMatchObject({cid: '0058', mbid: 'c020'});
        expect(JSON.stringify(config)).toBe(before);
        expect(JSON.stringify(result)).not.toContain(KEY);
    });
    test.each([
        {deviceIndex: 0, deviceId: 'plug'}, {deviceId: 'changed'}, {platformIndex: -1},
        {platformIndex: 0, deviceIndex: 0, deviceId: 'unrelated'}, {deviceIndex: 99},
        {capture: '../config.json'}, {capture: '!!!!'}
    ])('rejects stale selections, non-lights and invalid input', override => {
        expect(() => analyseCapture(makeConfig(), {...payload(), ...override})).toThrow();
    });
    test('fills only the selected group, retaining bridges and all device options', () => {
        const blocks = [makeConfig().platforms[1]];
        const original = JSON.stringify(blocks);
        const updated = applyGroup(blocks, 'light', {cid: '005A', mbid: 'C020'}, ADDRESS);
        expect(JSON.stringify(blocks)).toBe(original);
        expect(updated[0]._bridge).toEqual(blocks[0]._bridge);
        expect(updated[0].devices[0]).toEqual(blocks[0].devices[0]);
        expect(updated[0].devices[2]).toEqual(blocks[0].devices[2]);
        expect(updated[0].devices[1]).toEqual({...blocks[0].devices[1], lanGroup: {cid: '005a', mbid: 'c020'}});
    });
    test('rejects a forced protocol that the group transport does not support', () => {
        const config = makeConfig();
        config.platforms[1].devices[1].forceVersion = '3.5';
        expect(() => analyseCapture(config, payload())).toThrow('protocol');
        expect(() => applyGroup([config.platforms[1]], 'light', {cid: '0058', mbid: 'c020'}, ADDRESS)).toThrow('protocol');
    });
    test('requires a fresh selection if the target changes or is duplicated', () => {
        const blocks = [makeConfig().platforms[1]];
        expect(() => applyGroup(blocks, 'missing', {cid: '0058', mbid: 'c020'}, ADDRESS)).toThrow();
        expect(() => applyGroup(blocks, 'light', {cid: '0058', mbid: 'c020'}, '192.0.2.51')).toThrow('changed');
        blocks[0].devices.push({...blocks[0].devices[1]});
        expect(() => applyGroup(blocks, 'light', {cid: '0058', mbid: 'c020'}, ADDRESS)).toThrow('changed');
    });
});

test('bounded capture uploads reassemble before analysis and reject stale or reordered parts', async () => {
    const capture = pcap([packet(frame())]);
    const analyse = jest.fn(payload => analyseCapture(makeConfig(), payload));
    const upload = createCaptureUpload(analyse);
    const selection = {platformIndex: 1, deviceIndex: 1, deviceId: 'light', size: capture.length};
    const first = await upload({...selection, offset: 0, part: capture.subarray(0, 60).toString('base64')});
    expect(first.done).toBe(false);
    expect(analyse).not.toHaveBeenCalled();
    const final = await upload({size: capture.length, offset: 60, uploadId: first.uploadId, part: capture.subarray(60).toString('base64')});
    expect(final.done).toBe(true);
    expect(final.result.groups[0]).toMatchObject({cid: '0058', mbid: 'c020'});
    await expect(upload({size: capture.length, offset: 60, uploadId: first.uploadId, part: capture.subarray(60).toString('base64')})).rejects.toThrow('expired');
    await expect(upload({...selection, offset: 0, part: 'A'.repeat(256 * 1024 + 4)})).rejects.toThrow('invalid');
});
