const BaseAccessory = require('./BaseAccessory');

class PercentBlindsAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.WINDOW_COVERING;
    }

    constructor(...props) {
        super(...props);
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

        this.dpPercentControl = this._getCustomDP(this.device.context.dpPercentControl) || '2';
        this.dpPercentState = this._getCustomDP(this.device.context.dpPercentState) || '2';
        this.flipState = !!this.device.context.flipState;

        // Optional work-state data point. Many Tuya curtain motors report their
        // live travel direction on a separate DP (Tuya code 'work_state' or
        // 'control', typically DP 7) with string values like 'opening'/'closing'.
        // When it is configured, PositionState follows the real direction of
        // travel and resets to STOPPED once movement finishes; without it the
        // behaviour is unchanged and PositionState stays STOPPED.
        this.dpWorkState = this.device.context.dpWorkState ? this._getCustomDP(this.device.context.dpWorkState) : undefined;
        const toList = (value, fallback) => (value === undefined ? fallback : [].concat(value)).map(v => ('' + v).toLowerCase());
        this._openingValues = toList(this.device.context.opening, ['opening', 'open', 'up']);
        this._closingValues = toList(this.device.context.closing, ['closing', 'close', 'down']);

        const PositionState = Characteristic.PositionState;
        this._positionState = PositionState.STOPPED;

        const characteristicCurrentPosition = service.getCharacteristic(Characteristic.CurrentPosition)
            .updateValue(this._mapPosition(dps[this.dpPercentState] !== undefined ? dps[this.dpPercentState] : 0))
            .on('get', this.getCurrentPosition.bind(this));

        const characteristicTargetPosition = service.getCharacteristic(Characteristic.TargetPosition)
            .updateValue(this._mapPosition(dps[this.dpPercentControl] !== undefined ? dps[this.dpPercentControl] : 0))
            .on('get', this.getTargetPosition.bind(this))
            .on('set', this.setTargetPosition.bind(this));

        const characteristicPositionState = service.getCharacteristic(Characteristic.PositionState)
            .updateValue(this._positionState)
            .on('get', callback => callback(null, this._positionState));

        this.device.on('change', changes => {
            if (this.dpWorkState !== undefined && changes.hasOwnProperty(this.dpWorkState)) {
                const state = this._workStateToPositionState(changes[this.dpWorkState]);
                if (state !== undefined) {
                    this._positionState = state;
                    this.log.debug(`[TuyaAccessory] Blind position state updated to ${state}`);
                    characteristicPositionState.updateValue(state);
                }
            }

            if (changes.hasOwnProperty(this.dpPercentState)) {
                const position = this._mapPosition(changes[this.dpPercentState]);
                this.log.debug(`[TuyaAccessory] Blind current position updated to ${position}`);
                characteristicCurrentPosition.updateValue(position);

                // Motors that only report their position once travel ends use this
                // report as the "movement finished" signal: settle the state and
                // align the target so HomeKit stops showing an in-progress move.
                if (this.dpWorkState !== undefined) {
                    this._positionState = PositionState.STOPPED;
                    characteristicPositionState.updateValue(PositionState.STOPPED);
                    characteristicTargetPosition.updateValue(position);
                }
            }

            if (changes.hasOwnProperty(this.dpPercentControl)) {
                const position = this._mapPosition(changes[this.dpPercentControl]);
                this.log.debug(`[TuyaAccessory] Blind target position updated to ${position}`);
                characteristicTargetPosition.updateValue(position);
            }
        });
    }

    _workStateToPositionState(value) {
        const {PositionState} = this.hap.Characteristic;
        const raw = ('' + value).toLowerCase();
        let state;
        if (this._openingValues.includes(raw)) state = PositionState.INCREASING;
        else if (this._closingValues.includes(raw)) state = PositionState.DECREASING;
        else return PositionState.STOPPED;
        // A flipped device travels toward the opposite HomeKit position, so the
        // increasing/decreasing sense is inverted too.
        if (this.flipState) state = state === PositionState.INCREASING ? PositionState.DECREASING : PositionState.INCREASING;
        return state;
    }

    _mapPosition(value) {
        const position = parseInt(value) || 0;
        return this.flipState ? 100 - position : position;
    }

    getCurrentPosition(callback) {
        this.getState(this.dpPercentState, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._mapPosition(dp));
        });
    }

    getTargetPosition(callback) {
        this.getState(this.dpPercentControl, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._mapPosition(dp));
        });
    }

    setTargetPosition(value, callback) {
        const position = this._mapPosition(value);
        this.log.debug(`[TuyaAccessory] Setting blind position to ${position}`);
        this.setState(this.dpPercentControl, position, callback);
    }
}

module.exports = PercentBlindsAccessory;
