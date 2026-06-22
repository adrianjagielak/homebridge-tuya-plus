'use strict';

const EventEmitter = require('events');
const TuyaAccessory = require('./TuyaAccessory');
const TuyaCloudDevice = require('./TuyaCloudDevice');

/*
 * TuyaDevice
 * ----------
 * The single `device` object every accessory now talks to. It presents the exact
 * same minimal contract the accessories already rely on —
 *
 *   - `context`            device config (name, id, type, …)
 *   - `state`              current data-points
 *   - `connected`          boolean
 *   - `_connect()`         start talking to the device
 *   - `update(dps)`        write data-points
 *   - 'connect' / 'change' events  (change → (changes, state))
 *
 * — but underneath it transparently spans BOTH transports:
 *
 *   - a LAN backend  (TuyaAccessory)   — the fast, private, local path
 *   - a cloud backend (TuyaCloudDevice)— Tuya's internet path, used as a fallback
 *
 * Behaviour mirrors the official Tuya app: control goes over the LAN whenever the
 * device is reachable there; if the LAN is down (or the device never appears on it
 * — e.g. battery-powered "sleepy" units) it falls back to the cloud. Only when
 * BOTH are unreachable does the device report disconnected, so the accessory shows
 * "No Response". Accessories don't know or care which path is live.
 *
 * The one thing that differs between the transports is how a data-point is
 * addressed: the LAN speaks numeric ids (1, 2, …), the cloud speaks string codes
 * (switch_led, …). The cloud backend learns the id<->code map from the device's
 * thing-shadow and keeps `state` keyed BOTH ways, so a configuration written for
 * either transport resolves over the other. Writes are translated to whatever the
 * live backend needs. The net effect: existing LAN configs gain a cloud fallback,
 * and existing cloud configs gain LAN, with no config change.
 */

// When a LAN-primary device's cloud backend connects first but can't offer the
// numeric data-point map (the device-shadow API isn't available), give the LAN a
// short head start before letting the cloud drive the one-time characteristic
// registration — so a numeric-DP config still registers against numeric keys.
const LAN_REGISTRATION_GRACE_MS = 15000;

class TuyaDevice extends EventEmitter {
    constructor(props = {}) {
        super();
        // Several accessories attach their own 'change' listener on top of the one
        // BaseAccessory uses; keep the default-listener guard from ever warning.
        this.setMaxListeners(0);

        this.log = props.log || console;

        // A plain config object on `context`, mirroring the transport classes but
        // without the live helper objects we were handed.
        this.context = {...props};
        delete this.context.log;
        delete this.context.cloudApi;
        delete this.context.messaging;

        this.state = {};
        this._stopped = false;
        this._registered = false;       // has the first 'change' (registration) gone out?
        this._connectEmitted = false;
        this._lanGraceElapsed = false;

        // LAN backend — created later, once an IP is known (see attachLan). A
        // device with no local key can't speak the LAN protocol at all, so it is
        // cloud-only and this stays null.
        this.lan = null;

        // Cloud backend — present whenever the platform handed us a shared cloud
        // session and this device isn't opted out of it.
        this.cloud = null;
        if (props.cloudApi) {
            this.cloud = new TuyaCloudDevice({
                ...props,
                cloudApi: props.cloudApi,
                messaging: props.messaging,
                log: this.log,
                // Let the cloud backend tell a harmless fallback failure (the device
                // is reachable over the LAN) apart from one that matters (it isn't).
                isLanConnected: () => !!(this.lan && this.lan.connected),
                connect: false
            });
        }

        if (props.connect !== false) this._connect();
    }

    // Reachable over either transport.
    get connected() {
        return !!((this.lan && this.lan.connected) || (this.cloud && this.cloud.connected));
    }

    /* ------------------------------------------------------------------ *
     *  Lifecycle
     * ------------------------------------------------------------------ */

    _connect() {
        if (this.cloud) {
            this._wire(this.cloud, 'cloud');
            this.cloud._connect();

            // Safety net for the LAN-without-map registration guard above.
            if (this.context.key) {
                setTimeout(() => {
                    this._lanGraceElapsed = true;
                    if (!this._registered) this._onBackendChange();
                }, LAN_REGISTRATION_GRACE_MS).unref?.();
            }
        }
        // The LAN backend is attached by the platform via attachLan() once the
        // device's IP is known (from discovery, or a configured `ip`), preserving
        // the existing discovery timing.
    }

    // Bring up (or update) the LAN transport for a device whose IP is now known.
    // `target` carries the {ip, version} learned from discovery; a configured
    // version/forceVersion still take precedence as they always have.
    attachLan(target = {}) {
        if (this._stopped || this.lan) return;
        if (!this.context.key) {
            this.log.debug(`${this.context.name}: no local key; staying on the cloud only.`);
            return;
        }
        if (!target.ip && !this.context.ip) return;

        let version = this.context.version;
        if (target.version) version = target.version;          // the device's broadcast wins…
        if (this.context.forceVersion) version = this.context.forceVersion; // …but forceVersion wins all

        this.lan = new TuyaAccessory({
            ...this.context,
            ip: target.ip || this.context.ip,
            version,
            log: this.log,
            connect: false
        });
        this._wire(this.lan, 'lan');
        this.lan._connect();
    }

