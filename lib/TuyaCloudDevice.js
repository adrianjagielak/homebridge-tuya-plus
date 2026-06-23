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

        // Lets the cloud backend ask its parent TuyaDevice whether the SAME device
        // is currently reachable over the LAN. A cloud-fallback failure is harmless
        // when the LAN is up and worth surfacing when it isn't, so the failure log
        // adapts to it. Null when used standalone (no LAN sibling).
        this.isLanConnected = typeof props.isLanConnected === 'function' ? props.isLanConnected : null;

        // Keep a plain config object on `context`, mirroring TuyaAccessory, but
        // without the live helper objects we were handed.
        this.context = {...props};
        delete this.context.cloudApi;
        delete this.context.messaging;
        delete this.context.log;
        delete this.context.isLanConnected;

        this.state = {};
        this.connected = false;
        this._stopped = false;
        this._retryTimer = null;
        this._retryDelay = 0;          // current connect-retry backoff (ms); grows on repeated failure
        this._lastConnectError = null; // last surfaced connect error, so identical repeats stay quiet
        this._lastWriteError = null;   // last surfaced command-failure message, so identical repeats stay quiet
        this._warnedNoCloudCode = false; // surfaced the "data-point has no cloud code" note once

        // Per data-point code, the cloud control endpoint learned to work for it
        // ('commands' or 'properties'). It's tracked per code, not per device,
        // because one device can be mixed: some data-points live in its standard
        // instruction set (driven by the iot-03 commands API) and others only in its
        // thing model (driven by the property endpoint). Every code starts on the
        // commands API — the one tinytuya and the official plugin use, so the
        // best-understood for rate limits — and only a code the commands API rejects
        // as unsupported (2008/2003) is moved to the thing-model endpoint.
        // _propertiesTried bounds that probe to once per code so a genuinely
        // uncontrollable data-point can't re-probe on every write.
        this._codeMethod = {};
        this._propertiesTried = new Set();
        this._announcedProperties = false;
        this._catchupTimers = null; // post-write state re-reads (see _scheduleStateCatchup)
        this._writeChain = null;    // serializes cloud writes to this device (see update)

        // Bidirectional data-point maps, learned from the device's thing-shadow on
        // connect. They let this cloud transport (and the LAN+cloud TuyaDevice that
        // may wrap it) translate between the LAN's numeric data-point ids and the
        // cloud's string codes. Empty until the shadow is read; empty means
        // "code-only" (no numeric bridge), which is still fully functional for a
        // cloud-configured accessory.
        this.codeByDpId = {}; // '20'        -> 'switch_led'
        this.dpIdByCode = {}; // 'switch_led' -> '20'

        if (props.connect !== false) this._connect();
    }

    /* ------------------------------------------------------------------ *
     *  Connect: read initial state, announce, then let realtime keep it fresh.
     * ------------------------------------------------------------------ */

    async _connect() {
        if (!this.api || !this.api.isConfigured()) {
            return this.log.error(`${this.context.name}: Tuya Cloud is not configured (missing accessId/accessKey).`);
        }

        // First connect only: stagger the initial read so a large install doesn't
        // fire every device's OpenAPI call in the same instant (rate limits). The
        // platform hands each device an increasing cloudStartDelay.
        if (!this._staggered) {
            this._staggered = true;
            const delay = parseInt(this.context.cloudStartDelay) || 0;
            if (delay > 0) {
                await new Promise(resolve => { const t = setTimeout(resolve, delay); if (t.unref) t.unref(); });
                if (this._stopped) return;
            }
        }

        try {
            const props = await this._readInitialProperties();
            this._learnDpMap(props);
            this.state = this._propsToState(props);
            this.connected = await this._readOnline();

            this._logDiscoveredCodes(props);

            // Connected: announce recovery from any earlier failure once, and
            // reset the retry backoff.
            if (this._lastConnectError) {
                this.log.info(`${this.context.name}: Tuya Cloud connection restored.`);
                this._lastConnectError = null;
            }
            this._retryDelay = 0;

            this.emit('connect');
            // Accessories register their characteristics off the first 'change'.
            this.emit('change', {...this.state}, this.state);

            this._subscribeRealtime();
        } catch (ex) {
            this._onConnectFailure(ex);
        }
    }

    // A failed connect is retried, but the cause is frequently permanent — the
    // cloud project can't see this device (permission denied / "no space"), the
    // datacenter region is wrong, or the device isn't linked to the account — and
    // won't clear without the user changing their Tuya project. Since PR #71 the
    // cloud backs *every* device as a fallback, so a LAN-only device whose cloud
    // project lacks permission would otherwise log an error every 30s forever.
    // Two things keep that out of the log: a given message is surfaced once and then
    // suppressed to debug until it changes (or the device connects), and the retry
    // interval backs off (30s → 30m cap) instead of hammering the OpenAPI.
    _onConnectFailure(ex) {
        const message = ex && ex.message ? ex.message : String(ex);
        const {level, text} = this._describeConnectFailure(message);

        // The full (level + wording) is what the dedup tracks, not just the raw
        // message: it means a device that flips from "reachable over the LAN"
        // (harmless, debug) to "not reachable over the LAN either" (warn) re-surfaces
        // the change, while an unchanged situation stays quiet.
        if (text !== this._lastConnectError) {
            this.log[level](text);
            this._lastConnectError = text;
        } else {
            this.log.debug(`${this.context.name}: Tuya Cloud connection still failing: ${message}`);
        }

        if (this._stopped) return;
        // Exponential backoff: 30s after the first failure, doubling to a 30m cap.
        this._retryDelay = Math.min(this._retryDelay ? this._retryDelay * 2 : 30000, 1800000);
        this._retryTimer = setTimeout(() => this._connect(), this._retryDelay);
        if (this._retryTimer && this._retryTimer.unref) this._retryTimer.unref();
    }

    // Pick the log level and wording for a connect failure from what we know about
    // the device: whether the cloud is merely a fallback (the device has a local
    // key) and, if so, whether that LAN path is reachable right now.
    _describeConnectFailure(message) {
        const lanFallback = !!this.context.key;
        const lanReachable = lanFallback && !!(this.isLanConnected && this.isLanConnected());

        // "permission deny" (1106) is specifically a visibility problem: the cloud
        // project can't see this device. A device that has been offline for a long
        // time is a prime candidate for having been removed/unbound/reset, which
        // produces exactly this — so point at that, but only for this error (a
        // timeout or token failure is unrelated).
        const unbound = /permission deny|\b1106\b/i.test(message)
            ? ' Note: a device left offline for a long time can be removed or unbound from the account (e.g. reset or re-paired), which also produces this "permission deny".'
            : '';

        let level, hint;
        if (lanReachable) {
            // Confirmed reachable over the LAN, so the cloud fallback we couldn't
            // reach isn't needed. Keep it out of the way at debug.
            level = 'debug';
            hint = ' The device is reachable over the LAN, so only the (unused) cloud fallback is affected — harmless.';
        } else if (lanFallback) {
            // LAN-capable but not connected right now, so the cloud is currently the
            // only path and the device may be unresponsive in HomeKit.
            level = 'warn';
            hint = ` The cloud is only a fallback, but the device isn't reachable over the LAN right now either, so it may show as unresponsive in HomeKit. Check that it is linked to this cloud project (matching account/home and datacenter region).${unbound}`;
        } else {
            level = 'error';
            hint = ` This device is cloud-only, so it stays unreachable until this clears — check that it is linked to the cloud project (matching account/home and datacenter region).${unbound}`;
        }

        return {level, text: `${this.context.name}: Tuya Cloud connection failed: ${message}.${hint}`};
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
            const online = await this._readOnline();
            if (this.connected !== online) {
                this.connected = online;
                this.log.info(`${this.context.name}: Tuya now reports the device ${online ? 'online' : 'offline'}.`);
            }
            // Read via the same shadow-preferred path as the initial connect, not
            // the plain /status endpoint: a thing-model-only device (e.g. a custom
            // gate controller) returns an EMPTY /status result, so /status would
            // silently wipe nothing in and never reflect a state change.
            this._applyStatus(await this._readInitialProperties());
        } catch (ex) {
            this.log.debug(`${this.context.name}: cloud state refresh failed: ${ex.message}`);
        }
    }

    // Resolve the device's reachability from Tuya's `online` flag, so HomeKit
    // shows "No Response" when the device is genuinely offline. If the lookup
    // isn't available (e.g. the project lacks the device-management API) fall
    // back to reachable so control is never blocked.
    async _readOnline() {
        try {
            const info = await this.api.getDeviceInfo(this.context.id);
            if (info && typeof info.online === 'boolean') return info.online;
        } catch (ex) {
            this.log.debug(`${this.context.name}: online-status check failed: ${ex.message}`);
        }
        return true;
    }

    /* ------------------------------------------------------------------ *
     *  State helpers
     * ------------------------------------------------------------------ */

    // Read the device's initial data-points. Prefer the thing-shadow (it carries
    // the numeric dp_id alongside each code, so LAN<->cloud bridging works); fall
    // back to the plain status endpoint (code+value only) when the shadow isn't
    // available. Returns an array of {code, value, dp_id?}.
    async _readInitialProperties() {
        if (typeof this.api.getShadowProperties === 'function') {
            const props = await this.api.getShadowProperties(this.context.id);
            if (Array.isArray(props)) return props;
        }
        return this.api.getStatus(this.context.id);
    }

    // Learn the code <-> numeric dp_id mapping from a shadow-properties read.
    _learnDpMap(props) {
        (props || []).forEach(p => {
            if (!p || typeof p.code !== 'string' || p.dp_id == null) return;
            const dp = String(p.dp_id);
            this.codeByDpId[dp] = p.code;
            this.dpIdByCode[p.code] = dp;
        });
    }

    // Index a data-point under BOTH its string code and (when known) its numeric
    // dp id, so an accessory configured the LAN way (numeric) or the cloud way
    // (code) both resolve. The dp id comes from the shadow item, or — for code-only
    // realtime deltas — from the map learned on connect.
    _indexInto(target, code, value, dpId) {
        target[code] = value;
        const dp = dpId != null ? String(dpId) : this.dpIdByCode[code];
        if (dp != null) target[dp] = value;
    }

    // Build the dual-keyed state object from a properties/status array.
    _propsToState(props) {
        const state = {};
        (props || []).forEach(item => {
            if (item && typeof item.code === 'string') {
                this._indexInto(state, item.code, item.value, item.dp_id != null ? item.dp_id : item.dpId);
            }
        });
        return state;
    }

    // Apply a fresh snapshot (initial / catch-up) or a realtime delta, diff it
    // against what we hold, and emit only what changed — exactly mirroring
    // TuyaAccessory._change so accessories behave identically. State is dual-keyed
    // (code + numeric dp) so a LAN-style or cloud-style config both resolve.
    _applyStatus(status) {
        const incoming = this._propsToState(status);
        const changes = {};
        Object.keys(incoming).forEach(key => {
            if (incoming[key] !== this.state[key]) changes[key] = incoming[key];
        });
        if (Object.keys(changes).length) {
            this.state = {...this.state, ...incoming};
            this.emit('change', changes, this.state);
        }
        return changes;
    }

    _logDiscoveredCodes(props) {
        try {
            const list = (props || []).map(i => {
                const dp = i.dp_id != null ? i.dp_id : (i.dpId != null ? i.dpId : this.dpIdByCode[i.code]);
                return `${i.code}${dp != null ? `(dp ${dp})` : ''}=${JSON.stringify(i.value)}`;
            }).join(', ');
            this.log.debug(`${this.context.name}: Tuya Cloud data-points → ${list || '(none reported)'}`);
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
    // device catches up.
    //
    // Return contract mirrors TuyaAccessory.update() as far as a synchronous
    // caller is concerned (truthy on a no-op, `false` when not connected) but,
    // unlike the LAN class, the actual command travels over HTTP and only its
    // outcome reveals a failure. So when a command IS dispatched we return the
    // promise that resolves to the boolean result (and never rejects), letting
    // `BaseAccessory.setMultiStateAsync` await it and surface a rejected cloud
    // command to HomeKit instead of silently dropping it.
    update(dps) {
        if (!dps || typeof dps !== 'object') return true;

        // Keys may be numeric LAN dp ids (when a LAN-configured accessory falls
        // back to the cloud) or string codes (a cloud-configured accessory); the
        // commands API speaks codes, so translate via the learned map.
        const commands = Object.keys(dps).map(key => ({code: this._toCode(key), value: dps[key]}));
        if (!commands.length) return true;

        if (!this.connected) {
            this.log.debug(`${this.context.name}: skipping cloud write, not connected`);
            return false;
        }

        // Split off data-points we couldn't translate to a Tuya Cloud code: their
        // "code" is still a numeric LAN dp id (e.g. '1'), which the commands API
        // can't address — it would always answer "command or value not support
        // (2008)". This is the missing-dp-map case (the device-shadow API that
        // carries the id→code mapping isn't authorised for the project), so don't
        // fire a doomed command; explain it once instead.
        const sendable = [], undeliverable = [];
        commands.forEach(c => (this._isUntranslatedDpId(c.code) ? undeliverable : sendable).push(c));
        if (undeliverable.length) this._reportUndeliverableWrite(undeliverable);
        if (!sendable.length) return false;

        // Serialize writes to this device. HomeKit frequently double-sends a
        // characteristic write, and rapid changes (dragging a thermostat) fire a
        // burst; running them concurrently both races the per-code endpoint
        // learning (a duplicate could see a code "tried" but not yet learned and
        // fail spuriously) and bursts the cloud's QPS limit (uneven latency). One
        // at a time keeps learning coherent and the request rate smooth. _dispatch
        // never rejects, so the chain can't break.
        const run = () => this._dispatch(sendable);
        this._writeChain = this._writeChain ? this._writeChain.then(run, run) : run();
        return this._writeChain;
    }

    // Send a write, routing each data-point to the cloud endpoint it accepts. Codes
    // go over the standard commands API unless we've learned they need the thing
    // model, so the two groups can travel in parallel to their own endpoints. A
    // device with both kinds (a normal switch plus a custom trigger) drives each
    // correctly. Resolves true only if every group succeeded, false otherwise
    // (never rejects), mirroring TuyaAccessory.update for the awaiting accessory.
    async _dispatch(commands) {
        const viaProperties = commands.filter(c => this._codeMethod[c.code] === 'properties');
        const viaCommands = commands.filter(c => this._codeMethod[c.code] !== 'properties');

        const [byCommands, byProperties] = await Promise.all([
            this._sendGroup('commands', viaCommands),
            this._sendGroup('properties', viaProperties)
        ]);

        if (byCommands.ok && byProperties.ok) {
            this._lastWriteError = null;
            this._scheduleStateCatchup();
            return true;
        }
        this._reportWriteFailure(byCommands.error || byProperties.error);
        return false;
    }

    // Send one group of codes over `method`, recording per code which endpoint
    // worked. A commands group rejected as unsupported (2008/2003) is retried over
    // the thing-model property endpoint — where a custom device's data-points live —
    // but only for codes not already confirmed on commands or already tried there,
    // so a confirmed code is never moved and an uncontrollable one can't re-probe on
    // every write. Resolves to {ok, error}; never rejects.
    async _sendGroup(method, codes) {
        if (!codes.length) return {ok: true};

        const res = await this._send(method, codes);
        if (res.ok) return this._learn(codes, method);
        if (method !== 'commands' || !this._isInstructionMismatch(res.error)) return res;

        const fresh = codes.filter(c => this._codeMethod[c.code] !== 'commands' && !this._propertiesTried.has(c.code));
        if (!fresh.length) return res;
        fresh.forEach(c => this._propertiesTried.add(c.code));

        this.log.debug(`${this.context.name}: the cloud command API rejected ${this._codesOf(fresh)} (${res.error}); trying the thing-model property endpoint.`);
        const viaProperties = await this._send('properties', fresh);
        if (!viaProperties.ok) {
            this.log.debug(`${this.context.name}: the thing-model property endpoint also failed for ${this._codesOf(fresh)}: ${viaProperties.error}`);
            return res;
        }
        if (!this._announcedProperties) {
            this._announcedProperties = true;
            this.log.debug(`${this.context.name}: controlling some of this device's data-points over the Tuya thing-model property endpoint (they aren't in its standard instruction set).`);
        }
        return this._learn(fresh, 'properties');
    }

    // After a cloud write the resulting state (e.g. a gate's return_state flipping
    // to "opening") shows up in the cloud within ~a second, but the realtime stream
    // doesn't always carry it — and an accessory that mirrors a status DP (the
    // garage door) would otherwise sit on the old value forever. So re-read the
    // device a couple of times after a command to catch the transition. Each new
    // command re-arms it, so a burst of writes only triggers one catch-up; it only
    // runs on the cloud path, so a LAN-reachable device pays nothing.
    _scheduleStateCatchup() {
        if (this._catchupTimers) this._catchupTimers.forEach(t => clearTimeout(t));
        this._catchupTimers = [2000, 8000].map(delay => {
            const t = setTimeout(() => this._catchupOnce(), delay);
            if (t && t.unref) t.unref();
            return t;
        });
    }

    async _catchupOnce() {
        if (this._stopped) return;
        try {
            this._applyStatus(await this._readInitialProperties());
        } catch (ex) {
            this.log.debug(`${this.context.name}: post-write state catch-up failed: ${ex.message}`);
        }
    }

    // Invoke one control endpoint; resolves to {ok, error} and never rejects, so a
    // missing-method mock or a network error can't escape the dispatch.
    _send(method, commands) {
        let call;
        try {
            call = method === 'properties'
                ? this.api.sendProperties(this.context.id, commands)
                : this.api.sendCommands(this.context.id, commands);
        } catch (ex) {
            return Promise.resolve({ok: false, error: ex && ex.message ? ex.message : String(ex)});
        }
        return Promise.resolve(call).then(
            res => res !== false ? {ok: true} : {ok: false, error: `Tuya Cloud rejected ${JSON.stringify(commands)}`},
            ex => ({ok: false, error: ex && ex.message ? ex.message : String(ex)})
        );
    }

    _learn(codes, method) {
        codes.forEach(c => { this._codeMethod[c.code] = method; });
        return {ok: true};
    }

    _codesOf(commands) {
        return commands.map(c => c.code).join(', ');
    }

    // True for the "this code/value isn't a valid command for this device" errors —
    // command or value not support (2008) and function not support (2003) — which
    // are what a device with no standard instruction set answers, and exactly the
    // case the thing-model endpoint can still handle. Other failures (auth,
    // permission, network) won't be helped by the fallback, so we don't probe.
    _isInstructionMismatch(message) {
        return /\bcode (2008|2003)\b|command or value not support|function not support/i.test(message || '');
    }

    // A Tuya Cloud data-point is addressed by a string "code" (e.g. 'switch',
    // 'temp_set'); a code that is all digits is really a numeric LAN dp id that
    // _toCode couldn't translate (no map learned), which the cloud can't address.
    _isUntranslatedDpId(code) {
        return /^\d+$/.test(code);
    }

    // Surfaced once: the cloud can't address these data-points because the numeric
    // id→code map was never learned (the device-shadow/thing-model API isn't
    // authorised for this project — the same gap that makes shadow/properties
    // return "No space permission"). Mirrors the connect-failure dedup: one
    // actionable line, then quiet at debug. Stays harmless (debug) while the device
    // is reachable over the LAN, since the cloud is only a fallback there.
    _reportUndeliverableWrite(commands) {
        const ids = commands.map(c => c.code).join(', ');
        if (this._warnedNoCloudCode) {
            return this.log.debug(`${this.context.name}: cloud write skipped — no Tuya Cloud code for data-point(s) ${ids}.`);
        }
        this._warnedNoCloudCode = true;
        const lanReachable = !!(this.isLanConnected && this.isLanConnected());
        const level = lanReachable ? 'debug' : (this.context.key ? 'warn' : 'error');
        this.log[level](`${this.context.name}: can't control this device over the Tuya Cloud — its data-points are addressed by numeric id (${ids}) but the cloud only accepts string "codes", so the command would be rejected ("command or value not support"). That id→code mapping is read from the device-shadow API, which isn't authorised for this cloud project ("No space permission"); authorise it (and add the device to the project's space), or set the accessory's dp* options to cloud codes. The device still works over the LAN.`);
    }

    // A genuine command failure (the cloud was reached but rejected/errored).
    // Deduped like the connect path — surfaced once, identical repeats drop to
    // debug — with the level matched to severity: a LAN-capable device is only
    // momentarily off the LAN (warn), a cloud-only one is stuck until it clears
    // (error). _lastWriteError is cleared on the next successful command.
    _reportWriteFailure(message) {
        if (message === this._lastWriteError) {
            return this.log.debug(`${this.context.name}: cloud command still failing: ${message}`);
        }
        this._lastWriteError = message;
        this.log[this.context.key ? 'warn' : 'error'](`${this.context.name}: cloud command failed: ${message}`);
    }

    // Resolve a write key (a numeric LAN dp id or a string code) to the Tuya Cloud
    // `code` the commands API expects. A numeric id with a known code is
    // translated; anything else (already a code, or an unmapped id) is passed
    // through unchanged.
    _toCode(key) {
        return this.codeByDpId[key] || key;
    }

    /* ------------------------------------------------------------------ *
     *  Teardown (tidy; Homebridge doesn't strictly require it)
     * ------------------------------------------------------------------ */

    stop() {
        this._stopped = true;
        if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
        if (this._catchupTimers) { this._catchupTimers.forEach(t => clearTimeout(t)); this._catchupTimers = null; }
    }
}

module.exports = TuyaCloudDevice;
