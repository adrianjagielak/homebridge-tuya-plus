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
        
        if (this.device.context.dpCurrentTemperature) {
            this.accessory.addService(Service.TemperatureSensor, this.device.context.name + ' Temperature');
        }
        
        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        
        const serviceFan = this.accessory.getService(Service.Fan);
        this._checkServiceName(serviceFan, this.device.context.name);

        let serviceTemp;
        if (this.device.context.dpCurrentTemperature) {
            serviceTemp = this.accessory.getService(Service.TemperatureSensor);
            if (serviceTemp) {
                this._checkServiceName(serviceTemp, this.device.context.name + ' Temperature');
            }
        }

        this.dpFanOn = this._getCustomDP(this.device.context.dpFanOn) || '1';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '3';
        this.dpFanDirection = this._getCustomDP(this.device.context.dpFanDirection) || '2';
        this.dpSwing = this._getCustomDP(this.device.context.dpSwing);
        this.dpSwingVertical = this._getCustomDP(this.device.context.dpSwingVertical);
        
        this.dpCurrentTemperature = this._getCustomDP(this.device.context.dpCurrentTemperature);

        this.noDirection = this._coerceBoolean(this.device.context.noDirection, false);
        this.directionUseBool = this._coerceBoolean(this.device.context.directionUseBool, false);

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

        let characteristicFanDirection;
        if (!this.noDirection) {
            characteristicFanDirection = serviceFan.getCharacteristic(Characteristic.RotationDirection)
                .updateValue(this._getFanDirection(dps[this.dpFanDirection]))
                .onGet(() => this.getFanDirection())
                .onSet(value => this.setFanDirection(value));
        } else this._removeCharacteristic(serviceFan, Characteristic.RotationDirection);

        let characteristicSwingMode;
        if (this.dpSwing) {
            characteristicSwingMode = serviceFan.getCharacteristic(Characteristic.SwingMode)
                .updateValue(this._getSwingMode(dps[this.dpSwing]))
                .onGet(() => this.getSwingMode())
                .onSet(value => this.setSwingMode(value));
        } else this._removeCharacteristic(serviceFan, Characteristic.SwingMode);

        let serviceSwingVertical = this.accessory.getServiceById(Service.Switch, 'swing-vertical');
        if (this.dpSwingVertical && !serviceSwingVertical) {
            serviceSwingVertical = this.accessory.addService(Service.Switch, this._getSwingVerticalName(), 'swing-vertical');
        } else if (!this.dpSwingVertical && serviceSwingVertical) {
            this.accessory.removeService(serviceSwingVertical);
            serviceSwingVertical = null;
        }

        let characteristicSwingVertical;
        if (serviceSwingVertical) {
            this._checkServiceName(serviceSwingVertical, this._getSwingVerticalName());
            characteristicSwingVertical = serviceSwingVertical.getCharacteristic(Characteristic.On)
                .updateValue(this._getSwingVertical(dps[this.dpSwingVertical]))
                .onGet(() => this.getSwingVertical())
                .onSet(value => this.setSwingVertical(value));
        }

        let characteristicTemperature;
        if (this.dpCurrentTemperature && serviceTemp) {
            characteristicTemperature = serviceTemp.getCharacteristic(Characteristic.CurrentTemperature)
                .updateValue(this._getCurrentTemperature(dps[this.dpCurrentTemperature]))
                .onGet(() => this.getCurrentTemperature());
        }

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpFanOn) && characteristicFanOn.value !== changes[this.dpFanOn])
                characteristicFanOn.updateValue(changes[this.dpFanOn]);

            if (changes.hasOwnProperty(this.dpRotationSpeed) && this.convertRotationSpeedFromHomeKitToTuya(characteristicRotationSpeed.value) !== changes[this.dpRotationSpeed])
                characteristicRotationSpeed.updateValue(this.convertRotationSpeedFromTuyaToHomeKit(changes[this.dpRotationSpeed]));

            if (changes.hasOwnProperty(this.dpFanDirection) && characteristicFanDirection) {
                const dir = this._getFanDirection(changes[this.dpFanDirection]);
                if (characteristicFanDirection.value !== dir) characteristicFanDirection.updateValue(dir);
            }

            if (characteristicSwingMode && changes.hasOwnProperty(this.dpSwing)) {
                const swing = this._getSwingMode(changes[this.dpSwing]);
                if (characteristicSwingMode.value !== swing) characteristicSwingMode.updateValue(swing);
            }

            if (characteristicSwingVertical && changes.hasOwnProperty(this.dpSwingVertical)) {
                const swingVertical = this._getSwingVertical(changes[this.dpSwingVertical]);
                if (characteristicSwingVertical.value !== swingVertical) characteristicSwingVertical.updateValue(swingVertical);
            }

            if (characteristicTemperature && changes.hasOwnProperty(this.dpCurrentTemperature)) {
                const temp = this._getCurrentTemperature(changes[this.dpCurrentTemperature]);
                if (characteristicTemperature.value !== temp) characteristicTemperature.updateValue(temp);
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
        if (this.directionUseBool) {
            return dp ? Characteristic.RotationDirection.CLOCKWISE : Characteristic.RotationDirection.COUNTER_CLOCKWISE;
        }
        return (dp === 'reverse') ? Characteristic.RotationDirection.COUNTER_CLOCKWISE : Characteristic.RotationDirection.CLOCKWISE;
    }

    setFanDirection(value) {
        const {Characteristic} = this.hap;
        if (this.directionUseBool) {
            return this.setStateAsync(this.dpFanDirection, value !== Characteristic.RotationDirection.COUNTER_CLOCKWISE);
        }
        const tuyaVal = (value === Characteristic.RotationDirection.COUNTER_CLOCKWISE) ? 'reverse' : 'forward';
        return this.setStateAsync(this.dpFanDirection, tuyaVal);
    }

    getSwingMode() {
        return this._getSwingMode(this.getStateAsync(this.dpSwing));
    }

    _getSwingMode(dp) {
        const {Characteristic} = this.hap;
        return this._isSwinging(dp, this.device.context.swingOffValue) ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
    }

    setSwingMode(value) {
        const {Characteristic} = this.hap;
        const enabled = value === Characteristic.SwingMode.SWING_ENABLED;
        return this.setStateAsync(this.dpSwing, this._getSwingDPValue(enabled, this.device.context.swingOnValue, this.device.context.swingOffValue));
    }

    getSwingVertical() {
        return this._getSwingVertical(this.getStateAsync(this.dpSwingVertical));
    }

    _getSwingVertical(dp) {
        return this._isSwinging(dp, this.device.context.swingVerticalOffValue);
    }

    setSwingVertical(value) {
        return this.setStateAsync(this.dpSwingVertical, this._getSwingDPValue(!!value, this.device.context.swingVerticalOnValue, this.device.context.swingVerticalOffValue));
    }

    _getSwingVerticalName() {
        return this.device.context.nameSwingVertical || this.device.context.name + ' Vertical Swing';
    }

    // Many fans model oscillation as an enum of sweep angles (e.g. "OFF"/"30"/"120")
    // rather than a boolean; with an off value configured, any other value means swinging.
    _isSwinging(dp, offValue) {
        if (offValue === undefined || offValue === null || offValue === '') return !!dp;
        return dp !== undefined && dp !== null && String(dp) !== String(offValue);
    }

    _getSwingDPValue(enabled, onValue, offValue) {
        if (enabled) return (onValue === undefined || onValue === null || onValue === '') ? true : onValue;
        return (offValue === undefined || offValue === null || offValue === '') ? false : offValue;
    }

    getCurrentTemperature() {
        return this._getCurrentTemperature(this.getStateAsync(this.dpCurrentTemperature));
    }

    _getCurrentTemperature(dp) {
        const v = parseFloat(dp);
        return isNaN(v) ? 0 : v;
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