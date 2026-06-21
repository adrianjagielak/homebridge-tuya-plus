'use strict';

/*
 * TuyaCloudApi
 * ------------
 * A tiny, dependency-free client for the Tuya Cloud OpenAPI.
 *
 * This plugin is, and remains, a LAN-first plugin: almost every Tuya device is
 * controlled locally over the network. A small class of devices, however,
 * simply cannot be reached that way — most notably battery-powered "sleepy"
 * devices (irrigation/faucet timers, door sensors, …). To save battery they
 * spend nearly all their time asleep and only ever talk to Tuya's cloud (over
 * MQTT) for a brief moment when they wake. They never keep the local TCP port
 * (6668) open and never answer LAN discovery, so the cloud is the ONLY way to
 * reach them. This client exists exclusively for those devices.
 *
 * Only the handful of endpoints the plugin needs are implemented:
 *   - GET  /v1.0/token?grant_type=1        (auth — also yields the account uid)
 *   - GET  /v1.0/devices/{id}/status       (read all data-points at once)
 *   - POST /v1.0/devices/{id}/commands     (write data-points)
 *   - POST /v1.0/iot-03/open-hub/access-config  (optional realtime MQTT config)
 *
 * Everything is signed with the Tuya "new" HMAC-SHA256 signature scheme, using
 * only Node's built-in `https` + `crypto`, so the plugin gains no new runtime
 * dependency for the core cloud path.
 *
 * Docs:
 *   Signature : https://developer.tuya.com/en/docs/iot/new-singnature
 *   Control   : https://developer.tuya.com/en/docs/cloud/device-control
 *   Regions   : https://developer.tuya.com/en/docs/iot/api-request
 */

const https = require('https');
const crypto = require('crypto');

// SHA-256 of an empty string — the Content-SHA256 used for GET / empty-body requests.
const EMPTY_BODY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

// Data-center base URLs. The region MUST match the one the Tuya / Smart Life
// app account is registered in (App → Me → Settings → Account → Region);
// cross-region calls are rejected by Tuya.
const REGION_ENDPOINTS = {
    cn: 'https://openapi.tuyacn.com',           // China
    us: 'https://openapi.tuyaus.com',           // Western America (default)
    'us-e': 'https://openapi-ueaz.tuyaus.com',  // Eastern America (Azure)
    eu: 'https://openapi.tuyaeu.com',           // Central Europe
    'eu-w': 'https://openapi-weaz.tuyaeu.com',  // Western Europe (Azure)
    in: 'https://openapi.tuyain.com',           // India
    sg: 'https://openapi-sg.iotbing.com'        // Singapore
};

// Tuya error codes that mean "the access token is no longer usable"; when we
// see one we drop the cached token and retry the call once.
const TOKEN_INVALID_CODES = new Set([1010, 1011, 1004]);

class TuyaCloudApi {
    constructor({accessId, accessKey, region, endpoint, username, password, countryCode, schema, log} = {}) {
        this.log = log || console;
        this.accessId = ('' + (accessId || '')).trim();
        this.accessKey = ('' + (accessKey || '')).trim();

        // Optional "Smart Home" project credentials. When a username/password
        // are supplied we authenticate as that app account (so the cloud sees
        // the devices linked to it); otherwise we use the simpler "Custom"
        // project token flow (grant_type=1).
        this.username = ('' + (username || '')).trim();
        this.password = ('' + (password || '')).trim();
        this.countryCode = ('' + (countryCode || '')).trim();
        this.schema = (('' + (schema || '')).trim()) || 'tuyaSmart';

        const r = ('' + (region || 'us')).trim().toLowerCase();
        this.region = r;
        this.endpoint = (('' + (endpoint || '')).trim()) || REGION_ENDPOINTS[r] || REGION_ENDPOINTS.us;
        // Strip a trailing slash so path concatenation is predictable.
        this.endpoint = this.endpoint.replace(/\/+$/, '');

        this._token = null;        // current access_token
        this.uid = null;           // linked app-account uid (needed for realtime MQTT)
        this._tokenExpiry = 0;     // ms epoch when the token must be refreshed
        this._tokenPromise = null; // in-flight token request (de-dupes concurrent callers)
    }

