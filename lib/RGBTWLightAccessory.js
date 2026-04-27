const BaseAccessory = require('./BaseAccessory');

class RGBTWLightAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.LIGHTBULB;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.Lightbulb, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic, AdaptiveLightingController} = this.hap;
        const service = this.accessory.getService(Service.Lightbulb);
        this._checkServiceName(service, this.device.context.name);

        this.dpPower = this._getCustomDP(this.device.context.dpPower) || '1';
        this.dpMode = this._getCustomDP(this.device.context.dpMode) || '2';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || '3';
        this.dpColorTemperature = this._getCustomDP(this.device.context.dpColorTemperature) || '4';
        this.dpColor = this._getCustomDP(this.device.context.dpColor) || '5';

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

        const characteristicOn = service.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpPower])
            .onGet(() => this.getStateAsync(this.dpPower))
            .onSet(value => this.setStateAsync(this.dpPower, value));

        const characteristicBrightness = service.getCharacteristic(Characteristic.Brightness)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]) : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).b)
            .onGet(() => this.getBrightness())
            .onSet(value => this.setBrightness(value));

        const characteristicColorTemperature = service.getCharacteristic(Characteristic.ColorTemperature)
            .setProps({
                minValue: this.device.context.minWhiteColor,
                maxValue: this.device.context.maxWhiteColor
            })
            .updateValue(dps[this.dpMode] === this.cmdWhite ? this.convertColorTemperatureFromTuyaToHomeKit(dps[this.dpColorTemperature]) : this.device.context.minWhiteColor)
            .onGet(() => this.getColorTemperature())
            .onSet(value => this.setColorTemperature(value));

        const characteristicHue = service.getCharacteristic(Characteristic.Hue)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? 0 : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).h)
            .onGet(() => this.getHue())
            .onSet(value => this.setHue(value));

        const characteristicSaturation = service.getCharacteristic(Characteristic.Saturation)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? 0 : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).s)
            .onGet(() => this.getSaturation())
            .onSet(value => this.setSaturation(value));

        this.characteristicHue = characteristicHue;
        this.characteristicSaturation = characteristicSaturation;
        this.characteristicColorTemperature = characteristicColorTemperature;

        if (this.adaptiveLightingSupport()) {
            this.adaptiveLightingController = new AdaptiveLightingController(service);
            this.accessory.configureController(this.adaptiveLightingController);
            this.accessory.adaptiveLightingController = this.adaptiveLightingController;
        }

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpPower) && characteristicOn.value !== changes[this.dpPower]) characteristicOn.updateValue(changes[this.dpPower]);

            switch (state[this.dpMode]) {
                case this.cmdWhite:
                    if (changes.hasOwnProperty(this.dpBrightness) && this.convertBrightnessFromHomeKitToTuya(characteristicBrightness.value) !== changes[this.dpBrightness])
                        characteristicBrightness.updateValue(this.convertBrightnessFromTuyaToHomeKit(changes[this.dpBrightness]));

                    if (changes.hasOwnProperty(this.dpColorTemperature) && this.convertColorTemperatureFromHomeKitToTuya(characteristicColorTemperature.value) !== changes[this.dpColorTemperature]) {
                        const newColorTemperature = this.convertColorTemperatureFromTuyaToHomeKit(changes[this.dpColorTemperature]);
                        const newColor = this.convertHomeKitColorTemperatureToHomeKitColor(newColorTemperature);
                        characteristicHue.updateValue(newColor.h);
                        characteristicSaturation.updateValue(newColor.s);
                        characteristicColorTemperature.updateValue(newColorTemperature);
                    } else if (changes[this.dpMode] && !changes.hasOwnProperty(this.dpColorTemperature)) {
                        const newColorTemperature = this.convertColorTemperatureFromTuyaToHomeKit(state[this.dpColorTemperature]);
                        const newColor = this.convertHomeKitColorTemperatureToHomeKitColor(newColorTemperature);
                        characteristicHue.updateValue(newColor.h);
                        characteristicSaturation.updateValue(newColor.s);
                        characteristicColorTemperature.updateValue(newColorTemperature);
                    }
                    break;

                default:
                    if (changes.hasOwnProperty(this.dpColor)) {
                        const oldColor = this.convertColorFromTuyaToHomeKit(this.convertColorFromHomeKitToTuya({
                            h: characteristicHue.value,
                            s: characteristicSaturation.value,
                            b: characteristicBrightness.value
                        }));
                        const newColor = this.convertColorFromTuyaToHomeKit(changes[this.dpColor]);

                        if (oldColor.b !== newColor.b) characteristicBrightness.updateValue(newColor.b);
                        if (oldColor.h !== newColor.h) characteristicHue.updateValue(newColor.h);
                        if (oldColor.s !== newColor.s) characteristicSaturation.updateValue(newColor.s);
                        if (characteristicColorTemperature.value !== this.device.context.minWhiteColor) characteristicColorTemperature.updateValue(this.device.context.minWhiteColor);
                    } else if (changes[this.dpMode]) {
                        if (characteristicColorTemperature.value !== this.device.context.minWhiteColor) characteristicColorTemperature.updateValue(this.device.context.minWhiteColor);
                    }
            }
        });
    }

    getBrightness() {
        if (this.device.state[this.dpMode] === this.cmdWhite) return this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpBrightness]);
        return this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).b;
    }

    setBrightness(value) {
        if (this.device.state[this.dpMode] === this.cmdWhite) return this.setStateAsync(this.dpBrightness, this.convertBrightnessFromHomeKitToTuya(value));
        return this.setStateAsync(this.dpColor, this.convertColorFromHomeKitToTuya({b: value}));
    }

    getColorTemperature() {
        this.log.debug(`getColorTemperature`);
        if (this.device.state[this.dpMode] !== this.cmdWhite) return this.device.context.minWhiteColor;
        return this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature]);
    }

    setColorTemperature(value) {
        this.log.debug(`setColorTemperature: ${value}`);
        if (value === 0) return;

        const newColor = this.convertHomeKitColorTemperatureToHomeKitColor(value);
        this.characteristicHue.updateValue(newColor.h);
        this.characteristicSaturation.updateValue(newColor.s);

        if (this.device.state[this.dpMode] !== this.cmdWhite) {
            return this.setMultiStateAsync({[this.dpMode]: this.cmdWhite, [this.dpColorTemperature]: this.convertColorTemperatureFromHomeKitToTuya(value), [this.dpBrightness]: this.convertBrightnessFromHomeKitToTuya(this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).b)});
        } else {
            return this.setMultiStateAsync({[this.dpMode]: this.cmdWhite, [this.dpColorTemperature]: this.convertColorTemperatureFromHomeKitToTuya(value)});
        }
    }

    getHue() {
        if (this.device.state[this.dpMode] === this.cmdWhite) {
            return this.convertHomeKitColorTemperatureToHomeKitColor(this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature])).h;
        }
        return this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).h;
    }

    setHue(value) {
        return this._setHueSaturation({h: value});
    }

    getSaturation() {
        if (this.device.state[this.dpMode] === this.cmdWhite) {
            return this.convertHomeKitColorTemperatureToHomeKitColor(this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature])).s;
        }
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

                if (this.device.state[this.dpMode] !== this.cmdColor)
                    props.b = this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpBrightness]);

                const isSham = props.h === 0 && props.s === 0;
                const newValue = this.convertColorFromHomeKitToTuya(props);

                if (!(this.device.state[this.dpMode] === this.cmdWhite && isSham)) {
                    this.setMultiStateAsync({[this.dpMode]: this.cmdColor, [this.dpColor]: newValue});
                }
                this.characteristicColorTemperature.updateValue(this.device.context.minWhiteColor);

                resolvers.forEach(r => r());
            }, 500);
        });
    }

    getControllers() {
        return this.adaptiveLightingController ? [this.adaptiveLightingController] : [];
    }
}

module.exports = RGBTWLightAccessory;
