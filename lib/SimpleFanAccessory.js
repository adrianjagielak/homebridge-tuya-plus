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
        // Add fan direction DP to the accessory
        this.dpFanDirection = this._getCustomDP(this.device.context.dpFanDirection) || '2';
        
        this.maxSpeed = parseInt(this.device.context.maxSpeed) || 3;
        this.fanDefaultSpeed = parseInt(this.device.context.fanDefaultSpeed) || 1;
        this.fanCurrentSpeed = 0;
        this.useStrings = this._coerceBoolean(this.device.context.useStrings, true);
        this.useMultiState = this._coerceBoolean(this.device.context.useMultiState, true);

        const characteristicFanOn = serviceFan.getCharacteristic(Characteristic.On)
            .updateValue(this._getFanOn(dps[this.dpFanOn]))
            .on('get', this.getFanOn.bind(this))
            .on('set', this.setFanOn.bind(this));

        const characteristicRotationSpeed = serviceFan.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: Math.max(100 / this.maxSpeed)
            })
            .updateValue(this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]))
            .on('get', this.getSpeed.bind(this))
            .on('set', this.setSpeed.bind(this));

        // Add RotationDirection characteristic
        const characteristicFanDirection = serviceFan.getCharacteristic(Characteristic.RotationDirection)
            .updateValue(this._getFanDirection(dps[this.dpFanDirection]))
            .on('get', this.getFanDirection.bind(this))
            .on('set', this.setFanDirection.bind(this));

        this.device.on('change', (changes, state) => {

            if (changes.hasOwnProperty(this.dpFanOn) && characteristicFanOn.value !== changes[this.dpFanOn])
                characteristicFanOn.updateValue(changes[this.dpFanOn]);

            if (changes.hasOwnProperty(this.dpRotationSpeed) && this.convertRotationSpeedFromHomeKitToTuya(characteristicRotationSpeed.value) !== changes[this.dpRotationSpeed])
                characteristicRotationSpeed.updateValue(this.convertRotationSpeedFromTuyaToHomeKit(changes[this.dpRotationSpeed]));

            // Update RotationDirection on device change
            if (changes.hasOwnProperty(this.dpFanDirection) && characteristicFanDirection) {
                const dir = this._getFanDirection(changes[this.dpFanDirection]);
                if (characteristicFanDirection.value !== dir) characteristicFanDirection.updateValue(dir);
            }

            this.log.debug('SimpleFan changed: ' + JSON.stringify(state));
        });
    }

    /*************************** FAN ***************************/
    // Get the Current Fan State
    getFanOn(callback) {
        this.getState(this.dpFanOn, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._getFanOn(dp));
        });
    }

    _getFanOn(dp) {
        const {Characteristic} = this.hap;
        return dp;
    }

    setFanOn(value, callback) {
        const {Characteristic} = this.hap;
        
        if (!this.useMultiState) {
          return this.setState(this.dpFanOn, value, callback);
        } else if (value == false ) {
          this.fanCurrentSpeed = 0;
          return this.setState(this.dpFanOn, false, callback);
        } else {
          if (this.fanCurrentSpeed === 0) {
            if (this.useStrings) {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanDefaultSpeed.toString()}, callback);
            } else {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanDefaultSpeed}, callback);
            }
          } else {
            if (this.useStrings) {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanCurrentSpeed.toString()}, callback);
            } else {
                return this.setMultiStateLegacy({[this.dpFanOn]: value, [this.dpRotationSpeed]: this.fanCurrentSpeed}, callback);
            }
          }
        }
    }

    // Get the Current Fan Speed
    getSpeed(callback) {
        this.getState(this.dpRotationSpeed, (err, dp) => {
            if (err) return callback(err);
            callback(null, this.convertRotationSpeedFromTuyaToHomeKit(this.device.state[this.dpRotationSpeed]));
        });
    }

    // Set the new fan speed
    setSpeed(value, callback) {
      const {Characteristic} = this.hap;
      if (!this.useMultiState) {
          return this.setState(this.dpRotationSpeed, this.convertRotationSpeedFromHomeKitToTuya(value), callback);
      } else if (value === 0) {
        // This is to set the fan speed variable to be 1 when the fan is off.
        if (this.useStrings) {
            return this.setMultiStateLegacy({[this.dpFanOn]: false, [this.dpRotationSpeed]: this.fanDefaultSpeed.toString()}, callback);
        } else {
            return this.setMultiStateLegacy({[this.dpFanOn]: false, [this.dpRotationSpeed]: this.fanDefaultSpeed}, callback);
        }
      } else {
        // This is to set the fan speed variable to match the current speed.
        this.fanCurrentSpeed = this.convertRotationSpeedFromHomeKitToTuya(value);
        // This uses the multistatelegacy set command to send the fan on and speed request in one call.
        if (this.useStrings) {
            return this.setMultiStateLegacy({[this.dpFanOn]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value).toString()}, callback);
        } else {
            return this.setMultiStateLegacy({[this.dpFanOn]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value)}, callback);            
        }
      }
    }
    
    // Get the Current Fan Direction
    getFanDirection(callback) {
        this.getState(this.dpFanDirection, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._getFanDirection(dp));
        });
    }

    _getFanDirection(dp) {
        const { Characteristic } = this.hap;
        // forward -> CLOCKWISE, reverse -> COUNTER_CLOCKWISE
        return (dp === 'reverse') ? Characteristic.RotationDirection.COUNTER_CLOCKWISE : Characteristic.RotationDirection.CLOCKWISE;
    }

    setFanDirection(value, callback) {
        const { Characteristic } = this.hap;
        // HomeKit: 0 = CLOCKWISE, 1 = COUNTER_CLOCKWISE
        const tuyaVal = (value === Characteristic.RotationDirection.COUNTER_CLOCKWISE) ? 'reverse' : 'forward';
        return this.setState(this.dpFanDirection, tuyaVal, callback);
    }
    
    // Helpers for speed conversion (HomeKit 0..100 ↔ Tuya 1..maxSpeed)
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
