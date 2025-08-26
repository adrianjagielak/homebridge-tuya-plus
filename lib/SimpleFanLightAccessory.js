const BaseAccessory = require('./BaseAccessory');

class SimpleFanLightAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.FANLIGHT;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;
        this.accessory.addService(Service.Fan, this.device.context.name);
        this.accessory.addService(Service.Lightbulb, this.device.context.name + ' Light');
        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;

        const serviceFan = this.accessory.getService(Service.Fan);
        const serviceLightbulb = this.accessory.getService(Service.Lightbulb);
        this._checkServiceName(serviceFan, this.device.context.name);
        this._checkServiceName(serviceLightbulb, this.device.context.name + ' Light');

        // DP mapping examples
        this.dpFanOn = this._getCustomDP(this.device.context.dpFanOn) || '60';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '62';
        this.dpFanDirection = this._getCustomDP(this.device.context.dpFanDirection) || '63';
        this.dpLightOn = this._getCustomDP(this.device.context.dpLightOn) || '20';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || '22';
        this.dpColorTemp = this._getCustomDP(this.device.context.dpColorTemp) || '23';

        // Feature toggles and ranges
        this.useLight = this._coerceBoolean(this.device.context.useLight, true);
        this.useBrightness = this._coerceBoolean(this.device.context.useBrightness, true);
        this.useColorTemp = this._coerceBoolean(this.device.context.useColorTemp, true);
        this.maxSpeed = parseInt(this.device.context.maxSpeed) || 6;

        // This variable is here so that we can set the fans to turn onto speed one instead of a higher value on start.
        this.fanDefaultSpeed = parseInt(this.device.context.fanDefaultSpeed) || 1;
        // This variable is here as a workaround to allow for the on/off function to work.
        this.fanCurrentSpeed = 0;
        // Add setting to use .toString() on return values or not.
        this.useStrings = this._coerceBoolean(this.device.context.useStrings, true);

        // FAN - On/Off
        const characteristicFanOn = serviceFan.getCharacteristic(Characteristic.On)
            .updateValue(this._getFanOn(dps[this.dpFanOn]))
            .on('get', this.getFanOn.bind(this))
            .on('set', this.setFanOn.bind(this));

        // FAN - Speed (HomeKit 0-100 → Tuya 1..maxSpeed)
        const characteristicRotationSpeed = serviceFan.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: Math.max(1, 100 / this.maxSpeed) // ensure a sensible step
            })
            .updateValue(this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]))
            .on('get', this.getSpeed.bind(this))
            .on('set', this.setSpeed.bind(this));

        // FAN - Direction (forward/reverse)
        let characteristicFanDirection = serviceFan.getCharacteristic(Characteristic.RotationDirection)
            .updateValue(this._getFanDirection(dps[this.dpFanDirection]))
            .on('get', this.getFanDirection.bind(this))
            .on('set', this.setFanDirection.bind(this));

        // LIGHT
        let characteristicLightOn;
        let characteristicBrightness;
        let characteristicColorTemp;

        if (this.useLight) {
            characteristicLightOn = serviceLightbulb.getCharacteristic(Characteristic.On)
                .updateValue(this._getLightOn(dps[this.dpLightOn]))
                .on('get', this.getLightOn.bind(this))
                .on('set', this.setLightOn.bind(this));

            if (this.useBrightness) {
                // HomeKit brightness is 0..100; device uses 10..1000
                characteristicBrightness = serviceLightbulb.getCharacteristic(Characteristic.Brightness)
                    .setProps({
                        minValue: 0,
                        maxValue: 100,
                        minStep: 1
                    })
                    .updateValue(this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]))
                    .on('get', this.getBrightness.bind(this))
                    .on('set', this.setBrightness.bind(this));
            }

            if (this.useColorTemp) {
                // HomeKit ColorTemperature is in mireds (approx 140 cool .. 500 warm); device uses 0..1000
                characteristicColorTemp = serviceLightbulb.getCharacteristic(Characteristic.ColorTemperature)
                    .setProps({
                        minValue: 140,
                        maxValue: 500
                    })
                    .updateValue(this.convertColorTempFromTuyaToHomeKit(dps[this.dpColorTemp]))
                    .on('get', this.getColorTemp.bind(this))
                    .on('set', this.setColorTemp.bind(this));
            }
        }

        // Device event bridge
        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpFanOn) && characteristicFanOn.value !== changes[this.dpFanOn]) {
                characteristicFanOn.updateValue(this._getFanOn(changes[this.dpFanOn]));
            }

            if (changes.hasOwnProperty(this.dpRotationSpeed)) {
                const hk = this.convertRotationSpeedFromTuyaToHomeKit(changes[this.dpRotationSpeed]);
                if (characteristicRotationSpeed.value !== hk) characteristicRotationSpeed.updateValue(hk);
            }

            if (changes.hasOwnProperty(this.dpFanDirection) && characteristicFanDirection) {
                const dir = this._getFanDirection(changes[this.dpFanDirection]);
                if (characteristicFanDirection.value !== dir) characteristicFanDirection.updateValue(dir);
            }

            if (changes.hasOwnProperty(this.dpLightOn) && characteristicLightOn) {
                if (characteristicLightOn.value !== changes[this.dpLightOn]) characteristicLightOn.updateValue(changes[this.dpLightOn]);
            }

            if (changes.hasOwnProperty(this.dpBrightness) && characteristicBrightness) {
                const hkBri = this.convertBrightnessFromTuyaToHomeKit(changes[this.dpBrightness]);
                if (characteristicBrightness.value !== hkBri) characteristicBrightness.updateValue(hkBri);
            }

            if (changes.hasOwnProperty(this.dpColorTemp) && characteristicColorTemp) {
                const hkCt = this.convertColorTempFromTuyaToHomeKit(changes[this.dpColorTemp]);
                if (characteristicColorTemp.value !== hkCt) characteristicColorTemp.updateValue(hkCt);
            }

            this.log.debug('SimpleFanLight changed: ' + JSON.stringify(state));
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
        return !!dp;
    }

    setFanOn(value, callback) {
        // This uses the multistatelegacy set command to send the fan on and speed request in one call.
        if (value === false) {
            this.fanCurrentSpeed = 0;
            // This will turn off the fan speed if it is set to be 0.
            return this.setState(this.dpFanOn, false, callback);
        } else {
            const target = this.fanCurrentSpeed === 0 ? this.fanDefaultSpeed : this.fanCurrentSpeed;
            const payload = {
                [this.dpFanOn]: true,
                [this.dpRotationSpeed]: this.useStrings ? target.toString() : target
            };
            return this.setMultiStateLegacy(payload, callback);
        }
    }

    // Get the Current Fan Speed
    getSpeed(callback) {
        this.getState(this.dpRotationSpeed, (err, dp) => {
            if (err) return callback(err);
            callback(null, this.convertRotationSpeedFromTuyaToHomeKit(dp));
        });
    }

    // Set the new fan speed
    setSpeed(value, callback) {
        if (value === 0) {
            // This is to set the fan speed variable to be the default when the fan is off.
            const payload = {
                [this.dpFanOn]: false,
                [this.dpRotationSpeed]: this.useStrings ? this.fanDefaultSpeed.toString() : this.fanDefaultSpeed
            };
            return this.setMultiStateLegacy(payload, callback);
        } else {
            // This is to set the fan speed variable to match the current speed.
            const tuya = this.convertRotationSpeedFromHomeKitToTuya(value);
            this.fanCurrentSpeed = tuya;
            const payload = {
                [this.dpFanOn]: true,
                [this.dpRotationSpeed]: this.useStrings ? tuya.toString() : tuya
            };
            return this.setMultiStateLegacy(payload, callback);
        }
    }

    // Fan direction
    getFanDirection(callback) {
        this.getState(this.dpFanDirection, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._getFanDirection(dp));
        });
    }

    _getFanDirection(dp) {
        const { Characteristic } = this.hap;
        // forward → CLOCKWISE, reverse → COUNTER_CLOCKWISE
        return dp === 'reverse'
            ? Characteristic.RotationDirection.COUNTER_CLOCKWISE
            : Characteristic.RotationDirection.CLOCKWISE;
    }

    setFanDirection(value, callback) {
        // HomeKit: 0 = CLOCKWISE, 1 = COUNTER_CLOCKWISE
        const tuyaVal = (value === 1) ? 'reverse' : 'forward';
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

    /*************************** LIGHT ***************************/
    //Lightbulb State
    getLightOn(callback) {
        this.getState(this.dpLightOn, (err, dp) => {
            if (err) return callback(err);
            callback(null, this._getLightOn(dp));
        });
    }

    _getLightOn(dp) {
        return !!dp;
    }

    setLightOn(value, callback) {
        return this.setState(this.dpLightOn, value, callback);
    }

    //Lightbulb Brightness
    getBrightness(callback) {
        this.getState(this.dpBrightness, (err, dp) => {
            if (err) return callback(err);
            callback(null, this.convertBrightnessFromTuyaToHomeKit(dp));
        });
    }

    setBrightness(value, callback) {
        const tuya = this.convertBrightnessFromHomeKitToTuya(value);
        return this.setState(this.dpBrightness, this.useStrings ? tuya.toString() : tuya, callback);
    }

    // Lightbulb Color Temperature
    getColorTemp(callback) {
        this.getState(this.dpColorTemp, (err, dp) => {
            if (err) return callback(err);
            callback(null, this.convertColorTempFromTuyaToHomeKit(dp));
        });
    }

    setColorTemp(value, callback) {
        const tuya = this.convertColorTempFromHomeKitToTuya(value);
        return this.setState(this.dpColorTemp, this.useStrings ? tuya.toString() : tuya, callback);
    }

    // Helpers for brightness conversion (Tuya 10..1000 ↔ HK 0..100)
    convertBrightnessFromTuyaToHomeKit(value) {
        let v = parseInt(value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(1000, v));
        // device min is 10; map linearly 10..1000 → 0..100
        const pct = Math.round(((v - 10) * 100) / (1000 - 10));
        return Math.max(0, Math.min(100, pct));
    }

    convertBrightnessFromHomeKitToTuya(value) {
        let v = parseInt(value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(100, v));
        const tuya = Math.round(10 + (v * (1000 - 10)) / 100);
        return Math.max(10, Math.min(1000, tuya));
    }

    // Helpers for color temperature conversion (Tuya 0..1000 ↔ HK 140..500 mireds)
    convertColorTempFromTuyaToHomeKit(value) {
        let v = parseInt(value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(1000, v));
        // 0 → cool (≈140), 1000 → warm (≈500)
        const hk = Math.round(140 + (v * (500 - 140)) / 1000);
        return Math.max(140, Math.min(500, hk));
    }

    convertColorTempFromHomeKitToTuya(value) {
        let v = parseInt(value);
        if (isNaN(v)) v = 140;
        v = Math.max(140, Math.min(500, v));
        const tuya = Math.round(((v - 140) * 1000) / (500 - 140));
        return Math.max(0, Math.min(1000, tuya));
    }
}

module.exports = SimpleFanLightAccessory;