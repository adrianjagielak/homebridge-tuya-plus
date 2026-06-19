const BaseAccessory = require('./BaseAccessory');

// HomeKit color temperature is expressed in mireds (reciprocal megakelvin):
// LOW mireds = cool/blue, HIGH mireds = warm/orange.
// Tuya's standard `temp_value` DP runs the other way: 0 = warmest, scale = coolest.
// The two scales must therefore be inverted when converting between them.
// Defaults below describe a typical CCT lamp range of ~2700K..6500K.
const DEFAULT_MIN_WHITE_COLOR = 154; // ~6500K (coolest, lowest mired)
const DEFAULT_MAX_WHITE_COLOR = 370; // ~2700K (warmest, highest mired)
const COLOR_TEMP_TUYA_SCALE = 1000;  // Tuya temp_value range: 0 (warm) .. 1000 (cool)

class SimpleFanLightAccessory extends BaseAccessory {
    static getCategory(Categories) {
        // HAP has no combined fan+light category; the fan is the primary
        // service, so categorise as a FAN (matches SimpleFanAccessory).
        return Categories.FAN;
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

        this.dpFanOn = this._getCustomDP(this.device.context.dpFanOn) || '60';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '62';
        this.dpFanDirection = this._getCustomDP(this.device.context.dpFanDirection) || '63';
        this.dpLightOn = this._getCustomDP(this.device.context.dpLightOn) || '20';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || '22';
        this.dpColorTemp = this._getCustomDP(this.device.context.dpColorTemp) || '23';

        this.useLight = this._coerceBoolean(this.device.context.useLight, true);
        this.useBrightness = this._coerceBoolean(this.device.context.useBrightness, true);
        this.useColorTemp = this._coerceBoolean(this.device.context.useColorTemp, true);

        let minWhiteColor = parseInt(this.device.context.minWhiteColor);
        let maxWhiteColor = parseInt(this.device.context.maxWhiteColor);
        if (isNaN(minWhiteColor)) minWhiteColor = DEFAULT_MIN_WHITE_COLOR;
        if (isNaN(maxWhiteColor)) maxWhiteColor = DEFAULT_MAX_WHITE_COLOR;
        if (maxWhiteColor <= minWhiteColor) {
            this.log.warn(`${this.device.context.name}: maxWhiteColor (${maxWhiteColor}) must be greater than minWhiteColor (${minWhiteColor}); falling back to defaults.`);
            minWhiteColor = DEFAULT_MIN_WHITE_COLOR;
            maxWhiteColor = DEFAULT_MAX_WHITE_COLOR;
        }
        this.minWhiteColor = minWhiteColor;
        this.maxWhiteColor = maxWhiteColor;

        this.maxSpeed = parseInt(this.device.context.maxSpeed) || 6;
        this.fanDefaultSpeed = parseInt(this.device.context.fanDefaultSpeed) || 1;
        this.fanCurrentSpeed = 0;
        this.useStrings = this._coerceBoolean(this.device.context.useStrings, true);
        this.singleDpWrites = this._coerceBoolean(this.device.context.singleDpWrites, false);
        this.useStringsFan = this._coerceBoolean(this.device.context.useStringsFan, this.useStrings);
        this.useStringsLight = this._coerceBoolean(this.device.context.useStringsLight, this.useStrings);

        const characteristicFanOn = serviceFan.getCharacteristic(Characteristic.On)
            .updateValue(this._getFanOn(dps[this.dpFanOn]))
            .onGet(() => this.getFanOn())
            .onSet(value => this.setFanOn(value));

        const characteristicRotationSpeed = serviceFan.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({
                minValue: 0,
                maxValue: 100,
                minStep: Math.max(1, 100 / this.maxSpeed)
            })
            .updateValue(this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]))
            .onGet(() => this.getSpeed())
            .onSet(value => this.setSpeed(value));

        const characteristicFanDirection = serviceFan.getCharacteristic(Characteristic.RotationDirection)
            .updateValue(this._getFanDirection(dps[this.dpFanDirection]))
            .onGet(() => this.getFanDirection())
            .onSet(value => this.setFanDirection(value));

        let characteristicLightOn;
        let characteristicBrightness;
        let characteristicColorTemp;

        if (this.useLight) {
            characteristicLightOn = serviceLightbulb.getCharacteristic(Characteristic.On)
                .updateValue(this._getLightOn(dps[this.dpLightOn]))
                .onGet(() => this.getLightOn())
                .onSet(value => this.setLightOn(value));

            if (this.useBrightness) {
                characteristicBrightness = serviceLightbulb.getCharacteristic(Characteristic.Brightness)
                    .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
                    .updateValue(this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]))
                    .onGet(() => this.getBrightness())
                    .onSet(value => this.setBrightness(value));
            }

            if (this.useColorTemp) {
                characteristicColorTemp = serviceLightbulb.getCharacteristic(Characteristic.ColorTemperature)
                    .setProps({ minValue: this.minWhiteColor, maxValue: this.maxWhiteColor })
                    .updateValue(this.convertColorTempFromTuyaToHomeKit(dps[this.dpColorTemp]))
                    .onGet(() => this.getColorTemp())
                    .onSet(value => this.setColorTemp(value));
            }
        }

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpFanOn) && characteristicFanOn.value !== changes[this.dpFanOn])
                characteristicFanOn.updateValue(this._getFanOn(changes[this.dpFanOn]));

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

    getFanOn() {
        return this._getFanOn(this.getStateAsync(this.dpFanOn));
    }

    _getFanOn(dp) {
        return !!dp;
    }

    // Fan on/speed touch two DPs (60 + 62) at once. By default we send them in a
    // single legacy control packet, which is what most fans expect. Some firmwares
    // (e.g. certain `fsd` ceiling fans) silently ignore any LAN packet carrying more
    // than one DP, so when `singleDpWrites` is set we send each DP as its own packet
    // instead — mirroring how Tuya's own cloud issues these commands.
    _writeFanState(payload) {
        return this.singleDpWrites
            ? this.setMultiStateAsync(payload)
            : this.setMultiStateLegacyAsync(payload);
    }

    setFanOn(value) {
        if (value === false) {
            this.fanCurrentSpeed = 0;
            return this.setStateAsync(this.dpFanOn, false);
        } else {
            const target = this.fanCurrentSpeed === 0 ? this.fanDefaultSpeed : this.fanCurrentSpeed;
            const payload = {
                [this.dpFanOn]: true,
                [this.dpRotationSpeed]: this.useStringsFan ? target.toString() : target
            };
            return this._writeFanState(payload);
        }
    }

    getSpeed() {
        return this.convertRotationSpeedFromTuyaToHomeKit(this.getStateAsync(this.dpRotationSpeed));
    }

    setSpeed(value) {
        if (value === 0) {
            const payload = {
                [this.dpFanOn]: false,
                [this.dpRotationSpeed]: this.useStringsFan ? this.fanDefaultSpeed.toString() : this.fanDefaultSpeed
            };
            return this._writeFanState(payload);
        } else {
            const tuya = this.convertRotationSpeedFromHomeKitToTuya(value);
            this.fanCurrentSpeed = tuya;
            const payload = {
                [this.dpFanOn]: true,
                [this.dpRotationSpeed]: this.useStringsFan ? tuya.toString() : tuya
            };
            return this._writeFanState(payload);
        }
    }

    getFanDirection() {
        return this._getFanDirection(this.getStateAsync(this.dpFanDirection));
    }

    _getFanDirection(dp) {
        const {Characteristic} = this.hap;
        return dp === 'reverse'
            ? Characteristic.RotationDirection.COUNTER_CLOCKWISE
            : Characteristic.RotationDirection.CLOCKWISE;
    }

    setFanDirection(value) {
        const tuyaVal = (value === 1) ? 'reverse' : 'forward';
        return this.setStateAsync(this.dpFanDirection, tuyaVal);
    }

    getLightOn() {
        return this._getLightOn(this.getStateAsync(this.dpLightOn));
    }

    _getLightOn(dp) {
        return !!dp;
    }

    setLightOn(value) {
        return this.setStateAsync(this.dpLightOn, value);
    }

    getBrightness() {
        return this.convertBrightnessFromTuyaToHomeKit(this.getStateAsync(this.dpBrightness));
    }

    setBrightness(value) {
        const tuya = this.convertBrightnessFromHomeKitToTuya(value);
        return this.setStateAsync(this.dpBrightness, this.useStringsLight ? tuya.toString() : tuya);
    }

    getColorTemp() {
        return this.convertColorTempFromTuyaToHomeKit(this.getStateAsync(this.dpColorTemp));
    }

    setColorTemp(value) {
        const tuya = this.convertColorTempFromHomeKitToTuya(value);
        return this.setStateAsync(this.dpColorTemp, this.useStringsLight ? tuya.toString() : tuya);
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

    convertBrightnessFromTuyaToHomeKit(value) {
        let v = parseInt(value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(1000, v));
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

    convertColorTempFromTuyaToHomeKit(value) {
        const min = this.minWhiteColor ?? DEFAULT_MIN_WHITE_COLOR;
        const max = this.maxWhiteColor ?? DEFAULT_MAX_WHITE_COLOR;
        let v = parseInt(value);
        if (isNaN(v)) v = 0;
        v = Math.max(0, Math.min(COLOR_TEMP_TUYA_SCALE, v));
        // Invert: Tuya 0 (warm) -> max mireds (warm); Tuya scale (cool) -> min mireds (cool).
        const hk = Math.round(max - (v * (max - min)) / COLOR_TEMP_TUYA_SCALE);
        return Math.max(min, Math.min(max, hk));
    }

    convertColorTempFromHomeKitToTuya(value) {
        const min = this.minWhiteColor ?? DEFAULT_MIN_WHITE_COLOR;
        const max = this.maxWhiteColor ?? DEFAULT_MAX_WHITE_COLOR;
        let v = parseInt(value);
        if (isNaN(v)) v = min;
        v = Math.max(min, Math.min(max, v));
        // Invert: max mireds (warm) -> Tuya 0 (warm); min mireds (cool) -> Tuya scale (cool).
        const tuya = Math.round(((max - v) * COLOR_TEMP_TUYA_SCALE) / (max - min));
        return Math.max(0, Math.min(COLOR_TEMP_TUYA_SCALE, tuya));
    }
}

module.exports = SimpleFanLightAccessory;
