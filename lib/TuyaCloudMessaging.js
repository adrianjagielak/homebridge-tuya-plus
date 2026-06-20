'use strict';

const EventEmitter = require('events');
const crypto = require('crypto');

/*
 * TuyaCloudMessaging
 * ------------------
 * Optional realtime updates for cloud-backed devices, over Tuya's MQTT message
 * service. ONE instance is shared by every cloud device on the same Tuya
 * project (one broker connection delivers status for all of them); messages are
 * fanned out to the right device by its `devId`.
 *
 * This is intentionally a best-effort accelerator layered on top of polling:
 * if the optional `mqtt` package is missing, or the broker can't be reached, or
 * a message can't be decrypted, nothing breaks — the devices simply keep
 * polling. When it IS working, changes (including physical button presses and
 * the rain sensor) show up in HomeKit within a second or two.
 *
 * The connection + AES-GCM message decryption are faithful to the
 * actively-maintained `0x5e/homebridge-tuya-platform` (`src/core/TuyaOpenMQ.ts`),
 * re-implemented here with Node's built-in `crypto`.
 */

const GCM_TAG_LENGTH = 16;
const PROTOCOL_DEVICE_STATUS = 4;

// `mqtt` is an OPTIONAL dependency: realtime is a bonus, polling is the
// guarantee. Loading it lazily keeps the plugin LAN-first and lets it run in
// environments where mqtt isn't (or can't be) installed.
let mqtt = null;
let mqttLoadError = null;
try {
    mqtt = require('mqtt');
} catch (ex) {
    mqttLoadError = ex;
}

class TuyaCloudMessaging extends EventEmitter {
    constructor({api, log} = {}) {
        super();
        this.api = api;
        this.log = log || console;

        this.linkId = crypto.randomUUID(); // bare v4 UUID, reused across reconnects
        this.client = null;
        this.config = null;
        this.connected = false;

        this._handlers = new Map(); // devId -> [fn(status)]
        this._renewTimer = null;
        this._started = false;
        this._stopped = false;

        // EventEmitter with many devices listening to 'online'/'offline'.
        this.setMaxListeners(0);
    }

    static isAvailable() {
        return !!mqtt;
    }

    // Register a device's status handler and lazily start the shared connection.
    subscribeDevice(devId, handler) {
        const id = '' + devId;
        if (!this._handlers.has(id)) this._handlers.set(id, []);
        this._handlers.get(id).push(handler);
        if (!this._started) this.start();
    }

    start() {
        if (this._stopped || this._started) return;
        this._started = true;

        if (!mqtt) {
            this.log.warn(`Tuya Cloud realtime disabled: the optional "mqtt" package is not installed${mqttLoadError ? ` (${mqttLoadError.message})` : ''}. Devices will poll instead. Install it with "npm install mqtt" in the plugin folder to enable instant updates.`);
            return;
        }

        this._connect().catch(ex => {
            this.log.warn(`Tuya Cloud realtime could not start (${ex.message}); devices will poll instead.`);
            this._scheduleRenew(60);
        });
    }

    async _connect() {
        if (this._stopped) return;
        this._teardownClient();

        const cfg = await this.api.getMqttConfig(this.linkId);
        this.config = cfg;

        if (!cfg.url || !cfg.source_topic || !cfg.source_topic.device) {
            throw new Error('incomplete MQTT config from Tuya');
        }

        const client = mqtt.connect(cfg.url, {
            clientId: cfg.client_id,
            username: cfg.username,
            password: cfg.password
        });

        client.on('connect', () => {
            this.connected = true;
            client.subscribe(cfg.source_topic.device, err => {
                if (err) this.log.debug(`Tuya Cloud realtime subscribe error: ${err.message}`);
            });
            this.log.info('Tuya Cloud realtime connected (MQTT).');
            this.emit('online');
        });
        client.on('message', (topic, payload) => this._onMessage(topic, payload));
        client.on('error', err => this.log.debug(`Tuya Cloud realtime error: ${err && err.message}`));
        client.on('close', () => this._markOffline());
        client.on('end', () => this._markOffline());

        this.client = client;

        // Broker credentials expire; renew them a minute early (mqtt.js handles
        // transient drops on its own via auto-reconnect).
        const ttl = parseInt(cfg.expire_time) || 7200;
        this._scheduleRenew(Math.max(60, ttl - 60));
    }

