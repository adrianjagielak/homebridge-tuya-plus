const TuyaSensorAccessory = require('./TuyaSensorAccessory');

class LeakSensorAccessory extends TuyaSensorAccessory {
    static sensor = {
        service: 'LeakSensor',
        characteristic: 'LeakDetected',
        option: 'dpLeak',
        codes: ['gas_sensor_status', 'gas_sensor_state', 'ch4_sensor_state', 'watersensor_state'],
        decode: TuyaSensorAccessory.alarmValue,
        anyAlarm: true,
    };
}

module.exports = LeakSensorAccessory;
