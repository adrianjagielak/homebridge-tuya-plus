'use strict';

const fs = require('node:fs/promises');
const {listLights, analyseCapture, createCaptureUpload} = require('../lib/LanGroupDiscovery');

(async () => {
    const {HomebridgePluginUiServer, RequestError} = await import('@homebridge/plugin-ui-utils');
    class UiServer extends HomebridgePluginUiServer {
        constructor() {
            super();
            const request = handler => async payload => {
                let config;
                try { config = JSON.parse(await fs.readFile(this.homebridgeConfigPath, 'utf8')); }
                catch (_) { throw new RequestError('Unable to read the saved Homebridge configuration.', {}); }
                try { return handler(config, payload); }
                catch (error) { throw new RequestError(error.message, {}); }
            };
            this.onRequest('/group-search/devices', request(listLights));
            this.onRequest('/group-search/analyse', request(analyseCapture));
            const upload = createCaptureUpload(request(analyseCapture));
            this.onRequest('/group-search/upload', async payload => {
                try { return await upload(payload); }
                catch (error) { throw new RequestError(error.message, {}); }
            });
            this.ready();
        }
    }
    new UiServer();
})().catch(() => {
    console.error('Unable to start the Tuya LAN group setup helper.');
    process.exitCode = 1;
});
