'use strict';

const crypto = require('crypto');
const TuyaCloudApi = require('../lib/TuyaCloudApi');

const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const hmacUpper = (str, key) => crypto.createHmac('sha256', key).update(str, 'utf8').digest('hex').toUpperCase();

const ACCESS_ID = 'aid123';
const ACCESS_KEY = 'secretKey456';

const makeApi = (extra = {}) => new TuyaCloudApi({accessId: ACCESS_ID, accessKey: ACCESS_KEY, ...extra});

describe('TuyaCloudApi — configuration', () => {
    test('resolves region to a known endpoint', () => {
        expect(makeApi({region: 'eu'}).endpoint).toBe('https://openapi.tuyaeu.com');
        expect(makeApi({region: 'us'}).endpoint).toBe('https://openapi.tuyaus.com');
        expect(makeApi({region: 'in'}).endpoint).toBe('https://openapi.tuyain.com');
    });

    test('unknown region falls back to US', () => {
        expect(makeApi({region: 'nowhere'}).endpoint).toBe('https://openapi.tuyaus.com');
    });

    test('explicit endpoint wins and trailing slashes are trimmed', () => {
        expect(makeApi({endpoint: 'https://example.com/'}).endpoint).toBe('https://example.com');
    });

    test('isConfigured reflects presence of credentials', () => {
        expect(makeApi().isConfigured()).toBe(true);
        expect(new TuyaCloudApi({}).isConfigured()).toBe(false);
    });

    test('keyFor is stable and distinguishes accounts', () => {
        const a = TuyaCloudApi.keyFor({accessId: 'x', region: 'eu'});
        const b = TuyaCloudApi.keyFor({accessId: 'x', region: 'eu'});
        const c = TuyaCloudApi.keyFor({accessId: 'x', region: 'eu', username: 'u'});
        expect(a).toBe(b);
        expect(a).not.toBe(c);
    });
});

describe('TuyaCloudApi — request signing', () => {
    test('business signature folds in the access token and sets the header', () => {
        const api = makeApi({region: 'eu'});
        api._token = 'TOK';
        const t = '1700000000000';
        const nonce = 'nonce-1';
        const h = api._signedHeaders({method: 'GET', urlPath: '/v1.0/devices/d/status', bodyStr: '', withToken: true, t, nonce});

        const stringToSign = ['GET', EMPTY_SHA, '', '/v1.0/devices/d/status'].join('\n');
        const expected = hmacUpper(ACCESS_ID + 'TOK' + t + nonce + stringToSign, ACCESS_KEY);

        expect(h.sign).toBe(expected);
        expect(h.access_token).toBe('TOK');
        expect(h.client_id).toBe(ACCESS_ID);
        expect(h.sign_method).toBe('HMAC-SHA256');
        expect(h.t).toBe(t);
        expect(h.nonce).toBe(nonce);
    });

    test('token signature omits the access token entirely', () => {
        const api = makeApi();
        api._token = 'SHOULD_NOT_APPEAR';
        const t = '1700000000000';
        const nonce = 'nonce-2';
        const h = api._signedHeaders({method: 'GET', urlPath: '/v1.0/token?grant_type=1', bodyStr: '', withToken: false, t, nonce});

        const stringToSign = ['GET', EMPTY_SHA, '', '/v1.0/token?grant_type=1'].join('\n');
        const expected = hmacUpper(ACCESS_ID + t + nonce + stringToSign, ACCESS_KEY);

        expect(h.sign).toBe(expected);
        expect(h.access_token).toBeUndefined();
    });

    test('a request body changes the Content-SHA256 portion of the signature', () => {
        const api = makeApi();
        api._token = 'TOK';
        const t = '1700000000000';
        const nonce = 'n';
        const body = JSON.stringify({commands: [{code: 'switch_1', value: true}]});
        const h = api._signedHeaders({method: 'POST', urlPath: '/p', bodyStr: body, withToken: true, t, nonce});

        const contentSha = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
        const stringToSign = ['POST', contentSha, '', '/p'].join('\n');
        const expected = hmacUpper(ACCESS_ID + 'TOK' + t + nonce + stringToSign, ACCESS_KEY);
        expect(h.sign).toBe(expected);
        expect(contentSha).not.toBe(EMPTY_SHA);
    });
});

