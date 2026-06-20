'use strict';

const EventEmitter = require('events');

/*
 * TuyaCloudDevice
 * ---------------
 * A drop-in replacement for TuyaAccessory (the LAN device class) that talks to
 * a device through the Tuya Cloud instead of the local network. It deliberately
 * exposes the exact same minimal contract every accessory relies on, so the
 * existing accessories (IrrigationSystemAccessory, …) work unchanged on top:
 *
 *   - `context`            device config (name, id, type, …)
 *   - `state`              current data-points  { <code>: value, … }
 *   - `connected`          boolean
 *   - `_connect()`         start talking to the device
 *   - `update(dps)`        write data-points
 *   - 'connect' / 'change' events  (change → (changes, state))
 *
 * The one meaningful difference from the LAN class is the data-point KEY. The
 * LAN protocol addresses data-points by numeric id (1, 2, …); the cloud speaks
 * string "codes" (e.g. `switch_1`, `battery_percentage`). So `state` here is
 * keyed by code, and accessories used over the cloud are configured with codes.
 * The device logs its codes on connect to make that configuration obvious.
 *
 * Updates are delivered by Tuya's realtime MQTT message service (see
 * TuyaCloudMessaging) — there is no periodic polling. Two REST calls are still
 * inherent to the cloud, because MQTT only carries *changes* and is
 * *receive-only*:
 *   - one `GET /status` to learn the initial state on connect (and again as a
 *     catch-up whenever the realtime stream (re)connects), and
 *   - `POST /commands` to actually control the device.
 */

class TuyaCloudDevice extends EventEmitter {
    constructor(props = {}) {
        super();
        this.log = props.log || console;
        this.api = props.cloudApi;
        this.messaging = props.messaging || null; // shared realtime stream

        // Keep a plain config object on `context`, mirroring TuyaAccessory, but
        // without the live helper objects we were handed.
        this.context = {...props};
        delete this.context.cloudApi;
        delete this.context.messaging;
        delete this.context.log;

        this.state = {};
        this.connected = false;
        this._stopped = false;
        this._retryTimer = null;

        if (props.connect !== false) this._connect();
    }

    /* ------------------------------------------------------------------ *
     *  Connect: read initial state, announce, then let realtime keep it fresh.
     * ------------------------------------------------------------------ */

    async _connect() {
        if (!this.api || !this.api.isConfigured()) {
            return this.log.error(`${this.context.name}: Tuya Cloud is not configured (missing accessId/accessKey).`);
        }

        try {
            const status = await this.api.getStatus(this.context.id);
            this.state = this._statusToState(status);
            this.connected = true;

            this._logDiscoveredCodes(status);

            this.emit('connect');
            // Accessories register their characteristics off the first 'change'.
            this.emit('change', {...this.state}, this.state);

            this._subscribeRealtime();
        } catch (ex) {
            this.log.error(`${this.context.name}: failed to connect to Tuya Cloud: ${ex.message}`);
            // Retry later — credentials/permissions/network may recover.
            if (!this._stopped) {
                this._retryTimer = setTimeout(() => this._connect(), 30000);
            }
        }
    }

    /* ------------------------------------------------------------------ *
     *  Realtime (shared MQTT stream)
     * ------------------------------------------------------------------ */

    _subscribeRealtime() {
        if (!this.messaging) {
            return this.log.warn(`${this.context.name}: realtime updates are unavailable (no MQTT). Control still works, but external changes (physical buttons, the device's own timers) won't be reflected until restart. Ensure the "mqtt" package is installed and realtime isn't disabled in the cloud config.`);
        }
        // Register the reconnect catch-up handler before starting, so the very
        // first 'online' is caught. On any (re)connect we re-read the full state
        // to recover anything missed while the stream was down.
        this.messaging.on('online', () => this._refreshState());
        this.messaging.subscribeDevice(this.context.id, status => this._applyStatus(status));
    }

    async _refreshState() {
        if (this._stopped) return;
        try {
            const status = await this.api.getStatus(this.context.id);
            this._applyStatus(status);
        } catch (ex) {
            this.log.debug(`${this.context.name}: cloud state refresh failed: ${ex.message}`);
        }
    }

    /* ------------------------------------------------------------------ *
     *  State helpers
     * ------------------------------------------------------------------ */

    // Convert a Tuya `[{code, value}]` status array into a flat { code: value }.
    _statusToState(status) {
        const state = {};
        (status || []).forEach(item => {
            if (item && typeof item.code === 'string') state[item.code] = item.value;
        });
        return state;
    }

    // Apply a fresh snapshot (initial / catch-up) or a realtime delta, diff it
    // against what we hold, and emit only what changed — exactly mirroring
    // TuyaAccessory._change so accessories behave identically.
    _applyStatus(status) {
        const incoming = this._statusToState(status);
        const changes = {};
        Object.keys(incoming).forEach(code => {
            if (incoming[code] !== this.state[code]) changes[code] = incoming[code];
        });
        if (Object.keys(changes).length) {
            this.state = {...this.state, ...incoming};
            this.emit('change', changes, this.state);
        }
        return changes;
    }

    _logDiscoveredCodes(status) {
        try {
            const list = (status || []).map(i => `${i.code}=${JSON.stringify(i.value)}`).join(', ');
            this.log.info(`${this.context.name}: Tuya Cloud data-point codes → ${list || '(none reported)'}`);
        } catch (_) { /* logging must never throw */ }
    }

    /* ------------------------------------------------------------------ *
     *  Writes
     * ------------------------------------------------------------------ */

    // Write data-points. `dps` is keyed by code → value (the accessory was
    // configured with codes). We deliberately do NOT optimistically mutate
    // `this.state`: the accessory already reflects the user's intent in HomeKit
    // immediately, and leaving `state` untouched lets the realtime stream
    // confirm the real device state without a spurious "revert" while a sleepy
    // device catches up. Returns truthy like TuyaAccessory.update().
    update(dps) {
        if (!dps || typeof dps !== 'object') return true;

        const commands = Object.keys(dps).map(code => ({code, value: dps[code]}));
        if (!commands.length) return true;

        if (!this.connected) {
            this.log.debug(`${this.context.name}: skipping cloud write, not connected`);
            return false;
        }

        this.api.sendCommands(this.context.id, commands)
            .then(ok => {
                if (!ok) this.log.warn(`${this.context.name}: Tuya Cloud rejected command ${JSON.stringify(commands)}`);
            })
            .catch(ex => this.log.error(`${this.context.name}: cloud command failed: ${ex.message}`));

        return true;
    }

    /* ------------------------------------------------------------------ *
     *  Teardown (tidy; Homebridge doesn't strictly require it)
     * ------------------------------------------------------------------ */

    stop() {
        this._stopped = true;
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    }
}

module.exports = TuyaCloudDevice;
