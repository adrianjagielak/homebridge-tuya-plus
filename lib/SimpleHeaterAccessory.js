const BaseAccessory = require('./BaseAccessory');

class SimpleHeaterAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.AIR_HEATER;
    }

    constructor(...props) {
        super(...props);
        this.currentHeaterCoolerState = 0;
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.HeaterCooler, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.HeaterCooler);
        this._checkServiceName(service, this.device.context.name);

        this.dpActive = this._getCustomDP(this.device.context.dpActive) || '1';
        this.dpDesiredTemperature = this._getCustomDP(this.device.context.dpDesiredTemperature) || '2';
        this.dpCurrentTemperature = this._getCustomDP(this.device.context.dpCurrentTemperature) || '3';
        this.temperatureDivisor = parseInt(this.device.context.temperatureDivisor) || 1;
        this.thresholdTemperatureDivisor = parseInt(this.device.context.thresholdTemperatureDivisor) || 1;
        this.temperatureOffset = parseInt(this.device.context.temperatureOffset) || 0;

        const characteristicActive = service.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(dps[this.dpActive]))
            .onGet(() => this.getActive())
            .onSet(value => this.setActive(value));

        const characteristicCurrentHeaterCoolerState = service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .updateValue(this._getCurrentHeaterCoolerState(dps))
            .onGet(() => this.currentHeaterCoolerState);

        service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({
                minValue: 1,
                maxValue: 1,
                validValues: [Characteristic.TargetHeaterCoolerState.HEAT]
            })
            .updateValue(this._getTargetHeaterCoolerState())
            .onGet(() => this._getTargetHeaterCoolerState())
            .onSet(() => this.setStateAsync(this.dpActive, true));

        const characteristicCurrentTemperature = service.getCharacteristic(Characteristic.CurrentTemperature)
            .updateValue(this._getDividedState(dps[this.dpCurrentTemperature], this.temperatureDivisor))
            .onGet(() => this.getDividedStateAsync(this.dpCurrentTemperature, this.temperatureDivisor));

        const characteristicHeatingThresholdTemperature = service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: this.device.context.minTemperature || 15,
                maxValue: this.device.context.maxTemperature || 35,
                minStep: this.device.context.minTemperatureSteps || 1
            })
            .updateValue(this._getDividedState(dps[this.dpDesiredTemperature], this.thresholdTemperatureDivisor))
            .onGet(() => this.getDividedStateAsync(this.dpDesiredTemperature, this.thresholdTemperatureDivisor))
            .onSet(value => this.setTargetThresholdTemperature(value));

        this.characteristicHeatingThresholdTemperature = characteristicHeatingThresholdTemperature;

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpActive)) {
                const newActive = this._getActive(changes[this.dpActive]);
                if (characteristicActive.value !== newActive) {
                    characteristicActive.updateValue(newActive);
                }
            }

            if (changes.hasOwnProperty(this.dpDesiredTemperature)) {
                if (characteristicHeatingThresholdTemperature.value !== changes[this.dpDesiredTemperature])
                    characteristicHeatingThresholdTemperature.updateValue(this._getDividedState(changes[this.dpDesiredTemperature], this.thresholdTemperatureDivisor));
            }

            if (changes.hasOwnProperty(this.dpCurrentTemperature) && characteristicCurrentTemperature.value !== changes[this.dpCurrentTemperature])
                characteristicCurrentTemperature.updateValue(this._getDividedState(changes[this.dpCurrentTemperature], this.temperatureDivisor));

            characteristicCurrentHeaterCoolerState.updateValue(this._getCurrentHeaterCoolerState(state));
            this.log.info('SimpleHeater changed: ' + JSON.stringify(state));
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
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.Active.ACTIVE:
                return this.setStateAsync(this.dpActive, true);
            case Characteristic.Active.INACTIVE:
                return this.setStateAsync(this.dpActive, false);
        }
    }

    _getCurrentHeaterCoolerState(dps) {
        const {Characteristic} = this.hap;
        if (dps[this.dpActive]) {
            if (dps[this.dpCurrentTemperature] < dps[this.dpDesiredTemperature]) {
                this.currentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.HEATING;
            }
            if (dps[this.dpCurrentTemperature] > dps[this.dpDesiredTemperature]) {
                this.currentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.IDLE;
            }
        } else {
            this.currentHeaterCoolerState = Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }
        return this.currentHeaterCoolerState;
    }

    _getTargetHeaterCoolerState() {
        const {Characteristic} = this.hap;
        return Characteristic.TargetHeaterCoolerState.HEAT;
    }

    async setTargetThresholdTemperature(value) {
        await this.setStateAsync(this.dpDesiredTemperature, (value - this.temperatureOffset) * this.thresholdTemperatureDivisor);
        if (this.characteristicHeatingThresholdTemperature) {
            this.characteristicHeatingThresholdTemperature.updateValue(value);
        }
    }

    _getDividedState(dp, divisor) {
        return ((parseFloat(dp) / divisor) + this.temperatureOffset) || 0;
    }
}

module.exports = SimpleHeaterAccessory;
