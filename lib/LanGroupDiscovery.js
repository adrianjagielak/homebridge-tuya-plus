'use strict';

const {searchLanGroups, MAX_CAPTURE_BYTES} = require('./LanGroupCapture');
const {randomUUID} = require('node:crypto');
const LIGHT_TYPES = new Set(['simplelight', 'twlight', 'rgbtwlight', 'custommultilight', 'simpledimmer', 'simpledimmer2', 'wleddimmer']);
const isLight = device => device && typeof device.type === 'string' && LIGHT_TYPES.has(device.type.toLowerCase());

function listLights(config) {
    const lights = [];
    (config.platforms || []).forEach((platform, platformIndex) => {
        if (platform.platform !== 'TuyaLan' || !Array.isArray(platform.devices)) return;
        platform.devices.forEach((device, deviceIndex) => {
            if (isLight(device) && device.id) lights.push({
                platformIndex, deviceIndex, id: device.id,
                name: device.name || device.id, ip: device.ip || ''
            });
        });
    });
    return lights;
}

function analyseCapture(config, payload) {
    if (!payload || !Number.isInteger(payload.platformIndex) || payload.platformIndex < 0 ||
        !Number.isInteger(payload.deviceIndex) || payload.deviceIndex < 0) throw new Error('Select a saved light first.');
    const platform = (config.platforms || [])[payload.platformIndex];
    const device = platform && Array.isArray(platform.devices) && platform.devices[payload.deviceIndex];
    if (!platform || platform.platform !== 'TuyaLan' || !isLight(device) || !device.id || device.id !== payload.deviceId) {
        throw new Error('The selected light changed. Refresh the saved light list and try again.');
    }
    if (device.forceVersion && parseFloat(device.forceVersion) !== 3.3) throw new Error('This finder supports Tuya 3.3 groups. Check the selected light’s forced protocol version.');
    if (typeof payload.capture !== 'string' || !payload.capture.length || payload.capture.length > Math.ceil(MAX_CAPTURE_BYTES / 3) * 4 ||
        payload.capture.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.capture)) {
        throw new Error('Choose a valid packet capture no larger than 16 MiB.');
    }
    const capture = Buffer.from(payload.capture, 'base64');
    if (capture.toString('base64') !== payload.capture) throw new Error('Invalid packet capture encoding.');
    const result = searchLanGroups(capture, {key: device.key, ip: device.ip || undefined, port: device.port || 6668});
    return {deviceId: device.id, configuredIp: device.ip || '', ...result};
}

function createCaptureUpload(analyse) {
    let upload;
    return async payload => {
        const fail = () => { upload = undefined; throw new Error('The capture upload is invalid or expired. Select the file and search again.'); };
        if (!payload || !Number.isInteger(payload.size) || payload.size < 12 || payload.size > MAX_CAPTURE_BYTES ||
            !Number.isInteger(payload.offset) || payload.offset < 0 || typeof payload.part !== 'string' ||
            !payload.part.length || payload.part.length > 256 * 1024 || payload.part.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.part)) return fail();
        const part = Buffer.from(payload.part, 'base64');
        if (part.toString('base64') !== payload.part || payload.offset + part.length > payload.size) return fail();
        if (payload.offset === 0) {
            upload = {id: randomUUID(), size: payload.size, received: 0, parts: [], created: Date.now(),
                selection: {platformIndex: payload.platformIndex, deviceIndex: payload.deviceIndex, deviceId: payload.deviceId}};
        } else if (!upload || upload.id !== payload.uploadId || upload.received !== payload.offset || upload.size !== payload.size || Date.now() - upload.created > 300000) return fail();
        upload.parts.push(part);
        upload.received += part.length;
        if (upload.received === upload.size) {
            const complete = upload;
            upload = undefined;
            const result = await analyse({...complete.selection, capture: Buffer.concat(complete.parts).toString('base64')});
            return {done: true, result};
        }
        return {done: false, uploadId: upload.id, offset: upload.received};
    };
}

module.exports = {listLights, analyseCapture, createCaptureUpload};
