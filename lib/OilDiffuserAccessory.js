const BaseAccessory = require('./BaseAccessory');

class OilDiffuserAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.DEHUMIDIFIER;
    }

    constructor(...props) {
        super(...props);
    }

    _isBelleLife() {
        return this.device.context.manufacturer.trim().toLowerCase() === 'bellelife';
    }

    _isGeeni() {
        return this.device.context.manufacturer.trim().toLowerCase() === 'geeni';
    }

    _isAsakuki() {
        return this.device.context.manufacturer.trim().toLowerCase() === 'asakuki';
    }

    _registerPlatformAccessory() {
        this._verifyCachedPlatformAccessory();
        this._justRegistered = true;

        super._registerPlatformAccessory();
    }

    _verifyCachedPlatformAccessory() {
        if (this._justRegistered) return;

        const {Service} = this.hap;

        const humidifierName = this.device.context.name;
        let humidifierService = this.accessory.getServiceById(Service.HumidifierDehumidifier.UUID, 'humidifier');
        if (humidifierService) this._checkServiceName(humidifierService, humidifierName);
        else humidifierService = this.accessory.addService(Service.HumidifierDehumidifier, humidifierName, 'humidifier');

        const lightName = this.device.context.name + ' Light';
        let lightService = this.accessory.getServiceById(Service.Lightbulb.UUID, 'lightbulb');
        if (lightService) this._checkServiceName(lightService, lightName);
        else lightService = this.accessory.addService(Service.Lightbulb, lightName, 'lightbulb');

        this.accessory.services
            .forEach(service => {
                if ((service.UUID === Service.HumidifierDehumidifier.UUID && service !== humidifierService) || (service.UUID === Service.Lightbulb.UUID && service !== lightService))
                    this.accessory.removeService(service);
            });
    }

    _registerCharacteristics(dps) {
        this._verifyCachedPlatformAccessory();

        const {Service, AdaptiveLightingController, Characteristic} = this.hap;

        const humidifierService = this.accessory.getServiceById(Service.HumidifierDehumidifier.UUID, 'humidifier');
        const lightService = this.accessory.getServiceById(Service.Lightbulb.UUID, 'lightbulb');

        this.dpLight = this._getCustomDP(this.device.context.dpLight) || '5';
        this.dpMode = this._getCustomDP(this.device.context.dpMode) || '6';
        this.dpColor = this._getCustomDP(this.device.context.dpColor) || '8';
        this.dpActive = this._getCustomDP(this.device.context.dpActive) || '1';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '2';
        this.dpWaterLevel = this._getCustomDP(this.device.context.dpWaterLevel) || '9';
        this.maxSpeed = this._getCustomDP(this.device.context.maxSpeed) || 2;

        if (this._isBelleLife()) {
            this.cmdInterval = 'interval';
            this.cmdLow = 'small';
            this.cmdHigh = 'large';
        } else if (this._isGeeni()) {
            this.cmdInterval = '2';
            this.cmdContinuous = '1';
        } else if (this._isAsakuki()) {
            this.cmdLow = 'small';
            this.cmdHigh = 'big';
        } else {
            this.cmdInterval = this.device.context.cmdInterval || '2';
            this.cmdContinuous = this.device.context.cmdContinuous || '1';
        }

        this._detectColorFunction(dps[this.dpColor]);

        this.cmdWhite = 'white';
        if (this.device.context.cmdWhite) {
            if (/^w[a-z]+$/i.test(this.device.context.cmdWhite)) this.cmdWhite = ('' + this.device.context.cmdWhite).trim();
            else throw new Error(`The cmdWhite doesn't appear to be valid: ${this.device.context.cmdWhite}`);
        }

        this.cmdColor = 'colour';
        if (this.device.context.cmdColor) {
            if (/^c[a-z]+$/i.test(this.device.context.cmdColor)) this.cmdColor = ('' + this.device.context.cmdColor).trim();
            else throw new Error(`The cmdColor doesn't appear to be valid: ${this.device.context.cmdColor}`);
        } else if (this.device.context.cmdColour) {
            if (/^c[a-z]+$/i.test(this.device.context.cmdColour)) this.cmdColor = ('' + this.device.context.cmdColour).trim();
            else throw new Error(`The cmdColour doesn't appear to be valid: ${this.device.context.cmdColour}`);
        }

        // Led Light
        const characteristicLightOn = lightService.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpLight])
            .onGet(() => this.getStateAsync(this.dpLight))
            .onSet(value => this.setStateAsync(this.dpLight, value));

        const characteristicBrightness = lightService.getCharacteristic(Characteristic.Brightness)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? this.convertBrightnessFromTuyaToHomeKit(dps[this.dpColor]).b : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).b)
            .onGet(() => this.getBrightness())
            .onSet(value => this.setBrightness(value));

        const characteristicColorTemperature = lightService.getCharacteristic(Characteristic.ColorTemperature)
            .setProps({ minValue: 0, maxValue: 600 })
            .updateValue(dps[this.dpMode] === this.cmdWhite ? this.convertColorTemperatureFromTuyaToHomeKit(dps[this.dpColorTemperature]) : 0)
            .onGet(() => this.getColorTemperature())
            .onSet(value => this.setColorTemperature(value));

        const characteristicHue = lightService.getCharacteristic(Characteristic.Hue)
            .updateValue(this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).h)
            .onGet(() => this.getHue())
            .onSet(value => this.setHue(value));

        const characteristicSaturation = lightService.getCharacteristic(Characteristic.Saturation)
            .updateValue(this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).s)
            .onGet(() => this.getSaturation())
            .onSet(value => this.setSaturation(value));

        this.characteristicHue = characteristicHue;
        this.characteristicSaturation = characteristicSaturation;
        this.characteristicColorTemperature = characteristicColorTemperature;
        this.characteristicBrightness = characteristicBrightness;

        if (this.adaptiveLightingSupport()) {
            this.adaptiveLightingController = new AdaptiveLightingController(lightService);
            this.accessory.configureController(this.adaptiveLightingController);
            this.accessory.adaptiveLightingController = this.adaptiveLightingController;
        }

        // Humidifier
        const characteristicActive = humidifierService.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(dps[this.dpActive]))
            .onGet(() => this.getActive())
            .onSet(value => this.setActive(value));

        humidifierService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
            .updateValue(this._getCurrentHumidifierDehumidifierState(dps))
            .onGet(() => this._getCurrentHumidifierDehumidifierState(this.getStateAsync([this.dpActive])));

        humidifierService.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
            .setProps({ minValue: 1, maxValue: 1, validValues: [1] })
            .updateValue(this._getTargetHumidifierDehumidifierState())
            .onGet(() => this._getTargetHumidifierDehumidifierState())
            .onSet(() => this.setStateAsync(this.dpActive, true));

        const characteristicWaterLevel = humidifierService.getCharacteristic(Characteristic.WaterLevel)
            .updateValue(this._getWaterLevel(dps[this.dpWaterLevel]))
            .onGet(() => this._getWaterLevel(this.getStateAsync(this.dpWaterLevel)));

        humidifierService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .updateValue(this.dpActive ? 1 : 0)
            .onGet(() => this.getRotationSpeed());

        const characteristicRotationSpeed = humidifierService.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: this.maxSpeed, minStep: 1 })
            .updateValue(this._getRotationSpeed(dps))
            .onGet(() => this.getRotationSpeed())
            .onSet(value => this.setRotationSpeed(value));

        this.characteristicActive = characteristicActive;
        this.characteristicRotationSpeed = characteristicRotationSpeed;

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpLight) && characteristicLightOn.value !== changes[this.dpLight]) characteristicLightOn.updateValue(changes[this.dpLight]);

            if (changes.hasOwnProperty(this.dpActive)) {
                const newActive = this._getActive(changes[this.dpActive]);
                if (characteristicActive.value !== newActive) characteristicActive.updateValue(newActive);
            }

            if (changes.hasOwnProperty(this.dpRotationSpeed)) {
                const newValue = this._getRotationSpeed(changes[this.dpRotationSpeed]);
                if (characteristicRotationSpeed.value !== newValue) characteristicRotationSpeed.updateValue(newValue);
            }

            if (changes.hasOwnProperty(this.dpWaterLevel) && characteristicWaterLevel) {
                const waterLevel = changes[this.dpWaterLevel];
                if (characteristicWaterLevel.value !== waterLevel) characteristicWaterLevel.updateValue(waterLevel);
            }

            if (changes.hasOwnProperty(this.dpColor)) {
                const oldColor = this.convertColorFromTuyaToHomeKit(this.convertColorFromHomeKitToTuya({
                    h: characteristicHue.value,
                    s: characteristicSaturation.value,
                    b: characteristicBrightness.value
                }));
                const newColor = this.convertColorFromTuyaToHomeKit(changes[this.dpColor]);

                if (oldColor.h !== newColor.h) characteristicHue.updateValue(newColor.h);
                if (oldColor.s !== newColor.s) characteristicSaturation.updateValue(newColor.s);
                if (oldColor.b !== newColor.b) characteristicBrightness.updateValue(newColor.b);
            }
        });
    }

    getBrightness() {
        if (this.device.state[this.dpMode] === this.cmdWhite) return this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpColor]).b;
        return this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).b;
    }

    setBrightness(value) {
        if (value === 0) {
            return this.setStateAsync(this.dpLight, false);
        } else {
            if (this.device.state[this.dpMode] === this.cmdWhite) return this.setStateAsync((this.dpColor).b, this.convertBrightnessFromHomeKitToTuya({b: value}));
            this.device.state[this.dpMode] = this.cmdColor;
            return this.setMultiStateAsync({[this.dpMode]: this.cmdColor, [this.dpColor]: this.convertColorFromHomeKitToTuya({b: value})});
        }
    }

    getColorTemperature() {
        if (this.device.state[this.dpMode] !== this.cmdWhite) return 0;
        return this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature]);
    }

    setColorTemperature(value) {
        if (value === 0) return;

        const newColor = this.convertHomeKitColorTemperatureToHomeKitColor(value);
        this.characteristicHue.updateValue(newColor.h);
        this.characteristicSaturation.updateValue(newColor.s);
        this.device.state[this.dpMode] = this.cmdColor;

        return this.setMultiStateAsync({[this.dpMode]: this.cmdColor, [this.dpColor]: this.convertColorFromHomeKitToTuya(newColor)});
    }

    getHue() {
        if (this.device.state[this.dpMode] === this.cmdWhite) return 0;
        return this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).h;
    }

    setHue(value) {
        return this._setHueSaturation({h: value});
    }

    getSaturation() {
        return this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).s;
    }

    setSaturation(value) {
        return this._setHueSaturation({s: value});
    }

    _setHueSaturation(prop) {
        if (!this._pendingHueSaturation) {
            this._pendingHueSaturation = {props: {}, resolvers: []};
        }

        if (this._pendingHueSaturation.timer) clearTimeout(this._pendingHueSaturation.timer);
        this._pendingHueSaturation.props = {...this._pendingHueSaturation.props, ...prop};

        return new Promise(resolve => {
            this._pendingHueSaturation.resolvers.push(resolve);

            this._pendingHueSaturation.timer = setTimeout(() => {
                const {props, resolvers} = this._pendingHueSaturation;
                this._pendingHueSaturation = null;

                const newValue = this.convertColorFromHomeKitToTuya(props);
                this.setMultiStateAsync({[this.dpMode]: this.cmdColor, [this.dpColor]: newValue});

                resolvers.forEach(r => r());
            }, 500);
        });
    }

    getActive() {
        return this._getActive(this.getStateAsync(this.dpActive));
    }

    _getActive(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    }

    setActive(value) {
        if (this.characteristicActive.value !== value) {
            const {Characteristic} = this.hap;
            switch (value) {
                case Characteristic.Active.ACTIVE:
                    return this.setStateAsync(this.dpActive, true);
                case Characteristic.Active.INACTIVE:
                    return this.setStateAsync(this.dpActive, false);
            }
        }
    }

    _getCurrentHumidifierDehumidifierState(dps) {
        const {Characteristic} = this.hap;
        return dps[this.dpActive] ? Characteristic.CurrentHumidifierDehumidifierState.HUMIDIFYING : Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }

    _getTargetHumidifierDehumidifierState() {
        const {Characteristic} = this.hap;
        return Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER;
    }

    _getWaterLevel(value) {
        if (parseFloat(value) == 0) { return 69; }
        else { return 0; }
    }

    getRotationSpeed() {
        return this._getRotationSpeed(this.getStateAsync([this.dpActive, this.dpRotationSpeed]));
    }

    _getRotationSpeed(dps) {
        if (!dps[this.dpActive]) return 0;
        if (this._hkRotationSpeed) {
            const currentRotationSpeed = this.convertRotationSpeedFromHomeKitToTuya(this._hkRotationSpeed);
            return currentRotationSpeed === dps[this.dpRotationSpeed] ? this._hkRotationSpeed : this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]);
        }
        return this._hkRotationSpeed = this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]);
    }

    setRotationSpeed(value) {
        const {Characteristic} = this.hap;

        if (value === 0) {
            return this.setStateAsync(this.dpActive, false);
        } else {
            this._hkRotationSpeed = value;
            const newSpeed = this.convertRotationSpeedFromHomeKitToTuya(value);
            const currentSpeed = this.convertRotationSpeedFromHomeKitToTuya(this.characteristicRotationSpeed.value);
            if (this.enableFlipSpeedSlider) this._hkRotationSpeed = this.convertRotationSpeedFromTuyaToHomeKit(newSpeed);

            if (newSpeed !== currentSpeed) {
                this.characteristicRotationSpeed.updateValue(this._hkRotationSpeed);
                return this.setMultiStateAsync({[this.dpActive]: true, [this.dpRotationSpeed]: newSpeed});
            } else {
                if (this.enableFlipSpeedSlider) {
                    process.nextTick(() => {
                        this.characteristicRotationSpeed.updateValue(this._hkRotationSpeed);
                    });
                }
            }
        }
    }

    convertRotationSpeedFromTuyaToHomeKit(value) {
        if (this._isBelleLife()) {
            return {[this.cmdInterval]: 1, [this.cmdLow]: 2, [this.cmdHigh]: 3}[value];
        } else if (this._isGeeni()) {
            return {[this.cmdInterval]: 1, [this.cmdContinuous]: 2}[value];
        } else if (this._isAsakuki()) {
            return {[this.cmdLow]: 1, [this.cmdHigh]: 2}[value];
        } else {
            return {[this.cmdInterval]: 1, [this.cmdContinuous]: 2}[value];
        }
    }

    convertRotationSpeedFromHomeKitToTuya(value) {
        if (this._isBelleLife()) {
            if (value < 2) return this.cmdLow;
            else if (value < 3) return this.cmdMiddle;
            else return this.cmdHigh;
        } else if (this._isGeeni()) {
            if (value < 2) return this.cmdInterval;
            else return this.cmdContinuous;
        } else if (this._isAsakuki()) {
            if (value < 2) return this.cmdLow;
            else return this.cmdHigh;
        } else {
            if (value < 2) return this.cmdLow;
            else return this.cmdHigh;
        }
    }
}

module.exports = OilDiffuserAccessory;
