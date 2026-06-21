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
