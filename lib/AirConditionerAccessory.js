const BaseAccessory = require('./BaseAccessory');

const STATE_OTHER = 9;

class AirConditionerAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.AIR_CONDITIONER;
    }

    constructor(...props) {
        super(...props);

        this.cmdCool = 'COOL';
        if (this.device.context.cmdCool) {
            if (/^c[a-z]+$/i.test(this.device.context.cmdCool)) this.cmdCool = ('' + this.device.context.cmdCool).trim();
            else throw new Error('The cmdCool doesn\'t appear to be valid: ' + this.device.context.cmdCool);
        }

        this.cmdHeat = 'HEAT';
        if (this.device.context.cmdHeat) {
            if (/^h[a-z]+$/i.test(this.device.context.cmdHeat)) this.cmdHeat = ('' + this.device.context.cmdHeat).trim();
            else throw new Error('The cmdHeat doesn\'t appear to be valid: ' + this.device.context.cmdHeat);
        }

        this.cmdAuto = 'AUTO';
        if (this.device.context.cmdAuto) {
            if (/^a[a-z]+$/i.test(this.device.context.cmdAuto)) this.cmdAuto = ('' + this.device.context.cmdAuto).trim();
            else throw new Error('The cmdAuto doesn\'t appear to be valid: ' + this.device.context.cmdAuto);
        }

        this.device.context.noAuto = true;

        if (!this.device.context.noRotationSpeed) {
            const fanSpeedSteps = (this.device.context.fanSpeedSteps && isFinite(this.device.context.fanSpeedSteps) && this.device.context.fanSpeedSteps > 0 && this.device.context.fanSpeedSteps < 100) ? this.device.context.fanSpeedSteps : 100;
            this._rotationSteps = [0];
            this._rotationStops = {0: 0};
            for (let i = 0; i++ < 100;) {
                const _rotationStep = Math.floor(fanSpeedSteps * (i - 1) / 100) + 1;
                this._rotationSteps.push(_rotationStep);
                this._rotationStops[_rotationStep] = i;
            }
        }
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
        this.dpThreshold = this._getCustomDP(this.device.context.dpThreshold) || '2';
        this.dpCurrentTemperature = this._getCustomDP(this.device.context.dpCurrentTemperature) || '3';
        this.dpMode = this._getCustomDP(this.device.context.dpMode) || '4';
        this.dpRotationSpeed = this._getCustomDP(this.device.context.dpRotationSpeed) || '5';
        this.dpChildLock = this._getCustomDP(this.device.context.dpChildLock) || '6';
        this.dpTempUnits = this._getCustomDP(this.device.context.dpTempUnits) || '19';
        this.dpSwingMode = this._getCustomDP(this.device.context.dpSwingMode) || '104';

        const characteristicActive = service.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(this.dpActive))
            .onGet(() => this.getActive())
            .onSet(value => this.setActive(value));

        const characteristicCurrentHeaterCoolerState = service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .updateValue(this._getCurrentHeaterCoolerState(dps))
            .onGet(() => this.getCurrentHeaterCoolerState());

        const _validTargetHeaterCoolerStateValues = [STATE_OTHER];
        if (!this.device.context.noCool) _validTargetHeaterCoolerStateValues.unshift(Characteristic.TargetHeaterCoolerState.COOL);
        if (!this.device.context.noHeat) _validTargetHeaterCoolerStateValues.unshift(Characteristic.TargetHeaterCoolerState.HEAT);
        if (!this.device.context.noAuto) _validTargetHeaterCoolerStateValues.unshift(Characteristic.TargetHeaterCoolerState.AUTO);

        const characteristicTargetHeaterCoolerState = service.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ maxValue: 9, validValues: _validTargetHeaterCoolerStateValues })
            .updateValue(this._getTargetHeaterCoolerState(dps[this.dpMode]))
            .onGet(() => this.getTargetHeaterCoolerState())
            .onSet(value => this.setTargetHeaterCoolerState(value));

        const characteristicCurrentTemperature = service.getCharacteristic(Characteristic.CurrentTemperature)
            .updateValue(dps[this.dpCurrentTemperature])
            .onGet(() => this.getStateAsync(this.dpCurrentTemperature));

        let characteristicSwingMode;
        if (!this.device.context.noSwing) {
            characteristicSwingMode = service.getCharacteristic(Characteristic.SwingMode)
                .updateValue(this._getSwingMode(dps[this.dpSwingMode]))
                .onGet(() => this.getSwingMode())
                .onSet(value => this.setSwingMode(value));
        } else this._removeCharacteristic(service, Characteristic.SwingMode);

        let characteristicLockPhysicalControls;
        if (!this.device.context.noChildLock) {
            characteristicLockPhysicalControls = service.getCharacteristic(Characteristic.LockPhysicalControls)
                .updateValue(this._getLockPhysicalControls(dps[this.dpChildLock]))
                .onGet(() => this.getLockPhysicalControls())
                .onSet(value => this.setLockPhysicalControls(value));
        } else this._removeCharacteristic(service, Characteristic.LockPhysicalControls);

        let characteristicCoolingThresholdTemperature;
        if (!this.device.context.noCool) {
            characteristicCoolingThresholdTemperature = service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
                .setProps({
                    minValue: this.device.context.minTemperature || 10,
                    maxValue: this.device.context.maxTemperature || 35,
                    minStep: this.device.context.minTemperatureSteps || 1
                })
                .updateValue(this.dpThreshold)
                .onGet(() => this.getStateAsync(this.dpThreshold))
                .onSet(value => this.setTargetThresholdTemperature('cool', value));
        } else this._removeCharacteristic(service, Characteristic.CoolingThresholdTemperature);

        let characteristicHeatingThresholdTemperature;
        if (!this.device.context.noHeat) {
            characteristicHeatingThresholdTemperature = service.getCharacteristic(Characteristic.HeatingThresholdTemperature)
                .setProps({
                    minValue: this.device.context.minTemperature || 10,
                    maxValue: this.device.context.maxTemperature || 35,
                    minStep: this.device.context.minTemperatureSteps || 1
                })
                .updateValue(dps[this.dpThreshold])
                .onGet(() => this.getStateAsync(this.dpThreshold))
                .onSet(value => this.setTargetThresholdTemperature('heat', value));
        } else this._removeCharacteristic(service, Characteristic.HeatingThresholdTemperature);

        const characteristicTemperatureDisplayUnits = service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .updateValue(this._getTemperatureDisplayUnits(dps[this.dpTempUnits]))
            .onGet(() => this.getTemperatureDisplayUnits())
            .onSet(value => this.setTemperatureDisplayUnits(value));

        let characteristicRotationSpeed;
        if (!this.device.context.noRotationSpeed) {
            characteristicRotationSpeed = service.getCharacteristic(Characteristic.RotationSpeed)
                .updateValue(this._getRotationSpeed(dps))
                .onGet(() => this.getRotationSpeed())
                .onSet(value => this.setRotationSpeed(value));
        } else this._removeCharacteristic(service, Characteristic.RotationSpeed);

        this.characteristicCoolingThresholdTemperature = characteristicCoolingThresholdTemperature;
        this.characteristicHeatingThresholdTemperature = characteristicHeatingThresholdTemperature;

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.dpActive)) {
                const newActive = this._getActive(changes[this.dpActive]);
                if (characteristicActive.value !== newActive) {
                    characteristicActive.updateValue(newActive);
                    if (!changes.hasOwnProperty(this.dpMode)) characteristicCurrentHeaterCoolerState.updateValue(this._getCurrentHeaterCoolerState(state));
                    if (!changes.hasOwnProperty(this.dpRotationSpeed)) characteristicRotationSpeed && characteristicRotationSpeed.updateValue(this._getRotationSpeed(state));
                }
            }

            if (characteristicLockPhysicalControls && changes.hasOwnProperty(this.dpChildLock)) {
                const newLockPhysicalControls = this._getLockPhysicalControls(changes[this.dpChildLock]);
                if (characteristicLockPhysicalControls.value !== newLockPhysicalControls) characteristicLockPhysicalControls.updateValue(newLockPhysicalControls);
            }

            if (changes.hasOwnProperty(this.dpThreshold)) {
                if (!this.device.context.noCool && characteristicCoolingThresholdTemperature && characteristicCoolingThresholdTemperature.value !== changes[this.dpThreshold])
                    characteristicCoolingThresholdTemperature.updateValue(changes[this.dpThreshold]);
                if (!this.device.context.noHeat && characteristicHeatingThresholdTemperature && characteristicHeatingThresholdTemperature.value !== changes[this.dpThreshold])
                    characteristicHeatingThresholdTemperature.updateValue(changes[this.dpThreshold]);
            }

            if (changes.hasOwnProperty(this.dpCurrentTemperature) && characteristicCurrentTemperature.value !== changes[this.dpCurrentTemperature])
                characteristicCurrentTemperature.updateValue(changes[this.dpCurrentTemperature]);

            if (changes.hasOwnProperty(this.dpMode)) {
                const newTargetHeaterCoolerState = this._getTargetHeaterCoolerState(changes[this.dpMode]);
                const newCurrentHeaterCoolerState = this._getCurrentHeaterCoolerState(state);
                if (characteristicTargetHeaterCoolerState.value !== newTargetHeaterCoolerState) characteristicTargetHeaterCoolerState.updateValue(newTargetHeaterCoolerState);
                if (characteristicCurrentHeaterCoolerState.value !== newCurrentHeaterCoolerState) characteristicCurrentHeaterCoolerState.updateValue(newCurrentHeaterCoolerState);
            }

            if (characteristicSwingMode && changes.hasOwnProperty(this.dpSwingMode)) {
                const newSwingMode = this._getSwingMode(changes[this.dpSwingMode]);
                if (characteristicSwingMode.value !== newSwingMode) characteristicSwingMode.updateValue(newSwingMode);
            }

            if (changes.hasOwnProperty(this.dpTempUnits)) {
                const newTemperatureDisplayUnits = this._getTemperatureDisplayUnits(changes[this.dpTempUnits]);
                if (characteristicTemperatureDisplayUnits.value !== newTemperatureDisplayUnits) characteristicTemperatureDisplayUnits.updateValue(newTemperatureDisplayUnits);
            }

            if (changes.hasOwnProperty(this.dpRotationSpeed)) {
                const newRotationSpeed = this._getRotationSpeed(state);
                if (characteristicRotationSpeed && characteristicRotationSpeed.value !== newRotationSpeed) characteristicRotationSpeed.updateValue(newRotationSpeed);
                if (!changes.hasOwnProperty(this.dpMode)) characteristicCurrentHeaterCoolerState.updateValue(this._getCurrentHeaterCoolerState(state));
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
        return this._getCurrentHeaterCoolerState(this.getStateAsync([this.dpActive, this.dpMode]));
    }

    _getCurrentHeaterCoolerState(dps) {
        const {Characteristic} = this.hap;
        if (!dps[this.dpActive]) return Characteristic.CurrentHeaterCoolerState.INACTIVE;
        switch (dps[this.dpMode]) {
            case this.cmdCool: return Characteristic.CurrentHeaterCoolerState.COOLING;
            case this.cmdHeat: return Characteristic.CurrentHeaterCoolerState.HEATING;
            default: return Characteristic.CurrentHeaterCoolerState.IDLE;
        }
    }

    getTargetHeaterCoolerState() {
        return this._getTargetHeaterCoolerState(this.getStateAsync(this.dpMode));
    }

    _getTargetHeaterCoolerState(dp) {
        const {Characteristic} = this.hap;
        switch (dp) {
            case this.cmdCool:
                if (this.device.context.noCool) return STATE_OTHER;
                return Characteristic.TargetHeaterCoolerState.COOL;
            case this.cmdHeat:
                if (this.device.context.noHeat) return STATE_OTHER;
                return Characteristic.TargetHeaterCoolerState.HEAT;
            case this.cmdAuto:
                if (this.device.context.noAuto) return STATE_OTHER;
                return Characteristic.TargetHeaterCoolerState.AUTO;
            default:
                return STATE_OTHER;
        }
    }

    setTargetHeaterCoolerState(value) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.TargetHeaterCoolerState.COOL:
                if (this.device.context.noCool) return;
                return this.setStateAsync(this.dpMode, this.cmdCool);
            case Characteristic.TargetHeaterCoolerState.HEAT:
                if (this.device.context.noHeat) return;
                return this.setStateAsync(this.dpMode, this.cmdHeat);
            case Characteristic.TargetHeaterCoolerState.AUTO:
                if (this.device.context.noAuto) return;
                return this.setStateAsync(this.dpMode, this.cmdAuto);
        }
    }

    getSwingMode() {
        return this._getSwingMode(this.getStateAsync(this.dpSwingMode));
    }

    _getSwingMode(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
    }

    setSwingMode(value) {
        if (this.device.context.noSwing) return;
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.SwingMode.SWING_ENABLED:
                return this.setStateAsync(this.dpSwingMode, true);
            case Characteristic.SwingMode.SWING_DISABLED:
                return this.setStateAsync(this.dpSwingMode, false);
        }
    }

    async setTargetThresholdTemperature(mode, value) {
        await this.setStateAsync(this.dpThreshold, value);
        if (mode === 'cool' && !this.device.context.noHeat && this.characteristicHeatingThresholdTemperature) {
            this.characteristicHeatingThresholdTemperature.updateValue(value);
        } else if (mode === 'heat' && !this.device.context.noCool && this.characteristicCoolingThresholdTemperature) {
            this.characteristicCoolingThresholdTemperature.updateValue(value);
        }
    }

    getTemperatureDisplayUnits() {
        return this._getTemperatureDisplayUnits(this.getStateAsync(this.dpTempUnits));
    }

    _getTemperatureDisplayUnits(dp) {
        const {Characteristic} = this.hap;
        return dp === 'F' ? Characteristic.TemperatureDisplayUnits.FAHRENHEIT : Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    setTemperatureDisplayUnits(value) {
        const {Characteristic} = this.hap;
        return this.setStateAsync(this.dpTempUnits, value === Characteristic.TemperatureDisplayUnits.FAHRENHEIT ? 'F' : 'C');
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
            return this.setMultiStateAsync({[this.dpActive]: true, [this.dpRotationSpeed]: this.convertRotationSpeedFromHomeKitToTuya(value)});
        }
    }

    convertRotationSpeedFromTuyaToHomeKit(value) {
        return this._rotationStops[parseInt(value)];
    }

    convertRotationSpeedFromHomeKitToTuya(value) {
        return this.device.context.fanSpeedSteps ? '' + this._rotationSteps[value] : this._rotationSteps[value];
    }
}

module.exports = AirConditionerAccessory;
