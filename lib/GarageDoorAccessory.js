const BaseAccessory = require('./BaseAccessory');

// Action
const GARAGE_DOOR_OPEN = 'open';
const GARAGE_DOOR_CLOSE = 'close';

// Status or state
// yes, 'openning' is not a mistake, that's the text from the Kogan opener
const GARAGE_DOOR_OPENED = 'opened';
const GARAGE_DOOR_CLOSED = 'closed';
const GARAGE_DOOR_OPENNING = 'openning';
const GARAGE_DOOR_OPENING = 'opening';
const GARAGE_DOOR_CLOSING = 'closing';

const GARAGE_DOOR_MANUFACTURER_KOGAN = 'Kogan';
const GARAGE_DOOR_MANUFACTURER_WOFEA = 'Wofea';

class GarageDoorAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.GARAGE_DOOR_OPENER;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.GarageDoorOpener, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _logPrefix() {
        return (this.manufacturer ? this.manufacturer + ' ' : '') + 'GarageDoor';
    }

    _alwaysLog(...args) { this.log.info(this._logPrefix(), ...args); }

    _debugLog(...args) {
        this.log.debug(this._logPrefix(), ...args);
    }

    _isKogan() {
        return this.manufacturer === GARAGE_DOOR_MANUFACTURER_KOGAN.trim();
    }

    _isWofea() {
        return this.manufacturer === GARAGE_DOOR_MANUFACTURER_WOFEA.trim();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.GarageDoorOpener);
        this._checkServiceName(service, this.device.context.name);

        if (this.device.context.manufacturer.trim().toLowerCase() === GARAGE_DOOR_MANUFACTURER_KOGAN.trim().toLowerCase()) {
            this.manufacturer = GARAGE_DOOR_MANUFACTURER_KOGAN.trim();
        } else if (this.device.context.manufacturer.trim().toLowerCase() === GARAGE_DOOR_MANUFACTURER_WOFEA.trim().toLowerCase()) {
            this.manufacturer = this.device.context.manufacturer.trim();
        } else if (this.device.context.manufacturer) {
            this.manufacturer = this.device.context.manufacturer.trim();
        } else {
            this.manufacturer = '';
        }

        if (this._isKogan()) {
            this._debugLog('_registerCharacteristics setting dpAction and dpStatus for ' + GARAGE_DOOR_MANUFACTURER_KOGAN + ' garage door');
            this.dpAction = this._getCustomDP(this.device.context.dpAction) || '101';
            this.dpStatus = this._getCustomDP(this.device.context.dpStatus) || '102';
        } else if (this._isWofea()) {
            this._debugLog('_registerCharacteristics setting dpAction and dpStatus for ' + GARAGE_DOOR_MANUFACTURER_WOFEA + ' garage door');
            this.dpAction = this._getCustomDP(this.device.context.dpAction) || '1';
            this.dpStatus = this._getCustomDP(this.device.context.dpStatus) || '101';
        } else {
            this._debugLog('_registerCharacteristics setting dpAction and dpStatus for generic door');
            this.dpAction = this._getCustomDP(this.device.context.dpAction) || '1';
            this.dpStatus = this._getCustomDP(this.device.context.dpStatus) || '2';
        }

        this.currentOpen = Characteristic.CurrentDoorState.OPEN;
        this.currentOpening = Characteristic.CurrentDoorState.OPENING;
        this.currentClosing = Characteristic.CurrentDoorState.CLOSING;
        this.currentClosed = Characteristic.CurrentDoorState.CLOSED;
        this.currentStopped = Characteristic.CurrentDoorState.STOPPED;
        this.targetOpen = Characteristic.TargetDoorState.OPEN;
        this.targetClosed = Characteristic.TargetDoorState.CLOSED;
        if (this.device.context.flipState) {
            this.currentOpen = Characteristic.CurrentDoorState.CLOSED;
            this.currentOpening = Characteristic.CurrentDoorState.CLOSING;
            this.currentClosing = Characteristic.CurrentDoorState.OPENING;
            this.currentClosed = Characteristic.CurrentDoorState.OPEN;
            this.targetOpen = Characteristic.TargetDoorState.CLOSED;
            this.targetClosed = Characteristic.TargetDoorState.OPEN;
        }

        const characteristicTargetDoorState = service.getCharacteristic(Characteristic.TargetDoorState)
            .updateValue(this._getTargetDoorState(dps[this.dpStatus]))
            .onGet(() => this.getTargetDoorState())
            .onSet(value => this.setTargetDoorState(value));

        const characteristicCurrentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(this._getCurrentDoorState(dps[this.dpStatus]))
            .onGet(() => this.getCurrentDoorState());

        this.device.on('change', changes => {
            this._alwaysLog('changed:' + JSON.stringify(changes));

            if (changes.hasOwnProperty(this.dpStatus)) {
                const newCurrentDoorState = this._getCurrentDoorState(changes[this.dpStatus]);
                this._debugLog('on change new and old CurrentDoorState ' + newCurrentDoorState + ' ' + characteristicCurrentDoorState.value);
                this._debugLog('on change old characteristicTargetDoorState ' + characteristicTargetDoorState.value);

                if (newCurrentDoorState == this.currentOpen && characteristicTargetDoorState.value !== this.targetOpen)
                    characteristicTargetDoorState.updateValue(this.targetOpen);

                if (newCurrentDoorState == this.currentClosed && characteristicTargetDoorState.value !== this.targetClosed)
                    characteristicTargetDoorState.updateValue(this.targetClosed);

                if (characteristicCurrentDoorState.value !== newCurrentDoorState) characteristicCurrentDoorState.updateValue(newCurrentDoorState);
            }
        });
    }

    getTargetDoorState() {
        const dp = this.getStateAsync(this.dpStatus);
        this._debugLog('getTargetDoorState dp ' + JSON.stringify(dp));
        return this._getTargetDoorState(dp);
    }

    _getTargetDoorState(dp) {
        this._debugLog('_getTargetDoorState dp ' + JSON.stringify(dp));

        if (this._isKogan()) {
            switch (dp) {
                case GARAGE_DOOR_OPENED:
                case GARAGE_DOOR_OPENNING:
                case GARAGE_DOOR_OPENING:
                    return this.targetOpen;

                case GARAGE_DOOR_CLOSED:
                case GARAGE_DOOR_CLOSING:
                    return this.targetClosed;

                default:
                    this._alwaysLog('_getTargetDoorState UNKNOWN STATE ' + JSON.stringify(dp));
            }
        } else {
            if (dp === true) {
                return this.targetOpen;
            } else if (dp === false) {
                return this.targetClosed;
            } else {
                this._alwaysLog('_getTargetDoorState UNKNOWN STATE ' + JSON.stringify(dp));
            }
        }
    }

    setTargetDoorState(value) {
        this._debugLog('setTargetDoorState value ' + value + ' targetOpen ' + this.targetOpen + ' targetClosed ' + this.targetClosed);
        let newValue = GARAGE_DOOR_CLOSE;

        if (this._isKogan()) {
            switch (value) {
                case this.targetOpen:
                    newValue = GARAGE_DOOR_OPEN;
                    break;
                case this.targetClosed:
                    newValue = GARAGE_DOOR_CLOSE;
                    break;
                default:
                    this._alwaysLog('setTargetDoorState UNKNOWN STATE ' + JSON.stringify(value));
            }
        } else {
            switch (value) {
                case this.targetOpen:
                    newValue = true;
                    break;
                case this.targetClosed:
                    newValue = false;
                    break;
                default:
                    this._alwaysLog('setTargetDoorState UNKNOWN STATE ' + JSON.stringify(value));
            }
        }

        return this.setStateAsync(this.dpAction, newValue);
    }

    getCurrentDoorState() {
        const dpStatusValue = this.getStateAsync(this.dpStatus);
        return this._getCurrentDoorState(dpStatusValue);
    }

    _getCurrentDoorState(dpStatusValue) {
        this._debugLog('_getCurrentDoorState dpStatusValue ' + JSON.stringify(dpStatusValue));

        if (this._isKogan()) {
            switch (dpStatusValue) {
                case GARAGE_DOOR_OPENED:
                    return this.currentOpen;
                case GARAGE_DOOR_OPENNING:
                case GARAGE_DOOR_OPENING:
                    return this.currentOpening;
                case GARAGE_DOOR_CLOSING:
                    return this.currentClosing;
                case GARAGE_DOOR_CLOSED:
                    return this.currentClosed;
                default:
                    this._alwaysLog('_getCurrentDoorState UNKNOWN STATUS ' + JSON.stringify(dpStatusValue));
            }
        } else {
            if (dpStatusValue === true) {
                return this.currentOpen;
            } else if (dpStatusValue === false) {
                return this.currentClosed;
            } else {
                this._alwaysLog('_getCurrentDoorState UNKNOWN STATUS ' + JSON.stringify(dpStatusValue));
            }
        }
    }
}

module.exports = GarageDoorAccessory;