    isConfigured() {
        return !!(this.accessId && this.accessKey);
    }

    // A stable key identifying this credential+region pair, so several devices
    // that share the same cloud project can share one client (one token, one
    // realtime connection).
    static keyFor({accessId, region, endpoint, username} = {}) {
        const r = ('' + (region || 'us')).trim().toLowerCase();
        const e = (('' + (endpoint || '')).trim()) || REGION_ENDPOINTS[r] || REGION_ENDPOINTS.us;
        return `${('' + (accessId || '')).trim()}:${('' + (username || '')).trim()}@${e.replace(/\/+$/, '')}`;
    }

    /* ----------------------------- signing ----------------------------- */

    _hmac(str) {
        return crypto.createHmac('sha256', this.accessKey).update(str, 'utf8').digest('hex').toUpperCase();
    }

    // Build the signed headers for a request. When `withToken` is true the
    // current access_token is folded into the signature (business calls);
    // otherwise the token-request variant is used (the token call itself).
    // `t` and `nonce` are injectable for deterministic testing.
    _signedHeaders({method, urlPath, bodyStr, withToken, t, nonce} = {}) {
        t = t || Date.now().toString();
        nonce = nonce || crypto.randomUUID();

        const contentSha = bodyStr
            ? crypto.createHash('sha256').update(bodyStr, 'utf8').digest('hex')
            : EMPTY_BODY_SHA256;

        // stringToSign = METHOD \n Content-SHA256 \n Signature-Headers \n Url
        // Signature-Headers is intentionally empty (we fold none into the sign).
        const stringToSign = [method.toUpperCase(), contentSha, '', urlPath].join('\n');
        const str = (withToken
            ? this.accessId + this._token + t + nonce
            : this.accessId + t + nonce) + stringToSign;

        const headers = {
            'client_id': this.accessId,
            'sign': this._hmac(str),
            't': t,
            'sign_method': 'HMAC-SHA256',
            'nonce': nonce,
            'Content-Type': 'application/json'
        };
        if (withToken) headers['access_token'] = this._token;
        return headers;
    }

    /* ------------------------------ token ------------------------------ */

    async _ensureToken() {
        if (this._token && Date.now() < this._tokenExpiry) return this._token;
        if (this._tokenPromise) return this._tokenPromise;

        this._tokenPromise = (async () => {
            const res = this._useSmartHomeLogin()
                ? await this._loginSmartHome()
                : await this._loginCustom();
            if (!res || res.success !== true || !res.result || !res.result.access_token) {
                throw new Error(`token request failed: ${this._describeError(res)}`);
            }
            this._token = res.result.access_token;
            this.uid = res.result.uid || this.uid;
            // Refresh a minute early so a token never expires mid-request.
            const ttl = (parseInt(res.result.expire_time) || 7200) * 1000;
            this._tokenExpiry = Date.now() + Math.max(60000, ttl - 60000);
            return this._token;
        })();

        try {
            return await this._tokenPromise;
        } finally {
            this._tokenPromise = null;
        }
    }

    _useSmartHomeLogin() {
        return !!(this.username && this.password);
    }

    // "Custom" project: GET /v1.0/token?grant_type=1 (token-variant signature).
    _loginCustom() {
        const urlPath = '/v1.0/token?grant_type=1';
        const headers = this._signedHeaders({method: 'GET', urlPath, bodyStr: '', withToken: false});
        return this._httpsRequest('GET', urlPath, headers, null);
    }

