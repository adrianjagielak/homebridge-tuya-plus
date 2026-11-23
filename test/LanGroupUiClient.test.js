'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {listLights, analyseCapture, createCaptureUpload} = require('../lib/LanGroupDiscovery');
const {KEY, ADDRESS, frame, packet, pcap} = require('./support/lan-group-capture');

async function setup(withLight = true) {
    const directory = path.join(__dirname, '../homebridge-ui/public');
    const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
    const nodes = {};
    const element = () => ({
        value: '', files: [], children: [], hidden: false, disabled: false, listeners: {}, textContent: '',
        addEventListener(name, handler) { this.listeners[name] = handler; },
        replaceChildren() { this.children = []; this.value = ''; },
        appendChild(child) { this.children.push(child); if (this.children.length === 1) this.value = child.value; }
    });
    for (const match of html.matchAll(/id="([^"]+)"/g)) nodes[match[1]] = element();
    const saved = {platforms: [{platform: 'TuyaLan', _bridge: {username: 'EXAMPLE'}, devices: [
        ...(withLight ? [{id: 'light', name: 'Example <img>', type: 'RGBTWLight', key: KEY, ip: ADDRESS}] : []),
        {id: 'plug', type: 'Outlet'}
    ]}]};
    let blocks = JSON.parse(JSON.stringify(saved.platforms));
    const uploadCapture = createCaptureUpload(payload => analyseCapture(saved, payload));
    const homebridge = {
        showSchemaForm: jest.fn(), savePluginConfig: jest.fn(),
        getPluginConfig: jest.fn(async () => JSON.parse(JSON.stringify(blocks))),
        updatePluginConfig: jest.fn(async updated => { blocks = updated; }),
        request: jest.fn(async (route, payload) => route === '/group-search/devices' ? listLights(saved) : uploadCapture(payload))
    };
    const context = {homebridge, document: {getElementById: id => nodes[id], createElement: () => element()}, Uint8Array, btoa};
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(directory, 'group-config.js'), 'utf8'), context);
    await vm.runInContext(fs.readFileSync(path.join(directory, 'app.js'), 'utf8'), context);
    const get = name => nodes[`group-search-${name}`];
    const upload = data => { get('file').files = [{size: data.length, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length)}]; };
    return {homebridge, get, upload, blocks: () => blocks};
}

test('actual setup client keeps the normal form and applies only an explicitly selected discovery result', async () => {
    const ui = await setup();
    expect(ui.homebridge.showSchemaForm).toHaveBeenCalledTimes(1);
    expect(ui.get('device').children).toHaveLength(1);
    expect(ui.get('device').children[0].textContent).toContain('Example <img>');
    ui.upload(pcap([packet(frame())]));
    await ui.get('run').listeners.click();
    expect(ui.get('status').textContent).toContain('Found 1');
    expect(ui.homebridge.updatePluginConfig).not.toHaveBeenCalled();
    expect(ui.get('results').hidden).toBe(false);
    await ui.get('apply').listeners.click();
    expect(ui.blocks()[0].devices[0].lanGroup).toEqual({cid: '0058', mbid: 'c020'});
    expect(ui.blocks()[0].devices[1]).toEqual({id: 'plug', type: 'Outlet'});
    expect(ui.blocks()[0]._bridge).toEqual({username: 'EXAMPLE'});
    expect(ui.homebridge.savePluginConfig).not.toHaveBeenCalled();
});

test('actual setup client offers no result when a capture belongs to another light', async () => {
    const ui = await setup();
    ui.upload(pcap([packet(frame(), {address: '192.0.2.51'})]));
    await ui.get('run').listeners.click();
    expect(ui.get('status').textContent).toContain('No compatible');
    expect(ui.get('results').hidden).toBe(true);
    expect(ui.homebridge.updatePluginConfig).not.toHaveBeenCalled();
});

test('actual setup client keeps the helper hidden for a configuration with no saved lights', async () => {
    const ui = await setup(false);
    expect(ui.get('panel').hidden).toBe(true);
    expect(ui.homebridge.showSchemaForm).toHaveBeenCalledTimes(1);
});

test('actual setup client rejects an oversized upload before submitting it', async () => {
    const ui = await setup();
    ui.get('file').files = [{size: 17 * 1024 * 1024}];
    await ui.get('run').listeners.click();
    expect(ui.get('status').textContent).toContain('16 MiB');
    expect(ui.homebridge.request).toHaveBeenCalledTimes(1);
});
