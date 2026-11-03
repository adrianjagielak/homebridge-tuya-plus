const BaseAccessory = require('./BaseAccessory');

class OccupancySensorAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.SENSOR;
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;
        const {name} = this.device.context;
        this.accessory.addService(Service.OccupancySensor, name);
        this.accessory.addService(Service.LightSensor, name + ' Light');
        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const {name} = this.device.context;
        const occupancyService = this.accessory.getService(Service.OccupancySensor);
        const lightService = this.accessory.getService(Service.LightSensor);
        this._checkServiceName(occupancyService, name);
        this._checkServiceName(lightService, name + ' Light');

        this.dpOccupancy = this._getCustomDP(this.device.context.dpOccupancy) || '1';
        this.dpLight = this._getCustomDP(this.device.context.dpLight) || '104';

        const occupancy = occupancyService.getCharacteristic(Characteristic.OccupancyDetected)
            .updateValue(this._occupancyValue(dps[this.dpOccupancy]))
            .onGet(async () => this._occupancyValue(await this.getStateAsync(this.dpOccupancy)));
        const light = lightService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
            .onGet(async () => {
                const value = this._lightValue(await this.getStateAsync(this.dpLight));
                if (value === undefined) throw this._commError();
                return value;
            });

        const initialLight = this._lightValue(dps[this.dpLight]);
        if (initialLight !== undefined) light.updateValue(initialLight);

        this.device.on('change', changes => {
            if (Object.prototype.hasOwnProperty.call(changes, this.dpOccupancy)) {
                const value = this._occupancyValue(changes[this.dpOccupancy]);
                if (occupancy.value !== value) occupancy.updateValue(value);
            }
            if (Object.prototype.hasOwnProperty.call(changes, this.dpLight)) {
                const value = this._lightValue(changes[this.dpLight]);
                if (value !== undefined && light.value !== value) light.updateValue(value);
            }
        });
    }

    _occupancyValue(value) {
        const {OccupancyDetected} = this.hap.Characteristic;
        return value === 'presence' ? OccupancyDetected.OCCUPANCY_DETECTED : OccupancyDetected.OCCUPANCY_NOT_DETECTED;
    }

    _lightValue(value) {
        if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return undefined;
        const lux = Number(value);
        if (!Number.isFinite(lux) || lux < 0) return undefined;
        // HomeKit's light characteristic excludes zero, which this sensor reports in darkness.
        return Math.min(100000, Math.max(0.0001, lux));
    }
}

module.exports = OccupancySensorAccessory;
