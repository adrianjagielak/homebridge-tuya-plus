const BaseAccessory = require('./BaseAccessory');

class VerticalBlindsWithTilt extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.WINDOW_COVERING;
    }

    constructor(...props) {
        super(...props);
        this.lastCloseTime = 0;
        this.lastOpenTime = 0;
        this.lastTiltCommand = null;
        this.tiltBufferTimeout = null;
        this.tiltDelayTimeout = null;
        this.positionStateTimeout = null;
        this.isMoving = false;
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.WindowCovering, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.WindowCovering);
        this._checkServiceName(service, this.device.context.name);

        this.dpAction = this._getCustomDP(this.device.context.dpAction) || '1';
        this.dpTilt = this._getCustomDP(this.device.context.dpTilt) || '2';
        this.dpTiltState = this._getCustomDP(this.device.context.dpTiltState) || '3';
        this.timeToClose = this.device.context.timeToClose || 30;

        this.currentPosition = this._getInitialPosition(dps);

        const characteristicCurrentPosition = service.getCharacteristic(Characteristic.CurrentPosition)
            .updateValue(this.currentPosition)
            .onGet(() => this.currentPosition);

        const characteristicTargetPosition = service.getCharacteristic(Characteristic.TargetPosition)
            .updateValue(this.currentPosition)
            .onGet(() => this.currentPosition)
            .onSet(value => this.setPosition(value));

        const characteristicPositionState = service.getCharacteristic(Characteristic.PositionState)
            .updateValue(Characteristic.PositionState.STOPPED)
            .onGet(() => Characteristic.PositionState.STOPPED);

        const characteristicCurrentHorizontalTilt = service.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
            .updateValue(this._getTiltAngle(dps[this.dpTiltState] || dps[this.dpTilt]))
            .onGet(() => this._getTiltAngle(this.getStateAsync([this.dpTiltState])[this.dpTiltState]));

        const characteristicTargetHorizontalTilt = service.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
            .updateValue(this._getTiltAngle(dps[this.dpTiltState] || dps[this.dpTilt]))
            .onGet(() => this._getTiltAngle(this.getStateAsync([this.dpTiltState])[this.dpTiltState]))
            .onSet(value => this.setTiltAngle(value));

        this.characteristicCurrentPosition = characteristicCurrentPosition;
        this.characteristicTargetPosition = characteristicTargetPosition;
        this.characteristicPositionState = characteristicPositionState;
        this.characteristicCurrentHorizontalTilt = characteristicCurrentHorizontalTilt;
        this.characteristicTargetHorizontalTilt = characteristicTargetHorizontalTilt;
    }

    _getInitialPosition(dps) {
        if (this.accessory.context.cachedPosition !== undefined) {
            this.log('[TuyaAccessory] Restored position from cache:', this.accessory.context.cachedPosition + '%');
            return this.accessory.context.cachedPosition;
        }
        this.log('[TuyaAccessory] Initial position unknown (first time setup), defaulting to open (100%)');
        return 100;
    }

    setPosition(value) {
        const {Characteristic} = this.hap;

        if (value === 0) {
            if (this.currentPosition === 0) {
                this.log('[TuyaAccessory] Blinds already closed, skipping close command');
                return;
            }

            this.log('[TuyaAccessory] Closing blinds');
            this.lastCloseTime = Date.now();
            this.isMoving = true;

            if (this.lastTiltCommand && (Date.now() - this.lastTiltCommand.time < this.timeToClose * 1000)) {
                this.log('[TuyaAccessory] Close command received while tilt was pending - rescheduling tilt delay');
                if (this.tiltBufferTimeout) { clearTimeout(this.tiltBufferTimeout); this.tiltBufferTimeout = null; }
                if (this.tiltDelayTimeout) clearTimeout(this.tiltDelayTimeout);
                const delayMs = this.timeToClose * 1000;
                this.tiltDelayTimeout = setTimeout(() => {
                    this.log('[TuyaAccessory] Executing delayed tilt angle:', this.lastTiltCommand.angle, '-> Tuya percent_control:', this.lastTiltCommand.value);
                    this._executeTilt(this.lastTiltCommand.value);
                    this.tiltDelayTimeout = null;
                    this.lastTiltCommand = null;
                }, delayMs);
            }

            this.characteristicTargetPosition.updateValue(0);
            this.characteristicPositionState.updateValue(Characteristic.PositionState.DECREASING);

            if (this.positionStateTimeout) clearTimeout(this.positionStateTimeout);
            this.positionStateTimeout = setTimeout(() => {
                this.log('[TuyaAccessory] Blinds finished closing');
                this.currentPosition = 0;
                this.accessory.context.cachedPosition = 0;
                this.characteristicCurrentPosition.updateValue(0);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
                this.isMoving = false;
                this.lastCloseTime = 0;
                this.positionStateTimeout = null;
            }, this.timeToClose * 1000);

            return this.setStateAsync(this.dpAction, 'close');

        } else if (value === 100) {
            if (this.currentPosition === 100) {
                this.log('[TuyaAccessory] Blinds already open, skipping open command');
                return;
            }

            this.log('[TuyaAccessory] Opening blinds');

            if (this.lastTiltCommand && (Date.now() - this.lastTiltCommand.time < this.timeToClose * 1000)) {
                this.log('[TuyaAccessory] Open command received while tilt was pending - rescheduling tilt delay');
                if (this.tiltBufferTimeout) { clearTimeout(this.tiltBufferTimeout); this.tiltBufferTimeout = null; }
                if (this.tiltDelayTimeout) clearTimeout(this.tiltDelayTimeout);
                const delayMs = this.timeToClose * 1000;
                this.tiltDelayTimeout = setTimeout(() => {
                    this.log('[TuyaAccessory] Executing delayed tilt angle:', this.lastTiltCommand.angle, '-> Tuya percent_control:', this.lastTiltCommand.value);
                    this._executeTilt(this.lastTiltCommand.value);
                    this.tiltDelayTimeout = null;
                    this.lastTiltCommand = null;
                }, delayMs);
            } else {
                this._cancelPendingTilts();
                this.lastTiltCommand = null;
            }

            this.lastCloseTime = 0;
            this.lastOpenTime = Date.now();
            this.characteristicTargetPosition.updateValue(100);
            this.characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);

            if (this.positionStateTimeout) clearTimeout(this.positionStateTimeout);
            this.positionStateTimeout = setTimeout(() => {
                this.log('[TuyaAccessory] Blinds finished opening');
                this.currentPosition = 100;
                this.accessory.context.cachedPosition = 100;
                this.characteristicCurrentPosition.updateValue(100);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
                this.lastOpenTime = 0;
                this.positionStateTimeout = null;
            }, this.timeToClose * 1000);

            return this.setStateAsync(this.dpAction, 'open');

        } else {
            this.log('[TuyaAccessory] Partial position requested, opening fully');

            if (this.lastTiltCommand && (Date.now() - this.lastTiltCommand.time < this.timeToClose * 1000)) {
                this.log('[TuyaAccessory] Partial open command received while tilt was pending - rescheduling tilt delay');
                if (this.tiltBufferTimeout) { clearTimeout(this.tiltBufferTimeout); this.tiltBufferTimeout = null; }
                if (this.tiltDelayTimeout) clearTimeout(this.tiltDelayTimeout);
                const delayMs = this.timeToClose * 1000;
                this.tiltDelayTimeout = setTimeout(() => {
                    this.log('[TuyaAccessory] Executing delayed tilt angle:', this.lastTiltCommand.angle, '-> Tuya percent_control:', this.lastTiltCommand.value);
                    this._executeTilt(this.lastTiltCommand.value);
                    this.tiltDelayTimeout = null;
                    this.lastTiltCommand = null;
                }, delayMs);
            } else {
                this._cancelPendingTilts();
                this.lastTiltCommand = null;
            }

            this.lastCloseTime = 0;
            this.lastOpenTime = Date.now();
            this.characteristicTargetPosition.updateValue(100);
            this.characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);

            if (this.positionStateTimeout) clearTimeout(this.positionStateTimeout);
            this.positionStateTimeout = setTimeout(() => {
                this.log('[TuyaAccessory] Blinds finished opening');
                this.currentPosition = 100;
                this.accessory.context.cachedPosition = 100;
                this.characteristicCurrentPosition.updateValue(100);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
                this.lastOpenTime = 0;
                this.positionStateTimeout = null;
            }, this.timeToClose * 1000);

            return this.setStateAsync(this.dpAction, 'open');
        }
    }

    _getTiltAngle(value) {
        const tuyaValue = parseInt(value);
        if (isNaN(tuyaValue)) return 0;
        return (tuyaValue - 50) * 1.8;
    }

    setTiltAngle(value) {
        const tuyaValue = Math.round((value / 1.8) + 50);
        const clampedValue = Math.max(0, Math.min(100, tuyaValue));

        this.lastTiltCommand = { angle: value, value: clampedValue, time: Date.now() };

        const timeSinceClose = Date.now() - this.lastCloseTime;
        const timeSinceOpen = Date.now() - this.lastOpenTime;
        const shouldDelayForClose = this.lastCloseTime > 0 && timeSinceClose < (this.timeToClose * 1000);
        const shouldDelayForOpen = this.lastOpenTime > 0 && timeSinceOpen < (this.timeToClose * 1000);
        const shouldDelay = shouldDelayForClose || shouldDelayForOpen;

        if (shouldDelay) {
            const delayMs = shouldDelayForClose
                ? (this.timeToClose * 1000) - timeSinceClose
                : (this.timeToClose * 1000) - timeSinceOpen;
            const action = shouldDelayForClose ? 'close' : 'open';
            this.log('[TuyaAccessory] Tilt command received during', action, '- delaying by', Math.round(delayMs / 1000), 'seconds');

            this._cancelPendingTilts();

            this.tiltDelayTimeout = setTimeout(() => {
                this.log('[TuyaAccessory] Executing delayed tilt angle:', value, '-> Tuya percent_control:', clampedValue);
                this._executeTilt(clampedValue);
                this.tiltDelayTimeout = null;
                this.lastCloseTime = 0;
                this.lastOpenTime = 0;
                this.lastTiltCommand = null;
            }, delayMs);

        } else {
            this.log('[TuyaAccessory] Setting tilt angle:', value, '-> Tuya percent_control:', clampedValue);

            if (this.tiltBufferTimeout) clearTimeout(this.tiltBufferTimeout);

            this.tiltBufferTimeout = setTimeout(() => {
                const currentTimeSinceClose = Date.now() - this.lastCloseTime;
                const currentTimeSinceOpen = Date.now() - this.lastOpenTime;
                const closeInProgress = this.lastCloseTime > 0 && currentTimeSinceClose < (this.timeToClose * 1000);
                const openInProgress = this.lastOpenTime > 0 && currentTimeSinceOpen < (this.timeToClose * 1000);

                if (!closeInProgress && !openInProgress) {
                    this._executeTilt(clampedValue);
                    this.lastTiltCommand = null;
                }
                this.tiltBufferTimeout = null;
            }, 200);
        }
    }

    _executeTilt(value) {
        if (!this.device.connected) {
            this.log('[TuyaAccessory] Cannot execute tilt - device not connected');
            return;
        }
        this.device.update({[this.dpTilt]: value});
    }

    _cancelPendingTilts() {
        if (this.tiltBufferTimeout) {
            clearTimeout(this.tiltBufferTimeout);
            this.tiltBufferTimeout = null;
            this.log('[TuyaAccessory] Cleared pending tilt buffer');
        }
        if (this.tiltDelayTimeout) {
            clearTimeout(this.tiltDelayTimeout);
            this.tiltDelayTimeout = null;
            this.log('[TuyaAccessory] Cleared pending tilt delay');
        }
    }

    updateState(data) {
        const {Characteristic} = this.hap;

        if (data[this.dpTiltState] !== undefined) {
            const tiltAngle = this._getTiltAngle(data[this.dpTiltState]);
            this.log.debug('[TuyaAccessory] Tilt state updated to:', data[this.dpTiltState], '-> angle:', tiltAngle);
            this.characteristicCurrentHorizontalTilt.updateValue(tiltAngle);
            this.characteristicTargetHorizontalTilt.updateValue(tiltAngle);
        }

        if (data[this.dpAction] !== undefined) {
            const action = data[this.dpAction];
            this.log.debug('[TuyaAccessory] Control action:', action);

            if (action === 'open') {
                this.currentPosition = 100;
                this.accessory.context.cachedPosition = 100;
                this.characteristicCurrentPosition.updateValue(100);
                this.characteristicTargetPosition.updateValue(100);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);
            } else if (action === 'close') {
                this.currentPosition = 0;
                this.accessory.context.cachedPosition = 0;
                this.characteristicCurrentPosition.updateValue(0);
                this.characteristicTargetPosition.updateValue(0);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.DECREASING);
            } else if (action === 'stop') {
                this.characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
            }
        }
    }
}

module.exports = VerticalBlindsWithTilt;
