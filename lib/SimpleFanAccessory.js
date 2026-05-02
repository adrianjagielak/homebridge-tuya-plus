const BaseAccessory = require('./BaseAccessory');

class SimpleFanAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.FAN;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;
        this.accessory.addService(Service.Fan, this.device.context.name);
        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const serviceFan = this.accessory.getService(Service.Fan);
        this._checkServiceName(serviceFan, this.device.context.name);
        this.dpFanOn = this._getCustomDP(this.device.context.dpFanOn) || '1';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '3';
        this.dpFanDirection = this._getCustomDP(this.device.context.dpFanDirection) || '2';

        this.maxSpeed = parseInt(this.device.context.maxSpeed) || 3;
        this.fanDefaultSpeed = parseInt(this.device.context.fanDefaultSpeed) || 1;
        this.fanCurrentSpeed = 0;
        this.useStrings = this._coerceBoolean(this.device.context.useStrings, true);
        this.useMultiState = this._coerceBoolean(this.device.context.useMultiState, true);

        const characteristicFanOn = serviceFan.getCharacteristic(Characteristic.On)
            .updateValue(this._getFanOn(dps[this.dpFanOn]))
            .onGet(() => this.getFanOn())
            .onSet(value => this.setFanOn(value));

        const characteristicRotationSpeed = serviceFan.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: Math.max(100 / this.maxSpeed)
            })
            .updateValue(this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]))
            .onGet(() => this.getSpeed())
            .onSet(value => this.setSpeed(value));

        const characteristicFanDirection = serviceFan.getCharacteristic(Characteristic.RotationDirection)
            .updateValue(this._getFanDirection(dps[this.dpFanDirection]))
            .onGet(() => this.getFanDirection())
            .onSet(value => this.setFanDirection(value));

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpFanOn) && characteristicFanOn.value !== changes[this.dpFanOn])
                characteristicFanOn.updateValue(changes[this.dpFanOn]);

            if (changes.hasOwnProperty(this.dpRotationSpeed) && this.convertRotationSpeedFromHomeKitToTuya(characteristicRotationSpeed.value) !== changes[this.dpRotationSpeed])
                characteristicRotationSpeed.updateValue(this.convertRotationSpeedFromTuyaToHomeKit(changes[this.dpRotationSpeed]));

            if (changes.hasOwnProperty(this.dpFanDirection) && characteristicFanDirection) {
                const dir = this._getFanDirection(changes[this.dpFanDirection]);
                if (characteristicFanDirection.value !== dir) characteristicFanDirection.updateValue(dir);
            }

            this.log.debug('SimpleFan changed: ' + JSON.stringify(state));
        });
    }

    getFanOn() {
        return this._getFanOn(this.getStateAsync(this.dpFanOn));
    }

    _getFanOn(dp) {
        return dp;
    }

    setFanOn(value) {
        if (!this.useMultiState) {
            return this.setStateAsync(this.dpFanOn, value);
        } else if (value == false) {
            this.fanCurrentSpeed = 0;
            return this.setStateAsync(this.dpFanOn, false);
        } else {
            if (this.fanCurrentSpeed === 0) {
                if (this.useStrings) {
                    return this.setMultiStateLegacyAsync({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanDefaultSpeed.toString()});
                } else {
                    return this.setMultiStateLegacyAsync({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanDefaultSpeed});
                }
            } else {
                if (this.useStrings) {
                    return this.setMultiStateLegacyAsync({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanCurrentSpeed.toString()});
                } else {
                    return this.setMultiStateLegacyAsync({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanCurrentSpeed});
                }
            }
        }
    }

    getSpeed() {
        return this.convertRotationSpeedFromTuyaToHomeKit(this.getStateAsync(this.dpRotationSpeed));
    }

    setSpeed(value) {
        if (!this.useMultiState) {
            return this.setStateAsync(this.dpRotationSpeed, this.convertRotationSpeedFromHomeKitToTuya(value));
        } else if (value === 0) {
            if (this.useStrings) {
                return this.setMultiStateLegacyAsync({[this.dpFanOn]: false, [this.dpRotationSpeed]: this.fanDefaultSpeed.toString()});
            } else {
                return this.setMultiStateLegacyAsync({[this.dpFanOn]: false, [this.dpRotationSpeed]: this.fanDefaultSpeed});
            }
        } else {
            this.fanCurrentSpeed = this.convertRotationSpeedFromHomeKitToTuya(value);
            if (this.useStrings) {
                return this.setMultiStateLegacyAsync({[this.dpFanOn]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value).toString()});
            } else {
                return this.setMultiStateLegacyAsync({[this.dpFanOn]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value)});
            }
        }
    }

    getFanDirection() {
        return this._getFanDirection(this.getStateAsync(this.dpFanDirection));
    }

    _getFanDirection(dp) {
        const {Characteristic} = this.hap;
        return (dp === 'reverse') ? Characteristic.RotationDirection.COUNTER_CLOCKWISE : Characteristic.RotationDirection.CLOCKWISE;
    }

    setFanDirection(value) {
        const {Characteristic} = this.hap;
        const tuyaVal = (value === Characteristic.RotationDirection.COUNTER_CLOCKWISE) ? 'reverse' : 'forward';
        return this.setStateAsync(this.dpFanDirection, tuyaVal);
    }

    convertRotationSpeedFromTuyaToHomeKit(value) {
        const v = parseInt(value) || 0;
        if (v <= 0) return 0;
        return Math.min(100, Math.max(1, Math.round((v * 100) / this.maxSpeed)));
    }

    convertRotationSpeedFromHomeKitToTuya(value) {
        const v = parseInt(value) || 0;
        if (v <= 0) return 0;
        const tuya = Math.round((v * this.maxSpeed) / 100);
        return Math.min(this.maxSpeed, Math.max(1, tuya));
    }
}

module.exports = SimpleFanAccessory;
