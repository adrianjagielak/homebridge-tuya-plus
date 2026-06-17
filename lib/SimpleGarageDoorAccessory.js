const BaseAccessory = require('./BaseAccessory');

// This controller reports its movement on a single status DP (default 105),
// but only distinguishes three values:
//
//   11 -> stopped            (gate parked part-way, or fully open)
//   12 -> opening OR open
//   13 -> closing OR closed
//
// HomeKit's GarageDoorOpener only needs the two states it can act on, so we
// collapse the three: 11/12 => OPEN, 13 => CLOSED. Both CurrentDoorState and
// TargetDoorState are mirrored straight from this DP, which keeps HomeKit in
// sync no matter how the gate was triggered (Home app, a physical remote, the
// Tuya app, ...).
//
// Opening is symmetric and forgiving: the controller reverses on its own, so
// an open command works directly even while the gate is closing — we just fire
// it. Closing is asymmetric, though: the controller IGNORES a close command
// while the gate is actively moving. The one exception is when the status DP
// reads exactly 11 (stopped) — e.g. after a partial-open or an external stop —
// where the gate is idle and accepts close immediately. So unless we can see
// it's already stopped, a close is sent as stop -> wait -> close.
const STATE_STOPPED = 11;
const STATE_OPENING_OR_OPEN = 12;
const STATE_CLOSING_OR_CLOSED = 13;

// How long to wait between the stop and the close in the stop-before-close
// path. Overridable per-device via the `stopBeforeCloseMs` config option.
const DEFAULT_STOP_BEFORE_CLOSE_MS = 1500;

class SimpleGarageDoorAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.GARAGE_DOOR_OPENER;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;
        this.accessory.addService(Service.GarageDoorOpener, this.device.context.name);
        this._reconcileOptionalServices();
        super._registerPlatformAccessory();
    }

    _reconcileOptionalServices() {
        const {Service} = this.hap;

        const partialOpenMs = parseInt(this.device.context.partialOpenMs, 10);
        const wantPartialOpen = Number.isFinite(partialOpenMs) && partialOpenMs > 0;
        const partialName = this.device.context.name + ' Partial Open';
        let partialSwitch = this.accessory.getServiceById(Service.Switch, 'partialOpen');
        if (wantPartialOpen) {
            if (partialSwitch) this._checkServiceName(partialSwitch, partialName);
            else this.accessory.addService(Service.Switch, partialName, 'partialOpen');
        } else if (partialSwitch) {
            this.accessory.removeService(partialSwitch);
        }

        const wantForceSwitches = this._coerceBoolean(this.device.context.forceSwitches, false);
        const forceOpenName = this.device.context.name + ' Force Open';
        const forceCloseName = this.device.context.name + ' Force Close';
        let forceOpenSwitch = this.accessory.getServiceById(Service.Switch, 'forceOpen');
        let forceCloseSwitch = this.accessory.getServiceById(Service.Switch, 'forceClose');
        if (wantForceSwitches) {
            if (forceOpenSwitch) this._checkServiceName(forceOpenSwitch, forceOpenName);
            else this.accessory.addService(Service.Switch, forceOpenName, 'forceOpen');
            if (forceCloseSwitch) this._checkServiceName(forceCloseSwitch, forceCloseName);
            else this.accessory.addService(Service.Switch, forceCloseName, 'forceClose');
        } else {
            if (forceOpenSwitch) this.accessory.removeService(forceOpenSwitch);
            if (forceCloseSwitch) this.accessory.removeService(forceCloseSwitch);
        }
    }

    _registerCharacteristics(dps) {
        this._reconcileOptionalServices();

        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.GarageDoorOpener);
        this._checkServiceName(service, this.device.context.name);

        this.dpOpen = this._getCustomDP(this.device.context.dpOpen) || '101';
        this.dpClose = this._getCustomDP(this.device.context.dpClose) || '102';
        this.dpStop = this._getCustomDP(this.device.context.dpStop) || '103';
        this.dpState = this._getCustomDP(this.device.context.dpState) || '105';

        const partialOpenMs = parseInt(this.device.context.partialOpenMs, 10);
        this.partialOpenMs = Number.isFinite(partialOpenMs) && partialOpenMs > 0 ? partialOpenMs : 0;

        const stopBeforeCloseMs = parseInt(this.device.context.stopBeforeCloseMs, 10);
        this.stopBeforeCloseMs = Number.isFinite(stopBeforeCloseMs) && stopBeforeCloseMs >= 0
            ? stopBeforeCloseMs
            : DEFAULT_STOP_BEFORE_CLOSE_MS;

        // Pending side effects we may need to cancel: the partial-open auto-stop
        // and the close that trails a stop in the stop-before-close path.
        this.partialStopTimer = null;
        this.pendingCloseTimer = null;

        // Seed the initial state from whatever the device has already reported.
        // If it hasn't reported yet, fall back to the persisted target, then to
        // CLOSED (the safer assumption for a gate). The real state DP almost
        // always arrives within a second of connecting and corrects this.
        let isOpen = this._mapDpState(dps[this.dpState]);
        if (isOpen === null) {
            isOpen = this.accessory.context.cachedTargetDoorState === Characteristic.TargetDoorState.OPEN;
        }
        this.currentDoorState = isOpen
            ? Characteristic.CurrentDoorState.OPEN
            : Characteristic.CurrentDoorState.CLOSED;
        const initialTarget = isOpen
            ? Characteristic.TargetDoorState.OPEN
            : Characteristic.TargetDoorState.CLOSED;
        this.accessory.context.cachedTargetDoorState = initialTarget;

        this.characteristicTargetDoorState = service.getCharacteristic(Characteristic.TargetDoorState)
            .updateValue(initialTarget)
            .onGet(() => this.accessory.context.cachedTargetDoorState)
            .onSet(value => this.setTargetDoorState(value));

        this.characteristicCurrentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(this.currentDoorState)
            .onGet(() => this.currentDoorState);

        // The controller exposes limit switches (l_open/l_close) but they don't
        // work in practice, and there's no obstruction sensor wired up, so this
        // is always reported clear.
        service.getCharacteristic(Characteristic.ObstructionDetected)
            .updateValue(false)
            .onGet(() => false);

        const partialSwitch = this.accessory.getServiceById(Service.Switch, 'partialOpen');
        if (partialSwitch) {
            const onChar = partialSwitch.getCharacteristic(Characteristic.On)
                .updateValue(isOpen)
                .onGet(() => this.currentDoorState === Characteristic.CurrentDoorState.OPEN)
                .onSet(value => {
                    // Stateful: the switch mirrors CurrentDoorState (ON while
                    // the gate is open in HomeKit's view — see
                    // _applyReportedState). Tapping it ON triggers a
                    // partial-open; tapping it OFF triggers a full close.
                    if (value) {
                        this._handlePartialOpen();
                    } else {
                        this.setTargetDoorState(Characteristic.TargetDoorState.CLOSED);
                    }
                });
            this.characteristicPartialOpen = onChar;
        }

        const forceOpenSwitch = this.accessory.getServiceById(Service.Switch, 'forceOpen');
        if (forceOpenSwitch) {
            const onChar = forceOpenSwitch.getCharacteristic(Characteristic.On)
                .updateValue(false)
                .onGet(() => false)
                .onSet(value => {
                    if (!value) return;
                    this.setTargetDoorState(Characteristic.TargetDoorState.OPEN);
                    setImmediate(() => onChar.updateValue(false));
                });
            this.characteristicForceOpen = onChar;
        }

        const forceCloseSwitch = this.accessory.getServiceById(Service.Switch, 'forceClose');
        if (forceCloseSwitch) {
            const onChar = forceCloseSwitch.getCharacteristic(Characteristic.On)
                .updateValue(false)
                .onGet(() => false)
                .onSet(value => {
                    if (!value) return;
                    this.setTargetDoorState(Characteristic.TargetDoorState.CLOSED);
                    setImmediate(() => onChar.updateValue(false));
                });
            this.characteristicForceClose = onChar;
        }

        this.device.on('change', changes => this._onDeviceChange(changes));
    }

    // Maps a raw status DP value to open (true) / closed (false) / unknown
    // (null). 11 (stopped) and 12 (opening or open) are both "open" as far as
    // HomeKit is concerned; 13 (closing or closed) is "closed".
    _mapDpState(raw) {
        const value = typeof raw === 'string' ? parseInt(raw, 10) : raw;
        if (value === STATE_STOPPED || value === STATE_OPENING_OR_OPEN) return true;
        if (value === STATE_CLOSING_OR_CLOSED) return false;
        return null;
    }

    _onDeviceChange(changes) {
        if (!changes || !changes.hasOwnProperty(this.dpState)) return;
        // Mid stop-before-close: the stop we just issued can briefly report 11
        // (=OPEN), which would fight the close we're about to send. Ignore
        // status reports until the close has gone out.
        if (this.pendingCloseTimer) return;
        const isOpen = this._mapDpState(changes[this.dpState]);
        if (isOpen === null) {
            this.log.info(`[SimpleGarageDoor] ${this.device.context.name}: ignoring unknown state DP value ${JSON.stringify(changes[this.dpState])}`);
            return;
        }
        this._applyReportedState(isOpen);
    }

    // Mirrors the device's reported state onto both door-state characteristics
    // (and the partial-open switch). Driving TargetDoorState from the DP too —
    // not just CurrentDoorState — is what keeps HomeKit honest when the gate is
    // operated outside HomeKit.
    _applyReportedState(isOpen) {
        const {Characteristic} = this.hap;
        const current = isOpen
            ? Characteristic.CurrentDoorState.OPEN
            : Characteristic.CurrentDoorState.CLOSED;
        const target = isOpen
            ? Characteristic.TargetDoorState.OPEN
            : Characteristic.TargetDoorState.CLOSED;

        if (this.currentDoorState !== current) {
            this.currentDoorState = current;
            this.characteristicCurrentDoorState.updateValue(current);
        }
        if (this.accessory.context.cachedTargetDoorState !== target) {
            this.accessory.context.cachedTargetDoorState = target;
            if (this.characteristicTargetDoorState) this.characteristicTargetDoorState.updateValue(target);
        }
        if (this.characteristicPartialOpen) {
            this.characteristicPartialOpen.updateValue(isOpen);
        }
    }

    setTargetDoorState(value) {
        // A direct open/close (the GarageDoorOpener target, a Force switch, or
        // the partial switch tapped OFF) is manual control: cancel any pending
        // partial-open auto-stop so it can't halt this movement part-way.
        this._cancelPartialStop();
        this._applyTarget(value);
    }

    // Optimistically reflects the requested target in HomeKit and fires the
    // matching action on the device. CurrentDoorState is intentionally left to
    // catch up from the status DP. The device echoes the action DP back to
    // false on its own; we don't wait for it.
    _applyTarget(value) {
        const {Characteristic} = this.hap;
        const open = value === Characteristic.TargetDoorState.OPEN;
        this.accessory.context.cachedTargetDoorState = value;
        if (this.characteristicTargetDoorState) this.characteristicTargetDoorState.updateValue(value);
        if (open) this._sendOpen();
        else this._sendClose();
    }

    // Open is always safe to fire directly — the controller reverses on its
    // own, even mid-close. Abandon any pending stop-before-close.
    _sendOpen() {
        this._cancelPendingClose();
        this.log.info(`[SimpleGarageDoor] ${this.device.context.name}: open (dp${this.dpOpen})`);
        this.setMultiStateLegacyAsync({[this.dpOpen]: true});
    }

    // Close is ignored while the gate is actively moving, so fire it directly
    // only when the status DP shows the gate is already stopped (11). Otherwise
    // stop first, wait stopBeforeCloseMs, then close.
    _sendClose() {
        const name = this.device.context.name;
        if (this.pendingCloseTimer) {
            // A stop-before-close is already running — don't restart it (and
            // push the close out) on a duplicate or retransmitted request.
            this.log.info(`[SimpleGarageDoor] ${name}: close ignored — a stop-before-close is already running`);
            return;
        }
        if (this._isStopped()) {
            this.log.info(`[SimpleGarageDoor] ${name}: close (dp${this.dpClose}) — gate already stopped`);
            this.setMultiStateLegacyAsync({[this.dpClose]: true});
            return;
        }
        this.log.info(`[SimpleGarageDoor] ${name}: stop-before-close — stop (dp${this.dpStop}) now, close (dp${this.dpClose}) in ${this.stopBeforeCloseMs}ms`);
        this.setMultiStateLegacyAsync({[this.dpStop]: true});
        this.pendingCloseTimer = setTimeout(() => {
            this.pendingCloseTimer = null;
            this.log.info(`[SimpleGarageDoor] ${name}: stop-before-close — firing close (dp${this.dpClose})`);
            this.setMultiStateLegacyAsync({[this.dpClose]: true});
        }, this.stopBeforeCloseMs);
    }

    // True only when the controller reports the gate is stopped (11) — the one
    // state where it will accept a close without a stop first.
    _isStopped() {
        const raw = this.device.state ? this.device.state[this.dpState] : undefined;
        const value = typeof raw === 'string' ? parseInt(raw, 10) : raw;
        return value === STATE_STOPPED;
    }

    _cancelPendingClose() {
        if (this.pendingCloseTimer) {
            clearTimeout(this.pendingCloseTimer);
            this.pendingCloseTimer = null;
        }
    }

    // Partial open: fire the open action, then after partialOpenMs fire a stop
    // so the gate ends up parked part-way. Anchored to the button press (the
    // controller starts moving and reports state within ~1s), which is all the
    // user asked for.
    _handlePartialOpen() {
        const {Characteristic} = this.hap;
        const name = this.device.context.name;
        if (!this.partialOpenMs) return;
        if (this.partialStopTimer) {
            // Re-entrant press while a partial is already armed (e.g. a
            // HomeKit/iOS WRITE retransmit) — ignore so the stop isn't pushed
            // out, which would let the gate run further than intended.
            this.log.info(`[SimpleGarageDoor] ${name}: partial press ignored — a partial open is already running`);
            return;
        }

        this.log.info(`[SimpleGarageDoor] ${name}: partial open — opening, will stop in ${this.partialOpenMs}ms`);
        this._applyTarget(Characteristic.TargetDoorState.OPEN);
        this.partialStopTimer = setTimeout(() => {
            this.partialStopTimer = null;
            this.log.info(`[SimpleGarageDoor] ${name}: partial open — firing stop (dp${this.dpStop})`);
            this.setMultiStateLegacyAsync({[this.dpStop]: true});
        }, this.partialOpenMs);
    }

    _cancelPartialStop() {
        if (this.partialStopTimer) {
            clearTimeout(this.partialStopTimer);
            this.partialStopTimer = null;
        }
    }
}

module.exports = SimpleGarageDoorAccessory;
