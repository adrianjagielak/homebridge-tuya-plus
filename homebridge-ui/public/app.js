/* global homebridge, TuyaLanGroupSetup, document */
'use strict';

(async () => {
    const element = id => document.getElementById(`group-search-${id}`);
    let devices = [];
    let result;
    let selected;
    let busy = false;
    const status = text => { element('status').textContent = text; };
    const reset = () => { result = undefined; element('results').hidden = true; };
    const refresh = async () => {
        if (busy) return;
        reset();
        devices = await homebridge.request('/group-search/devices');
        element('device').replaceChildren();
        for (const [index, device] of devices.entries()) {
            const option = document.createElement('option');
            option.value = String(index);
            option.textContent = `${device.name} (${device.ip || device.id})`;
            element('device').appendChild(option);
        }
        element('panel').hidden = !devices.length;
        status('Record a short capture while changing this light’s group in Tuya Smart, then select the file. Save new device settings before refreshing this list.');
    };
    homebridge.showSchemaForm();
    element('refresh').addEventListener('click', () => refresh().catch(() => status('Unable to refresh saved lights. Reopen settings and try again.')));
    element('device').addEventListener('change', reset);
    element('file').addEventListener('change', reset);
    element('run').addEventListener('click', async () => {
        if (busy) return;
        reset();
        selected = devices[Number(element('device').value)];
        const file = element('file').files[0];
        if (!selected || !file || !file.size || file.size > 16 * 1024 * 1024) return status('Select a saved light and a capture no larger than 16 MiB.');
        busy = true;
        for (const id of ['run', 'device', 'file', 'refresh']) element(id).disabled = true;
        status('Searching the capture for this light’s group commands…');
        try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            let uploadId, response;
            for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
                const part = bytes.subarray(offset, offset + 192 * 1024);
                const chunks = [];
                for (let i = 0; i < part.length; i += 32768) chunks.push(String.fromCharCode(...part.subarray(i, i + 32768)));
                response = await homebridge.request('/group-search/upload', {
                    platformIndex: selected.platformIndex, deviceIndex: selected.deviceIndex,
                    deviceId: selected.id, size: file.size, offset, uploadId, part: btoa(chunks.join(''))
                });
                uploadId = response.uploadId;
            }
            if (!response || !response.done) throw new Error('The capture upload did not complete. Search again.');
            result = response.result;
            element('group').replaceChildren();
            result.groups.forEach((group, index) => {
                const option = document.createElement('option');
                option.value = String(index);
                option.textContent = `CID ${group.cid}, MBID ${group.mbid} — ${group.address} (${group.commands} commands)`;
                element('group').appendChild(option);
            });
            element('results').hidden = !result.groups.length;
            status(result.groups.length
                ? `Found ${result.groups.length} group address combination(s). Review the addresses, then choose which group to use.`
                : 'No compatible group commands found. Check the saved local key, capture location and device IP; record a group change in Tuya Smart with phone Bluetooth disabled.');
        } catch (error) { status(error.message || 'Unable to analyse the capture.'); }
        finally {
            busy = false;
            for (const id of ['run', 'device', 'file', 'refresh']) element(id).disabled = false;
        }
    });
    element('apply').addEventListener('click', async () => {
        if (!result || !selected) return;
        try {
            const group = result.groups[Number(element('group').value)];
            const config = await homebridge.getPluginConfig();
            const updated = TuyaLanGroupSetup.applyGroup(config, result.deviceId, group, result.configuredIp);
            await homebridge.updatePluginConfig(updated);
            status('CID and MBID added to the form. Review the configuration below and click Save, then restart the Tuya Plus child bridge.');
            element('results').hidden = true;
        } catch (error) { status(error.message || 'Unable to update the configuration form.'); }
    });
    await refresh();
})().catch(() => {
    const status = document.getElementById('group-search-status');
    document.getElementById('group-search-panel').hidden = false;
    status.textContent = 'The group helper could not start. The normal configuration form remains available below.';
});