describe('TuyaCloudApi — auth flow selection', () => {
    test('custom project uses grant_type=1', async () => {
        const api = makeApi();
        const calls = [];
        api._httpsRequest = async (method, path) => {
            calls.push({method, path});
            return {success: true, result: {access_token: 'T', uid: 'U', expire_time: 7200}};
        };
        const token = await api._ensureToken();
        expect(token).toBe('T');
        expect(api.uid).toBe('U');
        expect(calls[0].path).toBe('/v1.0/token?grant_type=1');
        expect(calls[0].method).toBe('GET');
    });

    test('smart-home project posts an MD5 password to authorized-login', async () => {
        const api = makeApi({username: 'joe@example.com', password: 'pw', countryCode: '48', schema: 'tuyaSmart'});
        let captured;
        api._httpsRequest = async (method, path, headers, bodyStr) => {
            captured = {method, path, bodyStr};
            return {success: true, result: {access_token: 'T2', uid: 'U2', expire_time: 7200}};
        };
        const token = await api._ensureToken();
        expect(token).toBe('T2');
        expect(api.uid).toBe('U2');
        expect(captured.path).toBe('/v1.0/iot-01/associated-users/actions/authorized-login');
        const body = JSON.parse(captured.bodyStr);
        expect(body.username).toBe('joe@example.com');
        expect(body.password).toBe(md5('pw'));
        expect(body.country_code).toBe('48');
        expect(body.schema).toBe('tuyaSmart');
    });
});

describe('TuyaCloudApi — endpoints', () => {
    const ready = () => {
        const api = makeApi();
        api._token = 'TOK';
        api._tokenExpiry = Date.now() + 1e6; // skip token fetch
        return api;
    };

    test('getStatus returns the result array', async () => {
        const api = ready();
        api._httpsRequest = async () => ({success: true, result: [{code: 'switch_1', value: true}]});
        await expect(api.getStatus('dev')).resolves.toEqual([{code: 'switch_1', value: true}]);
    });

    test('getShadowProperties returns the properties array (code + dp_id)', async () => {
        const api = ready();
        let path;
        api._httpsRequest = async (method, p) => {
            path = p;
            return {success: true, result: {properties: [{code: 'switch_led', dp_id: 20, value: true}]}};
        };
        await expect(api.getShadowProperties('dev')).resolves.toEqual([{code: 'switch_led', dp_id: 20, value: true}]);
        expect(path).toBe('/v2.0/cloud/thing/dev/shadow/properties');
    });

    test('getShadowProperties returns null (never throws) when the shadow API is unavailable', async () => {
        const api = ready();
        api._httpsRequest = async () => ({success: false, code: 1106, msg: 'permission deny'});
        await expect(api.getShadowProperties('dev')).resolves.toBeNull();
    });

    test('getDeviceInfo returns the device record (with online status)', async () => {
        const api = ready();
        let path;
        api._httpsRequest = async (method, p) => { path = p; return {success: true, result: {id: 'dev', online: false, name: 'X'}}; };
        await expect(api.getDeviceInfo('dev')).resolves.toEqual({id: 'dev', online: false, name: 'X'});
        expect(path).toBe('/v1.0/devices/dev');
    });

    test('sendCommands posts the commands and reports success', async () => {
        const api = ready();
        let captured;
        api._httpsRequest = async (method, path, headers, bodyStr) => {
            captured = {method, path, body: JSON.parse(bodyStr)};
            return {success: true, result: true};
        };
        const ok = await api.sendCommands('dev', [{code: 'switch_1', value: true}]);
        expect(ok).toBe(true);
        expect(captured.method).toBe('POST');
        expect(captured.path).toBe('/v1.0/devices/dev/commands');
        expect(captured.body).toEqual({commands: [{code: 'switch_1', value: true}]});
    });

    test('sendCommands short-circuits on an empty command list', async () => {
        const api = ready();
        api._httpsRequest = jest.fn();
        await expect(api.sendCommands('dev', [])).resolves.toBe(true);
        expect(api._httpsRequest).not.toHaveBeenCalled();
    });

    test('getMqttConfig posts the expected body and returns the broker config', async () => {
        const api = ready();
        api.uid = 'UID';
        let captured;
        api._httpsRequest = async (method, path, headers, bodyStr) => {
            captured = {path, body: JSON.parse(bodyStr)};
            return {success: true, result: {url: 'ssl://m1:8883', source_topic: {device: 't'}}};
        };
        const cfg = await api.getMqttConfig('link-1');
        expect(captured.path).toBe('/v1.0/iot-03/open-hub/access-config');
        expect(captured.body).toEqual({uid: 'UID', link_id: 'link-1', link_type: 'mqtt', topics: 'device', msg_encrypted_version: '2.0'});
        expect(cfg.url).toBe('ssl://m1:8883');
    });

    test('an invalid-token error refreshes the token and retries once', async () => {
        const api = ready();
        let business = 0;
        api._httpsRequest = async (method, path) => {
            // The retry re-fetches a token; serve that separately.
            if (path.startsWith('/v1.0/token')) return {success: true, result: {access_token: 'TOK2', expire_time: 7200}};
            business++;
            if (business === 1) return {success: false, code: 1010, msg: 'token invalid'};
            return {success: true, result: 'ok'};
        };
        const res = await api.request('GET', '/x');
        expect(business).toBe(2);
        expect(res.result).toBe('ok');
    });

    test('a non-token error rejects', async () => {
        const api = ready();
        api._httpsRequest = async () => ({success: false, code: 28841002, msg: 'no permissions'});
        await expect(api.request('GET', '/x')).rejects.toThrow(/no permissions/);
    });
});

