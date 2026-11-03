// Sensor codes and battery mappings adapted from 0x5e/homebridge-tuya-platform.
// See THIRD_PARTY_NOTICES.md for attribution and the MIT license notice.
const BaseAccessory = require('./BaseAccessory');

const BATTERY_CODES = ['battery_percentage', 'residual_electricity', 'wireless_electricity', 'va_battery', 'battery'];

class TuyaSensorAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.SENSOR;
    }

    _registerPlatformAccessory() {
        const service = this.hap.Service[this.constructor.sensor.service];
        this.accessory.addService(service, this.device.context.name);
        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const definition = this.constructor.sensor;
        const service = this.accessory.getService(Service[definition.service]);
        this._checkServiceName(service, this.device.context.name);
        this._sensorState = {...dps};
        this._sensorBindings = [];
        this._bindSensorCharacteristic(service, Characteristic[definition.characteristic], state => this._sensorValue(state));
        this._registerSensorBattery();
        this._syncSensorCharacteristics();
        this.device.on('change', (changes, state) => {
            this._sensorState = state ? {...state} : {...this._sensorState, ...changes};
            this._registerSensorBattery();
            this._syncSensorCharacteristics();
        });
    }

    _sensorCodes(option, defaults) {
        const override = this.device.context[option];
        if (override !== undefined && override !== null && String(override).trim() !== '') return [String(override).trim()];
        return defaults;
    }

    _sensorValues(option, defaults, state = this._sensorState) {
        return this._sensorCodes(option, defaults)
            .filter(code => Object.prototype.hasOwnProperty.call(state, code))
            .map(code => state[code]);
    }

    _sensorValue(state = this._sensorState) {
        const definition = this.constructor.sensor;
        const values = this._sensorValues(definition.option, definition.codes, state);
        if (!values.length) throw this._commError();
        const decoded = values.map(value => definition.decode(value));
        // Leak detectors may report several gases/water at once. Any alarm wins,
        // including when another reported data point is missing or malformed.
        if (definition.anyAlarm && decoded.includes(1)) return 1;
        const selected = definition.anyAlarm ? decoded : decoded.slice(0, 1);
        if (selected.some(value => value === undefined)) throw this._commError();
        return selected[0];
    }

    _bindSensorCharacteristic(service, type, read) {
        const getter = async () => read(await this.getStateAsync(Object.keys(this._sensorState)));
        const characteristic = service.getCharacteristic(type).onGet(getter);
        this._sensorBindings.push({characteristic, read});
    }

    _syncSensorCharacteristics() {
        for (const {characteristic, read} of this._sensorBindings) {
            try {
                if (!this.device.connected) throw this._commError();
                const value = read(this._sensorState);
                if (characteristic.value !== value) characteristic.updateValue(value);
            } catch (error) {
                characteristic.updateValue(error);
            }
        }
    }

    _registerSensorBattery() {
        if (this._batteryRegistered) return;
        if (this._coerceBoolean(this.device.context.noBattery)) {
            const battery = this.accessory.getService(this.hap.Service.Battery);
            if (battery) this.accessory.removeService(battery);
            return;
        }
        const hasLevel = this._sensorValues('dpBattery', BATTERY_CODES).length > 0;
        if (!hasLevel) return;

        this._batteryRegistered = true;
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.Battery)
            || this.accessory.addService(Service.Battery, this.device.context.name + ' Battery');
        this._bindSensorCharacteristic(service, Characteristic.BatteryLevel, state => this._sensorBatteryLevel(state));
        this._bindSensorCharacteristic(service, Characteristic.StatusLowBattery, state => {
            const states = this._sensorValues('dpBatteryState', ['battery_state'], state);
            if (states.length) {
                if (states[0] === 'low') return Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
                if (['middle', 'medium', 'high', 'normal', 'full'].includes(states[0])) return Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                throw this._commError();
            }
            const threshold = Math.min(100, Math.max(0, this._coerceNumber(this.device.context.lowBatteryThreshold, 20)));
            return this._sensorBatteryLevel(state) <= threshold
                ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
        });
        this._bindSensorCharacteristic(service, Characteristic.ChargingState, state => {
            const values = this._sensorValues('dpCharging', ['charge_state'], state);
            if (!values.length) return Characteristic.ChargingState.NOT_CHARGEABLE;
            const charging = TuyaSensorAccessory.booleanValue(values[0]);
            if (charging === undefined) throw this._commError();
            return charging ? Characteristic.ChargingState.CHARGING : Characteristic.ChargingState.NOT_CHARGING;
        });
    }

    _sensorBatteryLevel(state = this._sensorState) {
        const value = this._sensorValues('dpBattery', BATTERY_CODES, state)[0];
        const divisor = Number(this.device.context.batteryDivisor ?? 1);
        if ((typeof value !== 'number' && (typeof value !== 'string' || value.trim() === ''))
            || !Number.isFinite(Number(value)) || !Number.isFinite(divisor) || divisor <= 0) throw this._commError();
        return Math.min(100, Math.max(0, Number(value) / divisor));
    }

    static booleanValue(value) {
        if ([true, 1, '1', 'true'].includes(value)) return 1;
        if ([false, 0, '0', 'false'].includes(value)) return 0;
        return undefined;
    }

    static alarmValue(value) {
        if (value === 'alarm') return 1;
        if (value === 'normal') return 0;
        return TuyaSensorAccessory.booleanValue(value);
    }
}

module.exports = TuyaSensorAccessory;