    _wire(backend, which) {
        backend.on('connect', () => this._onBackendConnect(which));
        backend.on('change', () => this._onBackendChange(which));
    }

    _onBackendConnect(which) {
        this.log.debug(`${this.context.name}: ${which} backend connected.`);
        if (!this._connectEmitted) {
            this._connectEmitted = true;
            this.emit('connect');
        }
    }

    /* ------------------------------------------------------------------ *
     *  State merge — LAN wins while it's up, cloud fills the rest / takes over
     * ------------------------------------------------------------------ */

    _merge() {
        const merged = {};
        if (this.cloud && this.cloud.connected) Object.assign(merged, this.cloud.state);
        // LAN overlays the cloud while it's connected: it's the authoritative,
        // freshest view for a device that's actually reachable locally.
        if (this.lan && this.lan.connected) Object.assign(merged, this._lanStateDualKeyed());
        return merged;
    }

    // LAN state is keyed by numeric dp id; mirror each value under its cloud code
    // too (using the map the cloud backend learned), so a code-style config still
    // resolves while the device is on the LAN.
    _lanStateDualKeyed() {
        const lanState = this.lan.state;
        if (!this.cloud) return lanState;
        const codeByDpId = this.cloud.codeByDpId;
        const out = {...lanState};
        for (const dp in lanState) {
            const code = codeByDpId[dp];
            if (code != null) out[code] = lanState[dp];
        }
        return out;
    }

    _onBackendChange(which) {
        if (this._stopped) return;
        if (!this._registered && !this._mayRegisterFrom(which)) return;

        const merged = this._merge();
        const changes = {};
        Object.keys(merged).forEach(key => {
            if (merged[key] !== this.state[key]) changes[key] = merged[key];
        });

        const first = !this._registered;
        if (first || Object.keys(changes).length) {
            this.state = {...this.state, ...merged};
            this._registered = true;
            // The first emit drives BaseAccessory's one-time characteristic
            // registration; later emits carry only what actually changed.
            this.emit('change', changes, this.state);
        }
    }

    // Decide whether `which` backend may drive the one-time characteristic
    // registration. LAN is always safe (numeric signature). The cloud is safe when
    // the device is cloud-only (no local key), or once it has the numeric map (state
    // is dual-keyed and so resolves a numeric-DP config), or once the LAN has been
    // given its head start and didn't show up.
    _mayRegisterFrom(which) {
        if (which === 'lan') return true;
        if (!this.context.key) return true;
        if (this.cloud && Object.keys(this.cloud.codeByDpId).length) return true;
        return this._lanGraceElapsed;
    }

    /* ------------------------------------------------------------------ *
     *  Writes — LAN first, cloud as a fallback
     * ------------------------------------------------------------------ */

    update(dps) {
        // Pure LAN (no cloud configured): byte-for-byte the legacy behaviour — a
        // synchronous boolean, so the sync write helpers keep detecting failures.
        if (!this.cloud) {
            return this.lan ? this.lan.update(this._toLanDps(dps)) : false;
        }
        return this._updateWithFallback(dps);
    }

    async _updateWithFallback(dps) {
        // Prefer the LAN while it's connected.
        if (this.lan && this.lan.connected) {
            if (this.lan.update(this._toLanDps(dps)) !== false) return true;
            this.log.debug(`${this.context.name}: LAN write didn't go through; trying the cloud.`);
        }
        if (this.cloud && this.cloud.connected) {
            return (await this.cloud.update(dps)) !== false;
        }
        // Cloud is down too — a last LAN attempt (it may have just dropped, and a
        // buffered write is better than a guaranteed failure).
        if (this.lan) return this.lan.update(this._toLanDps(dps)) !== false;
        return false;
    }

    // Translate a write keyed by codes and/or numeric ids into the numeric ids the
    // LAN protocol needs. Numeric ids pass straight through; a code with a known id
    // is translated; an unmapped code is left as-is (TuyaAccessory.update will then
    // simply ignore it, which is the safe degradation when no map is available).
    _toLanDps(dps) {
        if (!this.cloud || !dps || typeof dps !== 'object') return dps;
        const dpIdByCode = this.cloud.dpIdByCode;
        const out = {};
        for (const key in dps) out[dpIdByCode[key] || key] = dps[key];
        return out;
    }

    /* ------------------------------------------------------------------ *
     *  Teardown (tidy; Homebridge doesn't strictly require it)
     * ------------------------------------------------------------------ */

    stop() {
        this._stopped = true;
        if (this.cloud && typeof this.cloud.stop === 'function') this.cloud.stop();
        if (this.lan && typeof this.lan.stop === 'function') this.lan.stop();
    }
}

module.exports = TuyaDevice;
