const BaseAccessory = require('./BaseAccessory');

class RGBTWOutletAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.OUTLET;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        this._verifyCachedPlatformAccessory();
        this._justRegistered = true;

        super._registerPlatformAccessory();
    }

    _verifyCachedPlatformAccessory() {
        if (this._justRegistered) return;

        const {Service} = this.hap;

        const outletName = 'Outlet - ' + this.device.context.name;
        let outletService = this.accessory.getServiceById(Service.Outlet.UUID, 'outlet');
        if (outletService) this._checkServiceName(outletService, outletName);
        else outletService = this.accessory.addService(Service.Outlet, outletName, 'outlet');

        const lightName = 'RGBTWLight - ' + this.device.context.name;
        let lightService = this.accessory.getServiceById(Service.Lightbulb.UUID, 'lightbulb');
        if (lightService) this._checkServiceName(lightService, lightName);
        else lightService = this.accessory.addService(Service.Lightbulb, lightName, 'lightbulb');

        this.accessory.services
            .forEach(service => {
                if ((service.UUID === Service.Outlet.UUID && service !== outletService) || (service.UUID === Service.Lightbulb.UUID && service !== lightService))
                    this.accessory.removeService(service);
            });
    }

    _registerCharacteristics(dps) {
        this._verifyCachedPlatformAccessory();

        const {Service, Characteristic, EnergyCharacteristics} = this.hap;

        const outletService = this.accessory.getServiceById(Service.Outlet.UUID, 'outlet');
        const lightService = this.accessory.getServiceById(Service.Lightbulb.UUID, 'lightbulb');

        this.dpLight = this._getCustomDP(this.device.context.dpLight) || '1';
        this.dpMode = this._getCustomDP(this.device.context.dpMode) || '2';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || '3';
        this.dpColorTemperature = this._getCustomDP(this.device.context.dpColorTemperature) || '4';
        this.dpColor = this._getCustomDP(this.device.context.dpColor) || '5';
        this.dpPower = this._getCustomDP(this.device.context.dpPower) || '101';

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

        const energyKeys = {
            volts: this._getCustomDP(this.device.context.voltsId),
            voltsDivisor: parseInt(this.device.context.voltsDivisor) || 10,
            amps: this._getCustomDP(this.device.context.ampsId),
            ampsDivisor: parseInt(this.device.context.ampsDivisor) || 1000,
            watts: this._getCustomDP(this.device.context.wattsId),
            wattsDivisor: parseInt(this.device.context.wattsDivisor) || 10
        };

        const characteristicLightOn = lightService.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpLight])
            .onGet(() => this.getStateAsync(this.dpLight))
            .onSet(value => this.setStateAsync(this.dpLight, value));

        const characteristicBrightness = lightService.getCharacteristic(Characteristic.Brightness)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]) : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).b)
            .onGet(() => this.getBrightness())
            .onSet(value => this.setBrightness(value));

        const characteristicColorTemperature = lightService.getCharacteristic(Characteristic.ColorTemperature)
            .setProps({ minValue: 0, maxValue: 600 })
            .updateValue(dps[this.dpMode] === this.cmdWhite ? this.convertColorTemperatureFromTuyaToHomeKit(dps[this.dpColorTemperature]) : 0)
            .onGet(() => this.getColorTemperature())
            .onSet(value => this.setColorTemperature(value));

        const characteristicHue = lightService.getCharacteristic(Characteristic.Hue)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? 0 : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).h)
            .onGet(() => this.getHue())
            .onSet(value => this.setHue(value));

        const characteristicSaturation = lightService.getCharacteristic(Characteristic.Saturation)
            .updateValue(dps[this.dpMode] === this.cmdWhite ? 0 : this.convertColorFromTuyaToHomeKit(dps[this.dpColor]).s)
            .onGet(() => this.getSaturation())
            .onSet(value => this.setSaturation(value));

        this.characteristicHue = characteristicHue;
        this.characteristicSaturation = characteristicSaturation;
        this.characteristicColorTemperature = characteristicColorTemperature;

        let characteristicVolts;
        if (energyKeys.volts) {
            characteristicVolts = outletService.getCharacteristic(EnergyCharacteristics.Volts)
                .updateValue(this._getDividedState(dps[energyKeys.volts], energyKeys.voltsDivisor))
                .onGet(() => this.getDividedStateAsync(energyKeys.volts, energyKeys.voltsDivisor));
        } else this._removeCharacteristic(outletService, EnergyCharacteristics.Volts);

        let characteristicAmps;
        if (energyKeys.amps) {
            characteristicAmps = outletService.getCharacteristic(EnergyCharacteristics.Amperes)
                .updateValue(this._getDividedState(dps[energyKeys.amps], energyKeys.ampsDivisor))
                .onGet(() => this.getDividedStateAsync(energyKeys.amps, energyKeys.ampsDivisor));
        } else this._removeCharacteristic(outletService, EnergyCharacteristics.Amperes);

        let characteristicWatts;
        if (energyKeys.watts) {
            characteristicWatts = outletService.getCharacteristic(EnergyCharacteristics.Watts)
                .updateValue(this._getDividedState(dps[energyKeys.watts], energyKeys.wattsDivisor))
                .onGet(() => this.getDividedStateAsync(energyKeys.watts, energyKeys.wattsDivisor));
        } else this._removeCharacteristic(outletService, EnergyCharacteristics.Watts);

        const characteristicOutletOn = outletService.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpPower])
            .onGet(() => this.getStateAsync(this.dpPower))
            .onSet(value => this.setStateAsync(this.dpPower, value));

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpLight) && characteristicLightOn.value !== changes[this.dpLight]) characteristicLightOn.updateValue(changes[this.dpLight]);

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
                        if (oldColor.s !== newColor.s) characteristicSaturation.updateValue(newColor.h);
                        if (characteristicColorTemperature.value !== 0) characteristicColorTemperature.updateValue(0);
                    } else if (changes[this.dpMode]) {
                        if (characteristicColorTemperature.value !== 0) characteristicColorTemperature.updateValue(0);
                    }
            }

            if (changes.hasOwnProperty(this.dpPower) && characteristicOutletOn.value !== changes[this.dpPower]) characteristicOutletOn.updateValue(changes[this.dpPower]);

            if (changes.hasOwnProperty(energyKeys.volts) && characteristicVolts) {
                const newVolts = this._getDividedState(changes[energyKeys.volts], energyKeys.voltsDivisor);
                if (characteristicVolts.value !== newVolts) characteristicVolts.updateValue(newVolts);
            }

            if (changes.hasOwnProperty(energyKeys.amps) && characteristicAmps) {
                const newAmps = this._getDividedState(changes[energyKeys.amps], energyKeys.ampsDivisor);
                if (characteristicAmps.value !== newAmps) characteristicAmps.updateValue(newAmps);
            }

            if (changes.hasOwnProperty(energyKeys.watts) && characteristicWatts) {
                const newWatts = this._getDividedState(changes[energyKeys.watts], energyKeys.wattsDivisor);
                if (characteristicWatts.value !== newWatts) characteristicWatts.updateValue(newWatts);
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
        if (this.device.state[this.dpMode] !== this.cmdWhite) return 0;
        return this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature]);
    }

    setColorTemperature(value) {
        if (value === 0) return;

        const newColor = this.convertHomeKitColorTemperatureToHomeKitColor(value);
        this.characteristicHue.updateValue(newColor.h);
        this.characteristicSaturation.updateValue(newColor.s);

        return this.setMultiStateAsync({[this.dpMode]: this.cmdWhite, [this.dpColorTemperature]: this.convertColorTemperatureFromHomeKitToTuya(value)});
    }

    getHue() {
        if (this.device.state[this.dpMode] === this.cmdWhite) return 0;
        return this.convertColorFromTuyaToHomeKit(this.device.state[this.dpColor]).h;
    }

    setHue(value) {
        return this._setHueSaturation({h: value});
    }

    getSaturation() {
        if (this.device.state[this.dpMode] === this.cmdWhite) return 0;
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

                const isSham = props.h === 0 && props.s === 0;
                const newValue = this.convertColorFromHomeKitToTuya(props);

                if (!(this.device.state[this.dpMode] === this.cmdWhite && isSham)) {
                    this.setMultiStateAsync({[this.dpMode]: this.cmdColor, [this.dpColor]: newValue});
                }
                this.characteristicColorTemperature.updateValue(0);

                resolvers.forEach(r => r());
            }, 500);
        });
    }
}

module.exports = RGBTWOutletAccessory;