    _markOffline() {
        if (this.connected) {
            this.connected = false;
            this.emit('offline');
        }
    }

    _scheduleRenew(seconds) {
        if (this._renewTimer) clearTimeout(this._renewTimer);
        if (this._stopped) return;
        this._renewTimer = setTimeout(() => {
            this._connect().catch(ex => {
                this.log.debug(`Tuya Cloud realtime renew failed: ${ex.message}`);
                this._scheduleRenew(60);
            });
        }, seconds * 1000);
    }

    _onMessage(topic, payload) {
        let envelope;
        try {
            envelope = JSON.parse(payload.toString());
        } catch (_) { return; }

        const {protocol, data, t} = envelope;
        if (!data) return;

        let plaintext;
        try {
            plaintext = this._decrypt(data, this.config && this.config.password, t);
        } catch (ex) {
            this.log.debug(`Tuya Cloud realtime decrypt failed: ${ex.message}`);
            return;
        }

        let msg;
        try {
            msg = JSON.parse(plaintext);
        } catch (_) { return; }

        // We only care about device status frames (protocol 4). Some firmwares
        // omit `protocol`; in that case fall back to "has a status array".
        if (protocol != null && protocol !== PROTOCOL_DEVICE_STATUS && !(msg && Array.isArray(msg.status))) return;

        const devId = msg && (msg.devId || msg.devid || msg.dev_id);
        const status = msg && msg.status;
        if (!devId || !Array.isArray(status)) return;

        const handlers = this._handlers.get('' + devId);
        if (!handlers || !handlers.length) return;
        handlers.forEach(fn => {
            try { fn(status); } catch (ex) { this.log.debug(`Tuya Cloud realtime handler error: ${ex.message}`); }
        });
    }

    // Decrypt the MQTT `data` field. msg_encrypted_version 2.0 → AES-128-GCM,
    // 1.0 → AES-128-ECB. The AES key is the middle 16 chars of the broker
    // password (NOT the project Access Secret).
    _decrypt(data, password, t) {
        const key = Buffer.from(('' + (password || '')).substring(8, 24), 'utf8');
        const buf = Buffer.from(data, 'base64');

        // GCM (v2.0) layout: [ivLen(4) BE][iv(ivLen)][ciphertext][tag(16)].
        // Try it first; if the header doesn't look like a sane IV length, or
        // auth fails, fall back to ECB (v1.0).
        if (buf.length > 4 + GCM_TAG_LENGTH) {
            const ivLen = buf.readUIntBE(0, 4);
            if (ivLen >= 12 && ivLen <= 16 && (4 + ivLen + GCM_TAG_LENGTH) <= buf.length) {
                try {
                    const iv = buf.slice(4, 4 + ivLen);
                    const ciphertext = buf.slice(4 + ivLen, buf.length - GCM_TAG_LENGTH);
                    const tag = buf.slice(buf.length - GCM_TAG_LENGTH);
                    const decipher = crypto.createDecipheriv('aes-128-gcm', key, iv);
                    decipher.setAuthTag(tag);
                    const aad = Buffer.allocUnsafe(6);
                    aad.writeUIntBE(Number(t) || 0, 0, 6);
                    decipher.setAAD(aad);
                    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
                } catch (gcmEx) {
                    // fall through to ECB
                }
            }
        }

        const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
        return Buffer.concat([decipher.update(buf), decipher.final()]).toString('utf8');
    }

    _teardownClient() {
        if (this.client) {
            try {
                this.client.removeAllListeners();
                this.client.end(true);
            } catch (_) { /* ignore */ }
            this.client = null;
        }
        this.connected = false;
    }

    stop() {
        this._stopped = true;
        if (this._renewTimer) { clearTimeout(this._renewTimer); this._renewTimer = null; }
        this._teardownClient();
    }
}

// Expose for unit tests / encryption round-trips.
TuyaCloudMessaging.GCM_TAG_LENGTH = GCM_TAG_LENGTH;
module.exports = TuyaCloudMessaging;
