'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {searchLanGroups} = require('./LanGroupCapture');

const LIGHT_TYPES = new Set(['simplelight', 'twlight', 'rgbtwlight', 'custommultilight', 'simpledimmer', 'simpledimmer2', 'wleddimmer']);
const isLight = device => !!device && typeof device.type === 'string' && LIGHT_TYPES.has(device.type.toLowerCase());

// The usual config.json locations for a plain install, hb-service and the Docker image.
function defaultConfigPaths(home = os.homedir()) {
    return [
        path.join(home, '.homebridge', 'config.json'),
        '/var/lib/homebridge/config.json',
        '/homebridge/config.json'
    ];
}

function findConfigPath(candidates = defaultConfigPaths()) {
    return candidates.find(candidate => fs.existsSync(candidate));
}

function listLights(config) {
    const lights = [];
    for (const platform of (config && config.platforms) || []) {
        if (!platform || platform.platform !== 'TuyaLan' || !Array.isArray(platform.devices)) continue;
        for (const device of platform.devices) {
            if (isLight(device) && device.id) lights.push({id: device.id, name: device.name || device.id, type: device.type, ip: device.ip || ''});
        }
    }
    return lights;
}

// Returns the full saved device entry (including its local key) so the caller
// can decrypt the capture; never print the returned object as a whole.
function selectLight(config, selector) {
    if (typeof selector !== 'string' || !selector.trim()) throw new Error('Name the saved light with --device <id or name>.');
    const wanted = selector.trim().toLowerCase();
    const devices = [];
    for (const platform of (config && config.platforms) || []) {
        if (platform && platform.platform === 'TuyaLan' && Array.isArray(platform.devices)) devices.push(...platform.devices.filter(Boolean));
    }
    const byId = devices.filter(device => typeof device.id === 'string' && device.id.toLowerCase() === wanted);
    const matches = byId.length ? byId : devices.filter(device => typeof device.name === 'string' && device.name.toLowerCase() === wanted);
    if (!matches.length) throw new Error(`No TuyaLan device with the id or name "${selector}" was found in the config.`);
    if (matches.length > 1) throw new Error(`Several TuyaLan devices match "${selector}". Use the device id instead.`);
    if (!isLight(matches[0])) throw new Error(`"${selector}" is a ${matches[0].type || 'device without a type'}, not a light. Tuya LAN groups are only supported on light accessories.`);
    return matches[0];
}

function findLanGroups(capture, {key, ip, port, forceVersion}) {
    if (forceVersion && parseFloat(forceVersion) !== 3.3) {
        throw new Error('This finder supports Tuya 3.3 groups only. Check the light\'s forced protocol version.');
    }
    return searchLanGroups(capture, {key, ip: ip || undefined, port: port || 6668});
}

const lanGroupSnippet = group => ({lanGroup: {cid: group.cid, mbid: group.mbid}});

module.exports = {defaultConfigPaths, findConfigPath, listLights, selectLight, findLanGroups, lanGroupSnippet, isLight};
