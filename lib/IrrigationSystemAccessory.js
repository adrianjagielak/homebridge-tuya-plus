const BaseAccessory = require('./BaseAccessory');

/**
 * IrrigationSystemAccessory
 *
 * A fully-fledged HomeKit irrigation controller for Tuya multi-valve devices
 * (e.g. the 4-zone faucet/valve timers that expose `switch_1..switch_n` and a
 * `battery_percentage`).
 *
 * HomeKit modelling (one bridged accessory, category SPRINKLER):
 *
 *   IrrigationSystem  (primary service — the "system" tile + master on/off)
 *     ├─ Valve  "Zone A"   (linked, ValveType=IRRIGATION, ServiceLabelIndex 1)
 *     ├─ Valve  "Zone B"   (linked, ServiceLabelIndex 2)
 *     ├─ ...
 *   Battery            (BatteryLevel + StatusLowBattery)
 *
 * Each Valve carries its own SetDuration/RemainingDuration so the Home app shows
 * the familiar per-zone "Duration" picker and a live countdown. A zone whose
 * duration is 0 runs indefinitely (until it is turned off again) — handy for
 * long manual watering tasks. All writes are coalesced into a single Tuya
 * command (the device is a laggy, battery-powered Wi-Fi unit), so turning the
 * whole system on/off — or running a scene that toggles several zones at once —
 * results in one network round-trip rather than a burst of them.
 */
class IrrigationSystemAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.SPRINKLER;
    }

    constructor(...props) {
        super(...props);
    }

    /* ------------------------------------------------------------------ *
     *  Configuration helpers
     * ------------------------------------------------------------------ */

    // Resolve the list of valves/zones from the device config. Defaults to the
    // 4-zone A/B/C/D layout of the reference device (switch_1..switch_4 on
    // DP 1..4). A `valves` array lets non-sequential / custom devices map their
    // own data-points and names.
    _getValveConfigs() {
        // Self-contained (no reliance on instance state) so it is safe to call
        // both during early service reconciliation and later when wiring
        // characteristics.
        const cloud = this._isCloud();
        const defaultDuration = isFinite(this.device.context.defaultDuration) ? parseInt(this.device.context.defaultDuration) : 600;

        if (Array.isArray(this.device.context.valves) && this.device.context.valves.length) {
            return this.device.context.valves.map((valve, i) => {
                // A data-point may be a numeric LAN id (1, 2, …) or a Tuya Cloud
                // code (e.g. "switch_1"). Accept either; only an empty value is
                // invalid.
                const dp = (valve && valve.dp !== undefined && valve.dp !== null) ? ('' + valve.dp).trim() : '';
                if (!dp) {
                    throw new Error(`The valve definition #${i + 1} is missing a 'dp': ${JSON.stringify(valve)}`);
                }
                return {
                    dp,
                    name: (('' + (valve.name || '')).trim()) || ('Zone ' + (i + 1)),
                    index: i + 1,
                    duration: isFinite(valve.defaultDuration) ? parseInt(valve.defaultDuration) : defaultDuration
                };
            });
        }

        const count = Math.max(1, parseInt(this.device.context.valveCount) || 4);
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const configs = [];
        for (let i = 0; i < count; i++) {
            configs.push({
                // Cloud devices address valves by code (switch_1, switch_2, …);
                // LAN devices by numeric data-point id (1, 2, …).
                dp: cloud ? ('switch_' + (i + 1)) : String(i + 1),
                name: 'Valve ' + (letters[i] || (i + 1)),
                index: i + 1,
                duration: defaultDuration
            });
        }
        return configs;
    }

    // True when this device is reached over the Tuya Cloud (data-points keyed by
    // string code) rather than the LAN (numeric data-point ids).
    _isCloud() {
        return this._coerceBoolean(this.device.context.cloud, false);
    }

    // Resolve a configurable data-point that may be given as a numeric LAN id or
    // a Tuya Cloud code, falling back to a sensible default for the active
    // transport.
    _resolveDP(value, cloudDefault, lanDefault) {
        const v = (value === undefined || value === null) ? '' : ('' + value).trim();
        if (v !== '') return v;
        return this._isCloud() ? cloudDefault : lanDefault;
    }

    _hasBattery() {
        return !this._coerceBoolean(this.device.context.noBattery, false);
    }

    /* ------------------------------------------------------------------ *
     *  Service registration / cache reconciliation
     * ------------------------------------------------------------------ */

    _registerPlatformAccessory() {
        this._verifyCachedPlatformAccessory();
        this._justRegistered = true;

        super._registerPlatformAccessory();
    }

    _verifyCachedPlatformAccessory() {
        if (this._justRegistered) return;

        const {Service, Characteristic} = this.hap;

        // --- IrrigationSystem (primary) ---
        let irrigation = this.accessory.getService(Service.IrrigationSystem);
        if (irrigation) this._checkServiceName(irrigation, this.device.context.name);
        else irrigation = this.accessory.addService(Service.IrrigationSystem, this.device.context.name);
        irrigation.setPrimaryService(true);

        // --- Valves (one per zone), linked to the irrigation system ---
        const valveConfigs = this._getValveConfigs();
        const validValveSubtypes = [];
        valveConfigs.forEach(cfg => {
            const subtype = 'valve-' + cfg.dp;
            validValveSubtypes.push(subtype);

            let valve = this.accessory.getServiceById(Service.Valve, subtype);
            if (valve) this._checkServiceName(valve, cfg.name);
            else valve = this.accessory.addService(Service.Valve, cfg.name, subtype);

            // Linking is what makes the Home app nest the zones under the single
            // irrigation tile instead of scattering them as separate tiles.
            // addLinkedService is idempotent, so it is safe to call on every
            // cache reconcile.
            irrigation.addLinkedService(valve);
        });

        // --- Battery (optional) ---
        if (this._hasBattery()) {
            if (!this.accessory.getService(Service.Battery)) {
                this.accessory.addService(Service.Battery, this.device.context.name + ' Battery');
            }
        }

        // --- Remove services that no longer belong (config changed) ---
        this.accessory.services
            .filter(service => service.UUID === Service.Valve.UUID && !validValveSubtypes.includes(service.subtype))
            .forEach(service => {
                this.log.info('Removing stale valve service %s', service.displayName);
                this.accessory.removeService(service);
            });

        if (!this._hasBattery()) {
            const battery = this.accessory.getService(Service.Battery);
            if (battery) this.accessory.removeService(battery);
        }

        // Rain/leak sensors are no longer supported: they never reported
        // reliably on these devices, and bundling a sensor in the same accessory
        // forced the Home app to fragment the sprinkler into "sub-accessories"
        // (blocking control from the main tile). Drop any left over from an older
        // version so the accessory stays a clean, single-category sprinkler tile.
        [Service.ContactSensor, Service.LeakSensor].forEach(S => {
            const svc = this.accessory.getService(S);
            if (svc) {
                this.log.info('Removing rain sensor service %s (no longer supported)', svc.displayName);
                this.accessory.removeService(svc);
            }
        });
    }

    /* ------------------------------------------------------------------ *
     *  Characteristic wiring
     * ------------------------------------------------------------------ */

    _registerCharacteristics(dps) {
        this._verifyCachedPlatformAccessory();

        const {Service, Characteristic} = this.hap;

        // Tunables
        this._defaultDuration = isFinite(this.device.context.defaultDuration) ? parseInt(this.device.context.defaultDuration) : 600;
        // Max selectable duration. HAP's default max for SetDuration/
        // RemainingDuration is 3600s (1h); raise it so longer runs aren't
        // silently clamped. Apple's Home app honours the advertised maxValue.
        this._maxDuration = isFinite(this.device.context.maxDuration) ? parseInt(this.device.context.maxDuration) : 7200;
        this._lowBatteryThreshold = isFinite(this.device.context.lowBatteryThreshold) ? parseInt(this.device.context.lowBatteryThreshold) : 20;
        this._debounce = isFinite(this.device.context.commandDebounce) ? parseInt(this.device.context.commandDebounce) : 500;
        this._cascadeOn = this._coerceBoolean(this.device.context.masterTurnsOnAllZones, true);
        this._cascadeOff = this._coerceBoolean(this.device.context.masterTurnsOffAllZones, true);

        // Data-points accept a numeric LAN id or a Tuya Cloud code; defaults
        // differ per transport (cloud uses the standard Tuya codes).
        this.dpBattery = this._resolveDP(this.device.context.dpBattery, 'battery_percentage', '46');
        this.dpCharging = this._resolveDP(this.device.context.dpCharging, 'charge_state', '101');

        // Per-zone runtime state
        this._valves = this._getValveConfigs();
        this._timers = {};       // dp -> setTimeout handle for auto-shutoff
        this._endTimes = {};     // dp -> ms timestamp when the run ends
        this._pendingWrite = null;

        // Persisted, user-editable per-zone durations and names.
        this.accessory.context.durations = this.accessory.context.durations || {};
        this.accessory.context.zoneNames = this.accessory.context.zoneNames || {};

        const irrigation = this.accessory.getService(Service.IrrigationSystem);

        // --- IrrigationSystem characteristics ---
        irrigation.getCharacteristic(Characteristic.ProgramMode)
            .updateValue(Characteristic.ProgramMode.NO_PROGRAM_SCHEDULED);

        this._systemActiveChar = irrigation.getCharacteristic(Characteristic.Active)
            .updateValue(this._anyValveOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
            .onGet(() => this._anyValveOn() ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
            .onSet(value => this._setSystemActive(value));

        this._systemInUseChar = irrigation.getCharacteristic(Characteristic.InUse)
            .updateValue(this._anyValveOn() ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);

        this._systemRemainingChar = irrigation.getCharacteristic(Characteristic.RemainingDuration)
            .setProps({maxValue: this._maxDuration})
            .updateValue(0)
            .onGet(() => this._systemRemaining());

        // --- Valve characteristics ---
        this._valves.forEach(cfg => {
            const valve = this.accessory.getServiceById(Service.Valve, 'valve-' + cfg.dp);
            const on = !!dps[cfg.dp];

            valve.getCharacteristic(Characteristic.ValveType)
                .updateValue(Characteristic.ValveType.IRRIGATION);
            valve.getCharacteristic(Characteristic.IsConfigured)
                .updateValue(Characteristic.IsConfigured.CONFIGURED);
            valve.getCharacteristic(Characteristic.ServiceLabelIndex)
                .updateValue(cfg.index);

            // ConfiguredName so each zone shows its own name in the Home app
            // (otherwise every zone inherits the accessory/system name).
            if (Characteristic.ConfiguredName) {
                const savedName = this.accessory.context.zoneNames[cfg.dp] || cfg.name;
                valve.getCharacteristic(Characteristic.ConfiguredName)
                    .updateValue(savedName)
                    .onSet(value => { this.accessory.context.zoneNames[cfg.dp] = value; });
            }

            valve.getCharacteristic(Characteristic.SetDuration)
                .setProps({maxValue: this._maxDuration})
                .updateValue(this._getDuration(cfg))
                .onGet(() => this._getDuration(cfg))
                .onSet(value => this._setDuration(cfg, value));

            valve.getCharacteristic(Characteristic.RemainingDuration)
                .setProps({maxValue: this._maxDuration})
                .updateValue(0)
                .onGet(() => this._valveRemaining(cfg));

            valve.getCharacteristic(Characteristic.Active)
                .updateValue(on ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE)
                .onGet(() => (this.getStateAsync(cfg.dp) ? 1 : 0))
                .onSet(value => this._setValveActive(cfg, value));

            valve.getCharacteristic(Characteristic.InUse)
                .updateValue(on ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);

            // Reflect any zone already running at startup (e.g. turned on at the
            // device, or Homebridge restarted mid-run) and (re)arm its timer.
            if (on) this._reflectValve(cfg, true);
        });

        // --- Battery ---
        if (this._hasBattery()) {
            const battery = this.accessory.getService(Service.Battery);
            const level = this._batteryLevel(dps[this.dpBattery]);
            battery.getCharacteristic(Characteristic.BatteryLevel)
                .updateValue(level)
                .onGet(() => this._batteryLevel(this.getStateAsync(this.dpBattery)));
            battery.getCharacteristic(Characteristic.StatusLowBattery)
                .updateValue(this._lowBattery(level))
                .onGet(() => this._lowBattery(this._batteryLevel(this.getStateAsync(this.dpBattery))));
            // ChargingState follows the device's charging data-point when it
            // reports one (solar / USB-C rechargeable units); devices that
            // don't report charging fall back to NOT_CHARGEABLE.
            battery.getCharacteristic(Characteristic.ChargingState)
                .updateValue(this._chargingState(dps[this.dpCharging]))
                .onGet(() => this._chargingState(this.getStateAsync(this.dpCharging)));
        }

        this._syncAggregate();

        // --- React to device-side changes (physical buttons, our own writes
        //     being confirmed, battery telemetry) ---
        this.device.on('change', (changes) => this._onDeviceChange(changes));
    }

    /* ------------------------------------------------------------------ *
     *  Device change handling
     * ------------------------------------------------------------------ */

    _onDeviceChange(changes) {
        const {Service, Characteristic} = this.hap;

        let valveChanged = false;
        this._valves.forEach(cfg => {
            if (!changes.hasOwnProperty(cfg.dp)) return;
            valveChanged = true;
            this._reflectValve(cfg, !!changes[cfg.dp]);
        });

        if (changes.hasOwnProperty(this.dpBattery) && this._hasBattery()) {
            const battery = this.accessory.getService(Service.Battery);
            if (battery) {
                const level = this._batteryLevel(changes[this.dpBattery]);
                battery.getCharacteristic(Characteristic.BatteryLevel).updateValue(level);
                battery.getCharacteristic(Characteristic.StatusLowBattery).updateValue(this._lowBattery(level));
            }
        }

        if (changes.hasOwnProperty(this.dpCharging) && this._hasBattery()) {
            const battery = this.accessory.getService(Service.Battery);
            if (battery) battery.getCharacteristic(Characteristic.ChargingState)
                .updateValue(this._chargingState(changes[this.dpCharging]));
        }

        if (valveChanged) this._syncAggregate();
    }

    /* ------------------------------------------------------------------ *
     *  Valve activation + timer logic
     * ------------------------------------------------------------------ */

    // Called from HomeKit (Valve.Active onSet). Writes to the device and
    // mirrors the state locally.
    _setValveActive(cfg, value) {
        const {Characteristic} = this.hap;
        const on = value === Characteristic.Active.ACTIVE || value === true || value === 1;

        const service = this._valveService(cfg);
        // Guard against iOS firing duplicate onSet callbacks.
        if (service && service.getCharacteristic(Characteristic.Active).value === (on ? 1 : 0) &&
            !!this.device.state[cfg.dp] === on) {
            return;
        }

        this._queueWrite(cfg.dp, on);
        this._reflectValve(cfg, on);
        this._syncAggregate();
    }

    // Mirror a zone's on/off state into HomeKit and (dis)arm its auto-shutoff
    // timer. Does NOT write to the device — call _queueWrite separately for that.
    _reflectValve(cfg, on) {
        const {Characteristic} = this.hap;
        const service = this._valveService(cfg);
        if (!service) return;

        const activeChar = service.getCharacteristic(Characteristic.Active);
        const inUseChar = service.getCharacteristic(Characteristic.InUse);
        const remainingChar = service.getCharacteristic(Characteristic.RemainingDuration);

        this._clearTimer(cfg.dp);

        if (on) {
            const duration = this._getDuration(cfg);
            if (activeChar.value !== Characteristic.Active.ACTIVE) activeChar.updateValue(Characteristic.Active.ACTIVE);
            if (inUseChar.value !== Characteristic.InUse.IN_USE) inUseChar.updateValue(Characteristic.InUse.IN_USE);

            if (duration > 0) {
                this._endTimes[cfg.dp] = Date.now() + duration * 1000;
                remainingChar.updateValue(duration);
                this._timers[cfg.dp] = setTimeout(() => {
                    this.log.info('%s: zone "%s" timer expired, shutting off', this.device.context.name, cfg.name);
                    this._queueWrite(cfg.dp, false);
                    this._reflectValve(cfg, false);
                    this._syncAggregate();
                }, duration * 1000);
            } else {
                // Indefinite run — no auto-shutoff, no countdown.
                this._endTimes[cfg.dp] = null;
                remainingChar.updateValue(0);
            }
        } else {
            this._endTimes[cfg.dp] = null;
            if (activeChar.value !== Characteristic.Active.INACTIVE) activeChar.updateValue(Characteristic.Active.INACTIVE);
            if (inUseChar.value !== Characteristic.InUse.NOT_IN_USE) inUseChar.updateValue(Characteristic.InUse.NOT_IN_USE);
            remainingChar.updateValue(0);
        }
    }

    _clearTimer(dp) {
        if (this._timers[dp]) {
            clearTimeout(this._timers[dp]);
            this._timers[dp] = null;
        }
    }

    /* ------------------------------------------------------------------ *
     *  Master (whole-system) on/off
     * ------------------------------------------------------------------ */

    _setSystemActive(value) {
        const {Characteristic} = this.hap;
        const on = value === Characteristic.Active.ACTIVE || value === true || value === 1;

        if (on && !this._cascadeOn) return;     // master is a passive enable
        if (!on && !this._cascadeOff) return;

        // Act on what the user sees (the valve's HomeKit Active value) so the
        // cascade self-heals stale optimistic states and doesn't reset the
        // countdown on a zone that is already running. Only zones that actually
        // change are touched; _flushWrites then coalesces them into a single
        // Tuya command and drops any that already match the real device state.
        this._valves.forEach(cfg => {
            const service = this._valveService(cfg);
            const currentlyOn = !!(service && service.getCharacteristic(Characteristic.Active).value);
            if (currentlyOn === on) return;
            this._queueWrite(cfg.dp, on);
            this._reflectValve(cfg, on);
        });
        this._syncAggregate();
    }

    /* ------------------------------------------------------------------ *
     *  Duration helpers
     * ------------------------------------------------------------------ */

    _getDuration(cfg) {
        const saved = this.accessory.context.durations[cfg.dp];
        return isFinite(saved) ? saved : cfg.duration;
    }

    _setDuration(cfg, value) {
        const {Characteristic} = this.hap;
        const seconds = Math.max(0, parseInt(value) || 0);
        this.accessory.context.durations[cfg.dp] = seconds;
        this.log.info('%s: zone "%s" duration set to %s', this.device.context.name, cfg.name, seconds ? (seconds + 's') : 'indefinite');

        // If the zone is running, re-base its countdown on the new duration.
        const service = this._valveService(cfg);
        if (service && service.getCharacteristic(Characteristic.InUse).value === Characteristic.InUse.IN_USE) {
            this._clearTimer(cfg.dp);
            const remainingChar = service.getCharacteristic(Characteristic.RemainingDuration);
            if (seconds > 0) {
                this._endTimes[cfg.dp] = Date.now() + seconds * 1000;
                remainingChar.updateValue(seconds);
                this._timers[cfg.dp] = setTimeout(() => {
                    this._queueWrite(cfg.dp, false);
                    this._reflectValve(cfg, false);
                    this._syncAggregate();
                }, seconds * 1000);
            } else {
                this._endTimes[cfg.dp] = null;
                remainingChar.updateValue(0);
            }
            this._syncAggregate();
        }
    }

    _valveRemaining(cfg) {
        const end = this._endTimes[cfg.dp];
        if (!end) return 0;
        const remaining = Math.round((end - Date.now()) / 1000);
        return remaining > 0 ? remaining : 0;
    }

    _systemRemaining() {
        let max = 0;
        this._valves.forEach(cfg => {
            const r = this._valveRemaining(cfg);
            if (r > max) max = r;
        });
        return max;
    }

    /* ------------------------------------------------------------------ *
     *  Aggregation: roll zone state up to the IrrigationSystem service
     * ------------------------------------------------------------------ */

    _anyValveOn() {
        return this._valves.some(cfg => !!this.device.state[cfg.dp]);
    }

    _syncAggregate() {
        const {Characteristic} = this.hap;
        const anyOn = this._valves.some(cfg => {
            const service = this._valveService(cfg);
            return service && service.getCharacteristic(Characteristic.InUse).value === Characteristic.InUse.IN_USE;
        });

        if (this._systemInUseChar) {
            const v = anyOn ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE;
            if (this._systemInUseChar.value !== v) this._systemInUseChar.updateValue(v);
        }
        if (this._systemActiveChar) {
            const v = anyOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            if (this._systemActiveChar.value !== v) this._systemActiveChar.updateValue(v);
        }
        if (this._systemRemainingChar) {
            this._systemRemainingChar.updateValue(this._systemRemaining());
        }
    }

    /* ------------------------------------------------------------------ *
     *  Battery mapping
     * ------------------------------------------------------------------ */

    _batteryLevel(value) {
        const n = parseInt(value);
        if (!isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    _lowBattery(level) {
        const {Characteristic} = this.hap;
        return level <= this._lowBatteryThreshold
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    }

    // CHARGING / NOT_CHARGING from the device's boolean charging data-point.
    // Devices that don't report charging (no such data-point) → NOT_CHARGEABLE.
    _chargingState(value) {
        const {Characteristic} = this.hap;
        if (typeof value !== 'boolean') return Characteristic.ChargingState.NOT_CHARGEABLE;
        return value
            ? Characteristic.ChargingState.CHARGING
            : Characteristic.ChargingState.NOT_CHARGING;
    }

    /* ------------------------------------------------------------------ *
     *  Batched writes — coalesce DP updates into a single Tuya command
     * ------------------------------------------------------------------ */

    _queueWrite(dp, value) {
        if (!this._pendingWrite) this._pendingWrite = {dps: {}};
        this._pendingWrite.dps[String(dp)] = value;

        if (this._pendingWrite.timer) clearTimeout(this._pendingWrite.timer);
        this._pendingWrite.timer = setTimeout(() => this._flushWrites(), this._debounce);
    }

    _flushWrites() {
        const pending = this._pendingWrite;
        this._pendingWrite = null;
        if (!pending) return;

        if (!this.device.connected) {
            this.log.debug('%s: skipping write, device not connected', this.device.context.name);
            return;
        }

        // Send exactly what was queued. We deliberately do NOT drop data-points
        // that appear to already match `device.state`: cloud devices never
        // optimistically advance `state` (it only moves when the realtime/refresh
        // stream confirms the device), so comparing against it would silently
        // swallow a genuine command. The most visible symptom was a valve that
        // could be turned on but never off — the "off" matched the stale "off"
        // still in `state` (the "on" hadn't been echoed back yet) and was
        // discarded, so HomeKit showed the zone closed while it kept running.
        // Callers (_setValveActive, _setSystemActive, the auto-shutoff timers)
        // already queue only real changes, judged against the HomeKit state the
        // user sees, so there is nothing left to de-dupe here.
        const dps = pending.dps;
        if (Object.keys(dps).length) this.device.update(dps);
    }

    _valveService(cfg) {
        const {Service} = this.hap;
        return this.accessory.getServiceById(Service.Valve, 'valve-' + cfg.dp);
    }
}

module.exports = IrrigationSystemAccessory;
