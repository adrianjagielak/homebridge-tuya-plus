const BaseAccessory = require('./BaseAccessory');

const STATE_OTHER = 9;

class DehumidifierAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.DEHUMIDIFIER;
    }

    constructor(...props) {
        super(...props);

        this.cmdDehumidify = '0';
        this.cmdContinual = '1';
        this.cmdAuto = '2';
        this.cmdLaundry = '3';

        this.defaultDps = {
            'Active':     1,
            'Mode':       2,
            'Humidity':   4,
            'Cleaning':   5,
            'FanSpeed':   6,
            'ChildLock':  7,
            'TankState': 11,
            'Sleep':    102,
            'CurrentTemperature': 103,
            'CurrentHumidity':    104,
        };
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.TemperatureSensor, this.device.context.name);
        this.accessory.addService(Service.HumiditySensor, this.device.context.name);
        this.accessory.addService(Service.HumidifierDehumidifier, this.device.context.name);

        if (!this.device.context.noChildLock) {
            this.accessory.addService(Service.LockMechanism, this.device.context.name + ' - Child Lock');
        }

        if (!this.device.context.noSpeed) {
            this.accessory.addService(Service.Fan, this.device.context.name);
        }

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;

        const infoService = this.accessory.getService(Service.AccessoryInformation);
        infoService.getCharacteristic(Characteristic.Manufacturer).updateValue(this.device.context.manufacturer);
        infoService.getCharacteristic(Characteristic.Model).updateValue(this.device.context.model);

        const characteristicTemperature = this.accessory.getService(Service.TemperatureSensor)
            .getCharacteristic(Characteristic.CurrentTemperature)
            .updateValue(this._getCurrentTemperature(dps[this.getDp('CurrentTemperature')]))
            .onGet(() => this._getCurrentTemperature(this.getStateAsync(this.getDp('CurrentTemperature'))));

        const characteristicCurrentHumidity = this.accessory.getService(Service.HumiditySensor)
            .getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .updateValue(this._getCurrentHumidity(dps[this.getDp('CurrentHumidity')]))
            .onGet(() => this._getCurrentHumidity(this.getStateAsync(this.getDp('CurrentHumidity'))));

        const service = this.accessory.getService(Service.HumidifierDehumidifier);
        this._checkServiceName(service, this.device.context.name);

        let characteristicSpeed;
        if (!this.device.context.noSpeed) {
            let fanService = this.accessory.getService(Service.Fan);
            characteristicSpeed = fanService.getCharacteristic(Characteristic.RotationSpeed)
                .setProps({
                    minValue: this.device.context.minSpeed || 1,
                    maxValue: this.device.context.maxSpeed || 2,
                    minStep: this.device.context.speedSteps || 1,
                })
                .updateValue(this._getRotationSpeed(dps))
                .onGet(() => this.getRotationSpeed())
                .onSet(value => this.setRotationSpeed(value));
        }

        this._removeCharacteristic(service, Characteristic.SwingMode);
        service.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
            .updateValue(Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING);
        service.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
            .updateValue(Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER);

        const characteristicCurrentHumidity2 = service.getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .updateValue(this._getCurrentHumidity(dps[this.getDp('CurrentHumidity')]))
            .onGet(() => this._getCurrentHumidity(this.getStateAsync(this.getDp('CurrentHumidity'))));

        const characteristicActive = service.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(dps[this.getDp('Active')]))
            .onGet(() => this.getActive())
            .onSet(value => this.setActive(value));

        const characteristicWaterTank = service.getCharacteristic(Characteristic.WaterLevel)
            .updateValue(dps[this.getDp('TankState')])
            .onGet(() => this._getTankState(this.getStateAsync(this.getDp('TankState'))));

        let characteristicChildLock;
        if (!this.device.context.noChildLock) {
            let lockService = this.accessory.getService(Service.LockMechanism);
            lockService.getCharacteristic(Characteristic.LockCurrentState)
                .updateValue(this._getLockTargetState(dps[this.getDp('ChildLock')]))
                .onGet(() => this._getLockTargetState(this.getStateAsync(this.getDp('ChildLock'))));
            characteristicChildLock = lockService.getCharacteristic(Characteristic.LockTargetState)
                .updateValue(this._getLockTargetState(dps[this.getDp('ChildLock')]))
                .onGet(() => this._getLockTargetState(this.getStateAsync(this.getDp('ChildLock'))))
                .onSet(value => this.setLockTargetState(value));
        } else this._removeCharacteristic(service, Characteristic.LockTargetState);

        this.characteristicHumidity = service.getCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold);
        this.characteristicHumidity.setProps({ minStep: this.device.context.humiditySteps || 5 })
            .updateValue(dps[this.getDp('Humidity')])
            .onGet(() => this.getStateAsync(this.getDp('Humidity')))
            .onSet(value => this.setTargetHumidity(value));

        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(this.getDp('Active'))) {
                const newActive = this._getActive(changes[this.getDp('Active')]);
                if (characteristicActive.value !== newActive) {
                    characteristicActive.updateValue(newActive);
                    if (!changes.hasOwnProperty(this.getDp('FanSpeed')) && characteristicSpeed) {
                        characteristicSpeed.updateValue(this._getRotationSpeed(state));
                    }
                }
            }

            if (changes.hasOwnProperty('Humidity') && this.characteristicHumidity.value !== changes[this.getDp('Humidity')])
                this.characteristicHumidity.updateValue(changes[this.getDp('Humidity')]);

            if (characteristicChildLock && changes.hasOwnProperty(this.getDp('ChildLock'))) {
                const newChildLock = this._getLockTargetState(changes[this.getDp('ChildLock')]);
                if (characteristicChildLock.value !== newChildLock) characteristicChildLock.updateValue(newChildLock);
            }

            if (changes.hasOwnProperty(this.getDp('FanSpeed')) && characteristicSpeed) {
                const newSpeed = this._getRotationSpeed(state);
                if (characteristicSpeed.value !== newSpeed) characteristicSpeed.updateValue(newSpeed);
            }
        });
    }

    getActive() {
        return this._getActive(this.getStateAsync(this.getDp('Active')));
    }

    _getActive(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    }

    setActive(value) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.Active.ACTIVE:
                return this.setStateAsync(this.getDp('Active'), true);
            case Characteristic.Active.INACTIVE:
                return this.setStateAsync(this.getDp('Active'), false);
        }
    }

    _getTankState(dp) {
        return dp ? 100 : 50;
    }

    _getLockTargetState(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
    }

    setLockTargetState(value) {
        if (this.device.context.noLock) return;
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.LockTargetState.SECURED:
                return this.setStateAsync(this.getDp('ChildLock'), true);
            case Characteristic.LockTargetState.UNSECURED:
                return this.setStateAsync(this.getDp('ChildLock'), false);
        }
    }

    getRotationSpeed() {
        return this._getRotationSpeed(this.getStateAsync(this.getDp('FanSpeed')));
    }

    _getRotationSpeed(dp) {
        return dp > 1 ? dp - 1 : dp;
    }

    setRotationSpeed(value) {
        if (this.device.context.noSpeed) return;
        value > 1 ? value++ : null;
        return this.setStateAsync(this.getDp('FanSpeed'), value.toString());
    }

    _getCurrentHumidity(dp) {
        return dp;
    }

    _getCurrentTemperature(dp) {
        return dp;
    }

    setTargetHumidity(value) {
        const {Characteristic} = this.hap;

        let origValue = value;
        value = Math.max(value, this.device.context.minHumidity || 40);
        value = Math.min(value, this.device.context.maxHumidity || 80);
        if (origValue != value) {
            this.characteristicHumidity.updateValue(value);
        }

        return this.setMultiStateAsync({[this.getDp('Active')]: true, [this.getDp('Humidity')]: value});
    }

    getDp(name) {
        return this.device.context['dps' + name] ? this.device.context['dps' + name] : this.defaultDps[name];
    }
}

module.exports = DehumidifierAccessory;
