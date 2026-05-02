const BaseAccessory = require('./BaseAccessory');

const DP_SWITCH = '1';
const DP_PM25 = '2';
const DP_MODE = '3';
const DP_FAN_SPEED = '4';
const DP_LOCK_PHYSICAL_CONTROLS = '7';
const DP_AIR_QUALITY = '22';
const STATE_OTHER = 9;

class AirPurifierAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.AIR_PURIFIER;
    }

    constructor(...props) {
        super(...props);
        const {Characteristic} = this.hap;

        if (this.device.context.noRotationSpeed) {
            let fanSpeedSteps = (
                this.device.context.fanSpeedSteps &&
                isFinite(this.device.context.fanSpeedSteps) &&
                this.device.context.fanSpeedSteps > 0 &&
                this.device.context.fanSpeedSteps < 100) ? this.device.context.fanSpeedSteps : 100;
            let _fanSpeedLabels = {};
            switch (this.device.context.manufacturer) {
                case 'Breville':
                    _fanSpeedLabels = {0: 'off', 1: 'low', 2: 'mid', 3: 'high', 4: 'turbo'};
                    this._rotationSteps = [...Array(5).keys()];
                    fanSpeedSteps = 5;
                    break;
                case 'Proscenic':
                    _fanSpeedLabels = {0: 'sleep', 1: 'mid', 2: 'high', 3: 'auto'};
                    fanSpeedSteps = 3;
                    this._rotationSteps = [...Array(4).keys()];
                    break;
                case 'siguro':
                    _fanSpeedLabels = {0: 'sleep', 1: 'auto'};
                    fanSpeedSteps = 2;
                    this._rotationSteps = [...Array(2).keys()];
                    break;
                default:
                    this._rotationSteps = [...Array(fanSpeedSteps).keys()];
                    for (let i = 0; i <= fanSpeedSteps; i++) {
                        _fanSpeedLabels[i] = i;
                    }
            }
            this._rotationStops = {0: _fanSpeedLabels[0]};
            for (let i = 0; i < 100; i++) {
                const _rotationStep = Math.floor(fanSpeedSteps * i / 100);
                this._rotationStops[i + 1] = _fanSpeedLabels[_rotationStep];
            }
        }

        this.airQualityLevels = [
            [200, Characteristic.AirQuality.POOR],
            [150, Characteristic.AirQuality.INFERIOR],
            [100, Characteristic.AirQuality.FAIR],
            [50, Characteristic.AirQuality.GOOD],
            [0, Characteristic.AirQuality.EXCELLENT],
        ];

        this.cmdAuto = 'AUTO';
        if (this.device.context.cmdAuto) {
            if (/^a[a-z]+$/i.test(this.device.context.cmdAuto)) this.cmdAuto = ('' + this.device.context.cmdAuto).trim();
            else throw new Error('The cmdAuto doesn\'t appear to be valid: ' + this.device.context.cmdAuto);
        }
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;
        this.accessory.addService(Service.AirPurifier, this.device.context.name);
        if (this.device.context.showAirQuality) {
            this._addAirQualityService();
        }
        super._registerPlatformAccessory();
    }

    _addAirQualityService() {
        const {Service} = this.hap;
        const nameAirQuality = this.device.context.nameAirQuality || 'Air Quality';
        this.log.info('Adding air quality sensor: %s', nameAirQuality);
        this.accessory.addService(Service.AirQualitySensor, nameAirQuality);
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const airPurifierService = this.accessory.getService(Service.AirPurifier);
        this._checkServiceName(airPurifierService, this.device.context.name);
        this.log.debug('_registerCharacteristics dps: %o', dps);

        const characteristicActive = airPurifierService.getCharacteristic(Characteristic.Active)
            .updateValue(this._getActive(dps[DP_SWITCH]))
            .onGet(() => this.getActive())
            .onSet(value => this.setActive(value));

        const characteristicCurrentAirPurifierState = airPurifierService.getCharacteristic(Characteristic.CurrentAirPurifierState)
            .updateValue(this._getCurrentAirPurifierState(dps[DP_SWITCH]))
            .onGet(() => this._getCurrentAirPurifierState(this.getStateAsync(DP_SWITCH)));

        const characteristicTargetAirPurifierState = airPurifierService.getCharacteristic(Characteristic.TargetAirPurifierState)
            .updateValue(this._getTargetAirPurifierState(this._getMode(dps)))
            .onGet(() => this.getTargetAirPurifierState())
            .onSet(value => this.setTargetAirPurifierState(value));

        let characteristicLockPhysicalControls;
        if (!this.device.context.noChildLock) {
            characteristicLockPhysicalControls = airPurifierService.getCharacteristic(Characteristic.LockPhysicalControls)
                .updateValue(this._getLockPhysicalControls(dps[DP_LOCK_PHYSICAL_CONTROLS]))
                .onGet(() => this.getLockPhysicalControls())
                .onSet(value => this.setLockPhysicalControls(value));
        } else {
            this._removeCharacteristic(airPurifierService, Characteristic.LockPhysicalControls);
        }

        const characteristicRotationSpeed = airPurifierService.getCharacteristic(Characteristic.RotationSpeed)
            .updateValue(this._getRotationSpeed(dps))
            .onGet(() => this.getRotationSpeed())
            .onSet(value => this.setRotationSpeed(value));

        let airQualitySensorService = this.accessory.getService(Service.AirQualitySensor);
        let characteristicAirQuality;
        let characteristicPM25Density;

        if (!airQualitySensorService && this.device.context.showAirQuality) {
            this._addAirQualityService();
            airQualitySensorService = this.accessory.getService(Service.AirQualitySensor);
        } else if (airQualitySensorService && !this.device.context.showAirQuality) {
            this.accessory.removeService(airQualitySensorService);
        }

        if (airQualitySensorService) {
            const nameAirQuality = this.device.context.nameAirQuality || 'Air Quality';
            this._checkServiceName(airQualitySensorService, nameAirQuality);
            characteristicAirQuality = airQualitySensorService.getCharacteristic(Characteristic.AirQuality)
                .updateValue(this._getAirQuality(dps))
                .onGet(() => this._getAirQuality(this.getStateAsync([DP_PM25, DP_AIR_QUALITY])));
            characteristicPM25Density = airQualitySensorService.getCharacteristic(Characteristic.PM2_5Density)
                .updateValue(dps[DP_PM25])
                .onGet(() => this.getStateAsync(DP_PM25));
        }

        this.device.on('change', (changes, state) => {
            this.log.debug('Changes: %o, State: %o', changes, state);
            if (changes.hasOwnProperty(DP_SWITCH)) {
                const newActive = this._getActive(changes[DP_SWITCH]);

                if (changes[DP_SWITCH]) {
                    this.log.debug('Switching state first');
                    characteristicActive.updateValue(newActive);
                    characteristicCurrentAirPurifierState.updateValue(this._getCurrentAirPurifierState(changes[DP_SWITCH]));
                }

                if (!changes.hasOwnProperty(DP_FAN_SPEED)) characteristicRotationSpeed.updateValue(this._getRotationSpeed(state));
                if (!changes.hasOwnProperty(DP_MODE)) characteristicTargetAirPurifierState.updateValue(this._getTargetAirPurifierState(this._getMode(state)));

                if (!changes[DP_SWITCH]) {
                    this.log.debug('Switching state last');
                    characteristicCurrentAirPurifierState.updateValue(this._getCurrentAirPurifierState(changes[DP_SWITCH]));
                    characteristicActive.updateValue(newActive);
                }
            }

            if (changes.hasOwnProperty(DP_FAN_SPEED)) {
                const newRotationSpeed = this._getRotationSpeed(state);
                if (newRotationSpeed) {
                    if (characteristicRotationSpeed.value !== newRotationSpeed) characteristicRotationSpeed.updateValue(newRotationSpeed);
                }
                if (!changes.hasOwnProperty(DP_MODE)) characteristicTargetAirPurifierState.updateValue(this._getTargetAirPurifierState(this._getMode(state)));
            }

            if (characteristicLockPhysicalControls && changes.hasOwnProperty(DP_LOCK_PHYSICAL_CONTROLS)) {
                const newLockPhysicalControls = this._getLockPhysicalControls(changes[DP_LOCK_PHYSICAL_CONTROLS]);
                if (characteristicLockPhysicalControls.value !== newLockPhysicalControls) characteristicLockPhysicalControls.updateValue(newLockPhysicalControls);
            }

            if (changes.hasOwnProperty(DP_MODE)) {
                const newTargetAirPurifierState = this._getTargetAirPurifierState(changes[DP_MODE]);
                if (characteristicTargetAirPurifierState.value !== newTargetAirPurifierState) characteristicTargetAirPurifierState.updateValue(newTargetAirPurifierState);
            }

            if (airQualitySensorService && changes.hasOwnProperty(DP_PM25)) {
                const newPM25 = changes[DP_PM25];
                if (characteristicPM25Density.value !== newPM25) characteristicPM25Density.updateValue(newPM25);
                if (!changes.hasOwnProperty(DP_AIR_QUALITY)) characteristicAirQuality.updateValue(this._getAirQuality(state));
            }
        });
    }

    _getMode(state) {
        if (state[DP_MODE]) {
            return state[DP_MODE];
        } else {
            return state[DP_FAN_SPEED] == 'auto' ? 'auto' : 'manual';
        }
    }

    getActive() {
        return this._getActive(this.getStateAsync(DP_SWITCH));
    }

    _getActive(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    }

    setActive(value) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.Active.ACTIVE:
                return this.setStateAsync(DP_SWITCH, true);
            case Characteristic.Active.INACTIVE:
                return this.setStateAsync(DP_SWITCH, false);
        }
    }

    _getAirQuality(dps) {
        const {Characteristic} = this.hap;
        switch (this.device.context.manufacturer) {
            case 'Breville':
                if (dps[DP_AIR_QUALITY]) {
                    switch (dps[DP_AIR_QUALITY]) {
                        case 'poor': return Characteristic.AirQuality.POOR;
                        case 'good': return Characteristic.AirQuality.GOOD;
                        case 'great': return Characteristic.AirQuality.EXCELLENT;
                        default:
                            this.log.warn('Unhandled _getAirQuality value: %s', dps[DP_AIR_QUALITY]);
                            return Characteristic.AirQuality.UNKNOWN;
                    }
                }
                break;
            default:
                if (dps[DP_PM25]) {
                    for (var item of this.airQualityLevels) {
                        if (dps[DP_PM25] >= item[0]) return item[1];
                    }
                }
        }
        return 0;
    }

    _getCurrentAirPurifierState(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR : Characteristic.CurrentAirPurifierState.INACTIVE;
    }

    getLockPhysicalControls() {
        return this._getLockPhysicalControls(this.getStateAsync(DP_LOCK_PHYSICAL_CONTROLS));
    }

    _getLockPhysicalControls(dp) {
        const {Characteristic} = this.hap;
        return dp ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
    }

    setLockPhysicalControls(value) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED:
                return this.setStateAsync(DP_LOCK_PHYSICAL_CONTROLS, true);
            case Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED:
                return this.setStateAsync(DP_LOCK_PHYSICAL_CONTROLS, false);
        }
    }

    getRotationSpeed() {
        return this._getRotationSpeed(this.getStateAsync([DP_SWITCH, DP_FAN_SPEED]));
    }

    _getRotationSpeed(dps) {
        if (!dps[DP_SWITCH]) {
            return 0;
        } else if (this._hkRotationSpeed) {
            const currntRotationSpeed = this.convertRotationSpeedFromHomeKitToTuya(this._hkRotationSpeed);
            return currntRotationSpeed === dps[DP_FAN_SPEED] ? this._hkRotationSpeed : this._hkRotationSpeed = this.convertRotationSpeedFromTuyaToHomeKit(dps[DP_FAN_SPEED]);
        }
        return this._hkRotationSpeed = this.convertRotationSpeedFromTuyaToHomeKit(dps[DP_FAN_SPEED]);
    }

    setRotationSpeed(value) {
        const {Characteristic} = this.hap;
        if (value === 0) {
            return this.setActive(Characteristic.Active.INACTIVE);
        } else {
            this._hkRotationSpeed = value;
            return this.setStateAsync(DP_FAN_SPEED, this.convertRotationSpeedFromHomeKitToTuya(value));
        }
    }

    getTargetAirPurifierState() {
        return this._getTargetAirPurifierState(this._getMode(this.getStateAsync([DP_MODE, DP_FAN_SPEED])));
    }

    _getTargetAirPurifierState(dp) {
        const {Characteristic} = this.hap;
        switch (dp) {
            case 'manual':
            case 'Manual':
                return Characteristic.TargetAirPurifierState.MANUAL;
            case 'Sleep':
            // eslint-disable-next-line no-fallthrough
            case 'auto':
            case 'Auto':
                return Characteristic.TargetAirPurifierState.AUTO;
            default:
                this.log.warn('Unhandled getTargetAirPurifierState value: %s', dp);
                return STATE_OTHER;
        }
    }

    setTargetAirPurifierState(value) {
        const {Characteristic} = this.hap;
        switch (value) {
            case Characteristic.TargetAirPurifierState.MANUAL:
                if (this.device.context.manufacturer == 'Breville') return this.setStateAsync(DP_MODE, 'manual');
                else if (this.device.context.manufacturer == 'Proscenic') return this.setStateAsync(DP_FAN_SPEED, 'sleep');
                else if (this.device.context.manufacturer == 'siguro') return this.setStateAsync(DP_FAN_SPEED, 'sleep');
                else return this.setStateAsync(DP_MODE, 'Manual');
            case Characteristic.TargetAirPurifierState.AUTO:
                if (this.device.context.manufacturer == 'Breville') return this.setStateAsync(DP_MODE, 'auto');
                else if (this.device.context.manufacturer == 'Proscenic') return this.setStateAsync(DP_FAN_SPEED, 'auto');
                else if (this.device.context.manufacturer == 'siguro') return this.setStateAsync(DP_FAN_SPEED, 'auto');
                else return this.setStateAsync(DP_MODE, 'Auto');
            default:
                this.log.warn('Unhandled setTargetAirPurifierState value: %s', value);
        }
    }

    getKeyByValue(object, value) {
        return Object.keys(object).find(key => object[key] === value);
    }

    convertRotationSpeedFromHomeKitToTuya(value) {
        this.log.debug('convertRotationSpeedFromHomeKitToTuya: %s: %s', value, this._rotationStops[parseInt(value)]);
        return this._rotationStops[parseInt(value)];
    }

    convertRotationSpeedFromTuyaToHomeKit(value) {
        this.log.debug('convertRotationSpeedFromTuyaToHomeKit: %s: %s', value, this.getKeyByValue(this._rotationStops, value));
        let speed = this.device.context.fanSpeedSteps ? '' + this.getKeyByValue(this._rotationStops, value) : this.getKeyByValue(this._rotationStops, value);
        if (speed === undefined) return 0;
        return speed;
    }
}

module.exports = AirPurifierAccessory;
