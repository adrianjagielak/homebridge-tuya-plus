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

        const characteristicCurrentPosition = service.getCharacteristic(Characteristic.CurrentPosition)
            .updateValue(this._mapPosition(dps[this.dpPercentState] !== undefined ? dps[this.dpPercentState] : 0))
            .on('get', this.getCurrentPosition.bind(this));

        const characteristicTargetPosition = service.getCharacteristic(Characteristic.TargetPosition)
            .updateValue(this._mapPosition(dps[this.dpPercentControl] !== undefined ? dps[this.dpPercentControl] : 0))
            .on('get', this.getTargetPosition.bind(this))
            .on('set', this.setTargetPosition.bind(this));

        service.getCharacteristic(Characteristic.PositionState)
            .updateValue(Characteristic.PositionState.STOPPED)
            .on('get', callback => callback(null, Characteristic.PositionState.STOPPED));

        this.device.on('change', changes => {
            if (changes.hasOwnProperty(this.dpPercentState)) {
                const position = this._mapPosition(changes[this.dpPercentState]);
                this.log.debug(`[TuyaAccessory] Blind current position updated to ${position}`);
                characteristicCurrentPosition.updateValue(position);
            }
            if (changes.hasOwnProperty(this.dpPercentControl)) {
                const position = this._mapPosition(changes[this.dpPercentControl]);
                this.log.debug(`[TuyaAccessory] Blind target position updated to ${position}`);
                characteristicTargetPosition.updateValue(position);
            }
        });
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
