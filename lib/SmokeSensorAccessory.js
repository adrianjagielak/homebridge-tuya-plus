const TuyaSensorAccessory = require('./TuyaSensorAccessory');

class SmokeSensorAccessory extends TuyaSensorAccessory {
    static sensor = {
        service: 'SmokeSensor',
        characteristic: 'SmokeDetected',
        option: 'dpSmoke',
        codes: ['smoke_sensor_status', 'smoke_sensor_state'],
        decode: TuyaSensorAccessory.alarmValue,
    };
}

module.exports = SmokeSensorAccessory;
