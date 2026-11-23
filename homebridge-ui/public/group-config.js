/* global window */
(function(root) {
    'use strict';
    function applyGroup(blocks, deviceId, group, configuredIp) {
        if (!group || typeof group.cid !== 'string' || typeof group.mbid !== 'string' || !/^[0-9a-f]{4}$/i.test(group.cid) || !/^[0-9a-f]{4}$/i.test(group.mbid)) throw new Error('Select a discovered group.');
        const updated = JSON.parse(JSON.stringify(blocks));
        const matches = [];
        updated.forEach(block => {
            if (block.platform !== 'TuyaLan' || !Array.isArray(block.devices)) return;
            block.devices.forEach(device => { if (device.id === deviceId) matches.push(device); });
        });
        if (matches.length !== 1 || (matches[0].ip || '') !== configuredIp) throw new Error('The device configuration changed. Save it and search again.');
        const device = matches[0];
        const types = ['simplelight', 'twlight', 'rgbtwlight', 'custommultilight', 'simpledimmer', 'simpledimmer2', 'wleddimmer'];
        if (!types.includes(String(device.type).toLowerCase())) throw new Error('The selected device is no longer a light.');
        if (device.forceVersion && parseFloat(device.forceVersion) !== 3.3) throw new Error('Check the light’s forced protocol version before applying a Tuya 3.3 group.');
        device.lanGroup = {...device.lanGroup, cid: group.cid.toLowerCase(), mbid: group.mbid.toLowerCase()};
        return updated;
    }
    if (typeof module === 'object' && module.exports) module.exports = {applyGroup};
    else root.TuyaLanGroupSetup = {applyGroup};
})(typeof window === 'object' ? window : globalThis);
