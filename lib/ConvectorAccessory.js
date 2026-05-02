const BaseAccessory = require('./BaseAccessory');

class ConvectorAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.AIR_HEATER;
    }

    constructor(...props) {
        super(...props);
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

        this.dpActive = this._getCustomDP(this.device.context.dpActive) || '7';
        this.dpDesiredTemperature = this._getCustomDP(this.device.context.dpDesiredTemperature) || '2';
        this.dpCurrentTemperature = this._getCustomDP(this.device.context.dpCurrentTemperature) || '3';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '4';
        this.dpChildLock = this._getCustomDP(this.device.context.dpChildLock) || '6';
        this.dpTemperatureDisplayUnits = this._getCustomDP(this.device.context.dpTemperatureDisplayUnits) || '19';

        this.cmdLow = 'LOW';
        if (this.device.context.cmdLow) {
            if (/^[a-z0-9]+$/i.test(this.device.context.cmdLow)) this.cmdLow = ('' + this.device.context.cmdLow).trim();
            else throw new Error('The cmdLow doesn\'t appear to be valid: ' + this.device.context.cmdLow);
        }

        this.cmdHigh = 'HIGH';
        if (this.device.context.cmdHigh) {
            if (/^[a-z0-9]+$/i.test(this.device.context.cmdHigh)) this.cmdHigh = ('' + this.device.context.cmdHigh).trim();
            else throw new Error('The cmdHigh doesn\'t appear to be valid: ' + this.device.context.cmdHigh);
        }

        this.enableFlipSpeedSlider = !!this.device.context.enableFlipSpeedSlider;

        const characteristicActive = service.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(dps[this.dpActive]))
            .onGet(() => this.getActive())
            .onSet(value => this.setActive(value));

        service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .updateValue(this._getCurrentHeaterCoolerState(dps))
            .onGet(() => this.getCurrentHeaterCoolerState());

        service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ minValue: 1, maxValue: 1, validValues: [Characteristic.TargetHeaterCoolerState.HEAT] })
            .updateValue(this._getTargetHeaterCoolerState())
            .onGet(() => this._getTargetHeaterCoolerState())
            .onSet(() => this.setStateAsync(this.dpActive, true));

        const characteristicCurrentTemperature = service.getCharacteristic(Characteristic.CurrentTemperature)
            .updateValue(dps[this.dpCurrentTemperature])
            .onGet(() => this.getStateAsync(this.dpCurrentTemperature));

        const characteristicHeatingThresholdTemperature = service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: this.device.context.minTemperature || 15,
                maxValue: this.device.context.maxTemperature || 35,
                minStep: this.device.context.minTemperatureSteps || 1
            })
            .updateValue(dps[this.dpDesiredTemperature])
            .onGet(() => this.getStateAsync(this.dpDesiredTemperature))
            .onSet(value => this.setTargetThresholdTemperature(value));

        let characteristicTemperatureDisplayUnits;
        if (!this.device.context.noTemperatureUnit) {
            characteristicTemperatureDisplayUnits = service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                .updateValue(this._getTemperatureDisplayUnits(dps[this.dpTemperatureDisplayUnits]))
                .onGet(() => this.getTemperatureDisplayUnits())
                .onSet(value => this.setTemperatureDisplayUnits(value));
        } else this._removeCharacteristic(service, Characteristic.TemperatureDisplayUnits);

        let characteristicLockPhysicalControls;
        if (!this.device.context.noChildLock) {
            characteristicLockPhysicalControls = service.getCharacteristic(Characteristic.LockPhysicalControls)
                .updateValue(this._getLockPhysicalControls(dps[this.dpChildLock]))
                .onGet(() => this.getLockPhysicalControls())
                .onSet(value => this.setLockPhysicalControls(value));
        } else this._removeCharacteristic(service, Characteristic.LockPhysicalControls);

        const characteristicRotationSpeed = service.getCharacteristic(Characteristic.RotationSpeed)
            .updateValue(this._getRotationSpeed(dps))
            .onGet(() => this.getRotationSpeed())
            .onSet(value => this.setRotationSpeed(value));

        this.characteristicActive = characteristicActive;
        this.characteristicHeatingThresholdTemperature = characteristicHeatingThresholdTemperature;
        this.characteristicRotationSpeed = characteristicRotationSpeed;

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpActive)) {
                const newActive = this._getActive(changes[this.dpActive]);
                if (characteristicActive.value !== newActive) {
                    characteristicActive.updateValue(newActive);
                    if (!changes.hasOwnProperty(this.dpRotationSpeed)) characteristicRotationSpeed.updateValue(this._getRotationSpeed(state));
                }
            }

            if (characteristicLockPhysicalControls && changes.hasOwnProperty(this.dpChildLock)) {
                const newLockPhysicalControls = this._getLockPhysicalControls(changes[this.dpChildLock]);
                if (characteristicLockPhysicalControls.value !== newLockPhysicalControls) characteristicLockPhysicalControls.updateValue(newLockPhysicalControls);
            }

            if (changes.hasOwnProperty(this.dpDesiredTemperature)) {
                if (characteristicHeatingThresholdTemperature.value !== changes[this.dpDesiredTemperature])
                    characteristicHeatingThresholdTemperature.updateValue(changes[this.dpDesiredTemperature]);
            }

            if (changes.hasOwnProperty(this.dpCurrentTemperature) && characteristicCurrentTemperature.value !== changes[this.dpCurrentTemperature])
                characteristicCurrentTemperature.updateValue(changes[this.dpCurrentTemperature]);

            if (characteristicTemperatureDisplayUnits && changes.hasOwnProperty(this.dpTemperatureDisplayUnits)) {
                const newTemperatureDisplayUnits = this._getTemperatureDisplayUnits(changes[this.dpTemperatureDisplayUnits]);
                if (characteristicTemperatureDisplayUnits.value !== newTemperatureDisplayUnits) characteristicTemperatureDisplayUnits.updateValue(newTemperatureDisplayUnits);
            }

            if (changes.hasOwnProperty(this.dpRotationSpeed)) {
                const newRotationSpeed = this._getRotationSpeed(state);
                if (characteristicRotationSpeed.value !== newRotationSpeed) characteristicRotationSpeed.updateValue(newRotationSpeed);
            }
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

    getLockPhysicalControls() {
        return this._getLockPhysicalControls(this.getStateAsync(this.dpChildLock));
    }

    _getLockPhysicalControls(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
    }

    setLockPhysicalControls(value) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED:
                return this.setStateAsync(this.dpChildLock, true);
            case Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED:
                return this.setStateAsync(this.dpChildLock, false);
        }
    }

    getCurrentHeaterCoolerState() {
        return this._getCurrentHeaterCoolerState(this.getStateAsync([this.dpActive]));
    }

    _getCurrentHeaterCoolerState(dps) {
        const {Characteristic} = this.hap;
        return dps[this.dpActive] ? Characteristic.CurrentHeaterCoolerState.HEATING : Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }

    _getTargetHeaterCoolerState() {
        const {Characteristic} = this.hap;
        return Characteristic.TargetHeaterCoolerState.HEAT;
    }

    async setTargetThresholdTemperature(value) {
        await this.setStateAsync(this.dpDesiredTemperature, value);
        if (this.characteristicHeatingThresholdTemperature) {
            this.characteristicHeatingThresholdTemperature.updateValue(value);
        }
    }

    getTemperatureDisplayUnits() {
        return this._getTemperatureDisplayUnits(this.getStateAsync(this.dpTemperatureDisplayUnits));
    }

    _getTemperatureDisplayUnits(dp) {
        const {Characteristic} = this.hap;
        return dp === 'F' ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    setTemperatureDisplayUnits(value) {
        const {Characteristic} = this.hap;
        return this.setStateAsync(this.dpTemperatureDisplayUnits, value === Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C');
    }

    getRotationSpeed() {
        return this._getRotationSpeed(this.getStateAsync([this.dpActive, this.dpRotationSpeed]));
    }

    _getRotationSpeed(dps) {
        if (!dps[this.dpActive]) return 0;
        if (this._hkRotationSpeed) {
            const currntRotationSpeed = this.convertRotationSpeedFromHomeKitToTuya(this._hkRotationSpeed);
            return currntRotationSpeed === dps[this.dpRotationSpeed] ? this._hkRotationSpeed : this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]);
        }
        return this._hkRotationSpeed = this.convertRotationSpeedFromTuyaToHomeKit(dps[this.dpRotationSpeed]);
    }

    setRotationSpeed(value) {
        const {Characteristic} = this.hap;
        if (value === 0) {
            return this.setActive(Characteristic.Active.INACTIVE);
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
                    process.nextTick(() => { this.characteristicRotationSpeed.updateValue(this._hkRotationSpeed); });
                }
            }
        }
    }

    convertRotationSpeedFromTuyaToHomeKit(value) {
        return {[this.cmdLow]: 1, [this.cmdHigh]: 100}[value];
    }

    convertRotationSpeedFromHomeKitToTuya(value) {
        return value < 50 ? this.cmdLow : this.cmdHigh;
    }
}

module.exports = ConvectorAccessory;
