const BaseAccessory = require('./BaseAccessory');

const DEFAULT_MIN_WHITE_COLOR = 0;
const DEFAULT_MAX_WHITE_COLOR = 600;

class TWLightAccessory extends BaseAccessory {
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
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || '2';
        this.dpColorTemperature = this._getCustomDP(this.device.context.dpColorTemperature) || '3';

        const characteristicOn = service.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpPower])
            .onGet(() => this.getStateAsync(this.dpPower))
            .onSet(value => this.setStateAsync(this.dpPower, value));

        const characteristicBrightness = service.getCharacteristic(Characteristic.Brightness)
            .updateValue(this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]))
            .onGet(() => this.getBrightness())
            .onSet(value => this.setBrightness(value));

        const characteristicColorTemperature = service.getCharacteristic(Characteristic.ColorTemperature)
            .setProps({
                minValue: this.device.context.minWhiteColor ?? DEFAULT_MIN_WHITE_COLOR,
                maxValue: this.device.context.maxWhiteColor ?? DEFAULT_MAX_WHITE_COLOR
            })
            .updateValue(this.convertColorTemperatureFromTuyaToHomeKit(dps[this.dpColorTemperature]))
            .onGet(() => this.getColorTemperature())
            .onSet(value => this.setColorTemperature(value));

        this.characteristicColorTemperature = characteristicColorTemperature;

        if (this.adaptiveLightingSupport()) {
            this.adaptiveLightingController = new AdaptiveLightingController(service);
            this.accessory.configureController(this.adaptiveLightingController);
            this.accessory.adaptiveLightingController = this.adaptiveLightingController;
        }

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpPower) && characteristicOn.value !== changes[this.dpPower]) characteristicOn.updateValue(changes[this.dpPower]);

            if (changes.hasOwnProperty(this.dpBrightness) && this.convertBrightnessFromHomeKitToTuya(characteristicBrightness.value) !== changes[this.dpBrightness])
                characteristicBrightness.updateValue(this.convertBrightnessFromTuyaToHomeKit(changes[this.dpBrightness]));

            if (changes.hasOwnProperty(this.dpColorTemperature)) {
                if (this.convertColorTemperatureFromHomeKitToTuya(characteristicColorTemperature.value) !== changes[this.dpColorTemperature])
                    characteristicColorTemperature.updateValue(this.convertColorTemperatureFromTuyaToHomeKit(changes[this.dpColorTemperature]));
            } else if (changes[this.dpBrightness]) {
                characteristicColorTemperature.updateValue(this.convertColorTemperatureFromTuyaToHomeKit(state[this.dpColorTemperature]));
            }
        });
    }

    getBrightness() {
        return this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpBrightness]);
    }

    setBrightness(value) {
        return this.setStateAsync(this.dpBrightness, this.convertBrightnessFromHomeKitToTuya(value));
    }

    getColorTemperature() {
        return this.convertColorTemperatureFromTuyaToHomeKit(this.device.state[this.dpColorTemperature]);
    }

    setColorTemperature(value) {
        if (value === 0) return;
        return this.setStateAsync(this.dpColorTemperature, this.convertColorTemperatureFromHomeKitToTuya(value));
    }
}

module.exports = TWLightAccessory;
