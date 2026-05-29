const BaseAccessory = require('./BaseAccessory');

// Delay after the device echoes the stop DP back to false (signalling the
// stop has finished) before sending the open/close command. Some controllers
// drop the direction command when it arrives too soon after the stop, even
// after the stop DP itself has been reset.
const POST_RESET_DELAY_MS = 500;

// Fallback if the device never echoes the stop DP back to false (e.g. when
// the stop was a no-op because the gate was already idle, or the echo is
// dropped). Picked to comfortably exceed the ~1s reset we observe in
// practice.
const STOP_RESET_TIMEOUT_MS = 3000;

// Fallback for the direction DP echo when the device misses one.
const DIRECTION_RESET_TIMEOUT_MS = 3000;

// Debounce window for incoming HomeKit toggles. setTargetDoorState waits
// this long after the most recent press before starting (or rescheduling) a
// stop+direction cycle, so a rapid burst of taps coalesces into one cycle
// on the final target instead of driving the gate back and forth.
const SETTLE_MS = 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

    _registerCharacteristics() {
        this._reconcileOptionalServices();

        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.GarageDoorOpener);
        this._checkServiceName(service, this.device.context.name);

        this.dpOpen = this._getCustomDP(this.device.context.dpOpen) || '1';
        this.dpStop = this._getCustomDP(this.device.context.dpStop) || '2';
        this.dpClose = this._getCustomDP(this.device.context.dpClose) || '3';

        const partialOpenMs = parseInt(this.device.context.partialOpenMs, 10);
        this.partialOpenMs = Number.isFinite(partialOpenMs) && partialOpenMs > 0 ? partialOpenMs : 0;

        // The device exposes no status DPs, so the only "memory" of where the
        // gate is comes from the last HomeKit-triggered change, persisted via
        // the homebridge accessory context.
        if (this.accessory.context.cachedTargetDoorState !== Characteristic.TargetDoorState.OPEN &&
            this.accessory.context.cachedTargetDoorState !== Characteristic.TargetDoorState.CLOSED) {
            this.accessory.context.cachedTargetDoorState = Characteristic.TargetDoorState.OPEN;
        }
        const initialTarget = this.accessory.context.cachedTargetDoorState;
        this.currentDoorState = initialTarget === Characteristic.TargetDoorState.OPEN
            ? Characteristic.CurrentDoorState.OPEN
            : Characteristic.CurrentDoorState.CLOSED;
        this.desiredTarget = initialTarget;
        this.worker = null;
        this.scheduleTimer = null;
        this.partialStopTimer = null;
        this.partialOpenId = 0;
        this._partialPending = false;
        this._currentChangePending = null;
        this._currentChangeResolve = null;

        this.characteristicTargetDoorState = service.getCharacteristic(Characteristic.TargetDoorState)
            .updateValue(initialTarget)
            .onGet(() => this.accessory.context.cachedTargetDoorState)
            .onSet(value => this.setTargetDoorState(value));

        this.characteristicCurrentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(this.currentDoorState)
            .onGet(() => this.currentDoorState);

        service.getCharacteristic(Characteristic.ObstructionDetected)
            .updateValue(false)
            .onGet(() => false);

        const partialSwitch = this.accessory.getServiceById(Service.Switch, 'partialOpen');
        if (partialSwitch) {
            const initialOn = this.currentDoorState === Characteristic.CurrentDoorState.OPEN;
            const onChar = partialSwitch.getCharacteristic(Characteristic.On)
                .updateValue(initialOn)
                .onGet(() => this.currentDoorState === Characteristic.CurrentDoorState.OPEN)
                .onSet(value => {
                    // Stateful: switch ON triggers a partial-open cycle,
                    // switch OFF triggers a full close (queue stop+close).
                    // The switch value itself mirrors CurrentDoorState (see
                    // _setCurrentDoorState) so it sits at ON whenever the
                    // gate is currently open in HomeKit's view.
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

        // CurrentDoorState follows the device's own pacing — it flips to OPEN
        // when the open DP transitions back to false, and to CLOSED when the
        // close DP transitions back to false. That reset echo is the closest
        // thing to position feedback we have.
        this.device.on('change', changes => this._onDeviceChange(changes));
    }

    _onDeviceChange(changes) {
        const {Characteristic} = this.hap;
        if (!changes) return;
        if (changes[this.dpOpen] === false) {
            this._setCurrentDoorState(Characteristic.CurrentDoorState.OPEN);
        } else if (changes[this.dpClose] === false) {
            this._setCurrentDoorState(Characteristic.CurrentDoorState.CLOSED);
        }
    }

    _setCurrentDoorState(state) {
        if (this.currentDoorState === state) return;
        this.currentDoorState = state;
        this.characteristicCurrentDoorState.updateValue(state);
        if (this.characteristicPartialOpen) {
            this.characteristicPartialOpen.updateValue(
                state === this.hap.Characteristic.CurrentDoorState.OPEN
            );
        }
        this._wakeCurrentChangeWaiters();
    }

    _waitForCurrentChange() {
        if (!this._currentChangePending) {
            this._currentChangePending = new Promise(resolve => {
                this._currentChangeResolve = resolve;
            });
        }
        return this._currentChangePending;
    }

    _wakeCurrentChangeWaiters() {
        if (this._currentChangeResolve) {
            const resolve = this._currentChangeResolve;
            this._currentChangeResolve = null;
            this._currentChangePending = null;
            resolve();
        }
    }

    setTargetDoorState(value) {
        const name = this.device.context.name;
        // If a partial-open flow is in progress (waiting for OPEN or armed
        // with a pending stop) and the incoming value matches the target
        // the partial already set, treat this as a HomeKit/iOS resync (the
        // accessory's TargetDoorState characteristic wasn't notified of
        // the partial-induced target change, so iOS may write the value
        // back to "confirm" the state it observed via CurrentDoorState).
        // A no-op resync must not cancel the partial's auto-stop —
        // otherwise the gate runs all the way open.
        if ((this._partialPending || this.partialStopTimer)
            && value === this.desiredTarget) {
            this.log.info(`[SimpleGarageDoor] ${name}: setTargetDoorState(${value}) ignored as same-value resync during partial`);
            return;
        }
        this.log.info(`[SimpleGarageDoor] ${name}: setTargetDoorState(${value}); was desiredTarget=${this.desiredTarget}, partialStopTimer=${this.partialStopTimer ? 'armed' : 'null'}, _partialPending=${this._partialPending}`);
        // Public path: a direct user toggle cancels any pending partial-stop
        // timer and supersedes any in-flight partial-open wait — once the
        // user takes manual control, the auto-stop shouldn't fire later, and
        // the partial flow's open-wait should bail out rather than hanging
        // forever in case currentDoorState never reaches OPEN.
        if (this.partialStopTimer) {
            clearTimeout(this.partialStopTimer);
            this.partialStopTimer = null;
        }
        this._partialPending = false;
        this.partialOpenId++;
        this._wakeCurrentChangeWaiters();
        this._setTarget(value);
    }

    _setTarget(value) {
        this.accessory.context.cachedTargetDoorState = value;
        this.desiredTarget = value;
        // Mirror the target through the characteristic so HomeKit's view of
        // TargetDoorState stays in sync with what we actually want — without
        // this, HAP's internal value stays at whatever was last written by a
        // client (e.g. CLOSED) and a hub may push a resync write trying to
        // reconcile it with the new CurrentDoorState we just emitted.
        if (this.characteristicTargetDoorState) {
            this.characteristicTargetDoorState.updateValue(value);
        }
        // If a worker is already running it will pick up the new target at
        // its next decision point — no need to debounce again. Otherwise
        // (re)start the debounce so a burst of taps coalesces into one
        // cycle on the final target.
        if (this.worker) return;
        this._scheduleWorker();
    }

    // Drives the partial-open flow: STOP+OPEN through the normal queue, wait
    // until CurrentDoorState reaches OPEN (so the timer is anchored to the
    // device actually receiving the open rather than to the button press —
    // otherwise a short partialOpenMs would land mid-cycle and a stop fired
    // then could land before the open even reaches the device), then after
    // partialOpenMs send a raw STOP to halt the gate mid-opening so it ends
    // up partially open.
    //
    // Idempotent against re-invocation while a flow is already in progress
    // (waiting for OPEN or armed with a pending stop): HomeKit/iOS will
    // retransmit a WRITE if the 204 response is delayed or dropped, and
    // each retry firing through onSet would otherwise cancel the original
    // stop timer and push it out by another partialOpenMs — eventually
    // letting the gate run all the way open. A direct toggle on the main
    // GarageDoorOpener target or a Force switch still supersedes this flow
    // through setTargetDoorState.
    async _handlePartialOpen() {
        const {Characteristic} = this.hap;
        const name = this.device.context.name;
        if (!this.partialOpenMs) return;
        if (this._partialPending || this.partialStopTimer) {
            this.log.info(`[SimpleGarageDoor] ${name}: partial press ignored — flow already in progress (_partialPending=${this._partialPending}, partialStopTimer=${this.partialStopTimer ? 'armed' : 'null'})`);
            return;
        }

        this._partialPending = true;
        const myId = ++this.partialOpenId;
        this.log.info(`[SimpleGarageDoor] ${name}: partial press accepted (myId=${myId}); driving target to OPEN`);

        this._setTarget(Characteristic.TargetDoorState.OPEN);

        try {
            while (this.currentDoorState !== Characteristic.CurrentDoorState.OPEN) {
                await this._waitForCurrentChange();
                // A direct toggle (which clears _partialPending) supersedes
                // this flow.
                if (myId !== this.partialOpenId) {
                    this.log.info(`[SimpleGarageDoor] ${name}: partial flow superseded mid-wait (myId=${myId} vs ${this.partialOpenId})`);
                    return;
                }
            }
        } finally {
            this._partialPending = false;
        }

        this.log.info(`[SimpleGarageDoor] ${name}: CurrentDoorState reached OPEN; arming partial-stop in ${this.partialOpenMs}ms`);
        this.partialStopTimer = setTimeout(() => {
            this.partialStopTimer = null;
            if (myId !== this.partialOpenId) {
                this.log.info(`[SimpleGarageDoor] ${name}: partial-stop timer fired but flow superseded (myId=${myId} vs ${this.partialOpenId})`);
                return;
            }
            // Send the raw stop several times spread over ~1s. The device's
            // command queue can drop back-to-back writes, and brief WiFi
            // dropouts silently lose individual writes — re-sending a few
            // times defends against both. A stop on an already-stopped gate
            // is a no-op on the device side.
            this.log.info(`[SimpleGarageDoor] ${name}: firing partial-stop (dp${this.dpStop}=true) with retries`);
            const send = (attempt) => {
                if (myId !== this.partialOpenId) return;
                this.log.info(`[SimpleGarageDoor] ${name}: partial-stop attempt ${attempt} (device.connected=${this.device.connected})`);
                this.setMultiStateLegacyAsync({[this.dpStop]: true});
            };
            send(1);
            setTimeout(() => send(2), 250);
            setTimeout(() => send(3), 600);
            setTimeout(() => send(4), 1200);
        }, this.partialOpenMs);
    }

    _scheduleWorker() {
        if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
        this.scheduleTimer = setTimeout(() => {
            this.scheduleTimer = null;
            this._spawnWorker();
        }, SETTLE_MS);
    }

    _spawnWorker() {
        if (this.worker) return;
        if (this._currentMatchesTarget(this.desiredTarget)) return;
        this.worker = this._runWorker().finally(() => {
            this.worker = null;
            // If the target shifted while the cycle was running and still
            // differs from where we landed, debounce again before the next
            // cycle so another spam burst coalesces.
            if (!this._currentMatchesTarget(this.desiredTarget)) {
                this._scheduleWorker();
            }
        });
    }

    // One stop + direction cycle. The worker re-reads this.desiredTarget at
    // each decision point so a toggle that lands during the cycle is honoured;
    // if the target has reverted to the current state, the direction is
    // skipped and the worker exits.
    async _runWorker() {
        const {Characteristic} = this.hap;
        if (this._currentMatchesTarget(this.desiredTarget)) return;

        await this._sendAndAwaitReset(this.dpStop, STOP_RESET_TIMEOUT_MS);
        await sleep(POST_RESET_DELAY_MS);

        if (this._currentMatchesTarget(this.desiredTarget)) return;

        const target = this.desiredTarget;
        const directionDp = target === Characteristic.TargetDoorState.OPEN
            ? this.dpOpen
            : this.dpClose;
        await this._sendAndAwaitReset(directionDp, DIRECTION_RESET_TIMEOUT_MS);
        // Belt-and-braces: the persistent change listener will already have
        // flipped this on the echo, but force-mirror in case the echo was
        // missed so the next loop check exits cleanly.
        this._setCurrentDoorState(target === Characteristic.TargetDoorState.OPEN
            ? Characteristic.CurrentDoorState.OPEN
            : Characteristic.CurrentDoorState.CLOSED);
    }

    _currentMatchesTarget(target) {
        const {Characteristic} = this.hap;
        if (target === Characteristic.TargetDoorState.OPEN) {
            return this.currentDoorState === Characteristic.CurrentDoorState.OPEN;
        }
        return this.currentDoorState === Characteristic.CurrentDoorState.CLOSED;
    }

    // Writes the DP and resolves when the device echoes it back to false
    // (signalling the action completed) or the timeout fires.
    async _sendAndAwaitReset(dp, timeoutMs) {
        const wait = this._waitForDpReset(dp, timeoutMs);
        this.setMultiStateLegacyAsync({[dp]: true});
        await wait;
    }

    _waitForDpReset(dp, timeoutMs) {
        return new Promise(resolve => {
            const cleanup = () => {
                this.device.removeListener('change', onChange);
                clearTimeout(timer);
            };
            const onChange = changes => {
                if (changes && changes[dp] === false) {
                    cleanup();
                    resolve();
                }
            };
            const timer = setTimeout(() => {
                cleanup();
                resolve();
            }, timeoutMs);
            this.device.on('change', onChange);
        });
    }
}

module.exports = SimpleGarageDoorAccessory;