describe('TuyaCloudApi — HTTP trace (debug.logCloudHttp)', () => {
    const makeLog = () => ({info: () => {}, warn: () => {}, error: () => {}, debug: jest.fn()});

    test('logHttp is off unless explicitly enabled', () => {
        expect(makeApi().logHttp).toBe(false);
        expect(makeApi({logHttp: true}).logHttp).toBe(true);
    });

    test('redaction masks credentials but keeps device data', () => {
        const api = makeApi();
        const redacted = api._redactForLog({
            client_id: 'aid1234567890', access_token: 'tok_abcdef123456', sign: 'SIGNATUREVALUE', t: '1700', nonce: 'n-1',
            result: {access_token: 'inner-token-xyz', refresh_token: 'refresh-xyz', uid: 'uid-1234567', online: true},
            commands: [{code: 'switch_1', value: true}]
        });

        expect(redacted.client_id).not.toBe('aid1234567890');
        expect(redacted.access_token).not.toBe('tok_abcdef123456');
        expect(redacted.sign).not.toBe('SIGNATUREVALUE');
        expect(redacted.result.access_token).not.toBe('inner-token-xyz');
        expect(redacted.result.refresh_token).not.toBe('refresh-xyz');
        expect(redacted.result.uid).not.toBe('uid-1234567');
        // Non-secret fields and the actual device data-points pass through intact.
        expect(redacted.t).toBe('1700');
        expect(redacted.nonce).toBe('n-1');
        expect(redacted.result.online).toBe(true);
        expect(redacted.commands).toEqual([{code: 'switch_1', value: true}]);
    });

    test('no trace is logged when the switch is off', () => {
        const log = makeLog();
        const api = makeApi({log});
        api._traceHttp('POST', '/v1.0/devices/dev/commands', {sign: 'X'}, '{"commands":[]}', 200, {success: true});
        expect(log.debug).not.toHaveBeenCalled();
    });

    test('a trace carries the request/response but never the raw token or signature', () => {
        const log = makeLog();
        const api = makeApi({log, logHttp: true});
        const headers = {client_id: 'aid', sign: 'SIGN_SECRET_VALUE', access_token: 'TOKEN_SECRET_VALUE', t: '1', nonce: 'n', 'Content-Type': 'application/json'};
        const body = JSON.stringify({commands: [{code: 'wfh_open', value: true}]});

        api._traceHttp('POST', '/v1.0/devices/dev/commands', headers, body, 200, {success: false, code: 2008, msg: 'command or value not support'});

        expect(log.debug).toHaveBeenCalledTimes(1);
        const line = log.debug.mock.calls[0][0];
        expect(line).toContain('POST /v1.0/devices/dev/commands');
        expect(line).toContain('wfh_open');           // the attempted command is visible
        expect(line).toContain('2008');                // and the cloud's verdict
        expect(line).toContain('command or value not support');
        expect(line).not.toContain('TOKEN_SECRET_VALUE'); // …but secrets are not
        expect(line).not.toContain('SIGN_SECRET_VALUE');
    });
});
