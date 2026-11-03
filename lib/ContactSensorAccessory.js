const TuyaSensorAccessory = require('./TuyaSensorAccessory');

class ContactSensorAccessory extends TuyaSensorAccessory {
    static sensor = {
        service: 'ContactSensor',
        characteristic: 'ContactSensorState',
        option: 'dpContact',
        codes: ['doorcontact_state', 'switch'],
        decode: TuyaSensorAccessory.booleanValue,
    };
}

module.exports = ContactSensorAccessory;