    // "Smart Home" project: authenticate as the linked app account. The password
    // is sent as a lowercase hex MD5; the request is signed with the token
    // (no-access-token) variant since we don't hold a token yet.
    _loginSmartHome() {
        const urlPath = '/v1.0/iot-01/associated-users/actions/authorized-login';
        const body = {
            country_code: this.countryCode,
            username: this.username,
            password: crypto.createHash('md5').update('' + this.password).digest('hex'),
            schema: this.schema
        };
        const bodyStr = JSON.stringify(body);
        const headers = this._signedHeaders({method: 'POST', urlPath, bodyStr, withToken: false});
        return this._httpsRequest('POST', urlPath, headers, bodyStr);
    }

    _invalidateToken() {
        this._token = null;
        this._tokenExpiry = 0;
    }

    /* --------------------------- requests ------------------------------ */

    async request(method, urlPath, body, _retried) {
        await this._ensureToken();
        const bodyStr = body ? JSON.stringify(body) : '';
        const headers = this._signedHeaders({method, urlPath, bodyStr, withToken: true});
        const res = await this._httpsRequest(method, urlPath, headers, bodyStr || null);

        if (res && res.success === false) {
            if (!_retried && TOKEN_INVALID_CODES.has(res.code)) {
                this._invalidateToken();
                return this.request(method, urlPath, body, true);
            }
            throw new Error(`${method} ${urlPath} failed: ${this._describeError(res)}`);
        }
        return res;
    }

    // Read every reported data-point in one call → array of {code, value}.
    async getStatus(deviceId) {
        const res = await this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}/status`);
        return (res && Array.isArray(res.result)) ? res.result : [];
    }

    // Read the device record (name, product, and crucially `online`). Used to
    // learn whether the device is currently reachable. Returns the raw `result`
    // object or null. Requires the project to have the device-management API
    // authorized; callers treat a failure as "online unknown".
    async getDeviceInfo(deviceId) {
        const res = await this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}`);
        return (res && res.result && typeof res.result === 'object') ? res.result : null;
    }

    // Issue one or more commands: [{code, value}, …].
    async sendCommands(deviceId, commands) {
        if (!Array.isArray(commands) || !commands.length) return true;
        const res = await this.request('POST', `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, {commands});
        return !!(res && res.result);
    }

    // Fetch broker credentials for the realtime MQTT message service. Returns
    // the raw `result` object (url, client_id, username, password, source_topic,
    // expire_time, …) or throws. Requires the account uid (from the token call)
    // and that the project has the "Message Service" API authorized.
    async getMqttConfig(linkId) {
        await this._ensureToken();
        if (!this.uid) throw new Error('no account uid available for MQTT config');
        const body = {
            uid: this.uid,
            link_id: linkId,
            link_type: 'mqtt',
            topics: 'device',
            msg_encrypted_version: '2.0'
        };
        const res = await this.request('POST', '/v1.0/iot-03/open-hub/access-config', body);
        if (!res || res.success !== true || !res.result) {
            throw new Error(`MQTT config request failed: ${this._describeError(res)}`);
        }
        return res.result;
    }

    _describeError(res) {
        if (!res) return 'no/empty response';
        if (res.msg || res.code) return `${res.msg || ''} (code ${res.code})`.trim();
        return 'unexpected response';
    }

    /* ------------------------- transport ------------------------------- */

    _httpsRequest(method, urlPath, headers, bodyStr) {
        return new Promise((resolve, reject) => {
            let url;
            try {
                url = new URL(this.endpoint + urlPath);
            } catch (ex) {
                return reject(ex);
            }

            const req = https.request({
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                method,
                headers
            }, resp => {
                let data = '';
                resp.setEncoding('utf8');
                resp.on('data', chunk => { data += chunk; });
                resp.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (ex) {
                        reject(new Error(`Tuya Cloud returned non-JSON (HTTP ${resp.statusCode}): ${('' + data).slice(0, 200)}`));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(20000, () => req.destroy(new Error('request timed out')));
            if (bodyStr) req.write(bodyStr);
            req.end();
        });
    }
}

TuyaCloudApi.REGION_ENDPOINTS = REGION_ENDPOINTS;
module.exports = TuyaCloudApi;
