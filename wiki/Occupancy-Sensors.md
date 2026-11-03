# Occupancy sensors

The `OccupancySensor` device type supports the Wi-Fi Tuya ZY-M100 presence sensor.
It exposes occupancy and ambient light as two HomeKit services on one accessory.

Add the device to the existing `TuyaLan` platform's `devices` list:

```json
{
  "type": "OccupancySensor",
  "name": "Garage Occupancy Sensor",
  "id": "YOUR_DEVICE_ID",
  "key": "YOUR_LOCAL_KEY",
  "manufacturer": "Tuya",
  "model": "ZY-M100"
}
```

The default occupancy data point is `1`: the value `presence` means occupied;
other values mean unoccupied. The default illuminance data point is `104`, in lux.
Use the optional `dpOccupancy` and `dpLight` settings to override these IDs for a
device with different data points. These settings also appear in the Homebridge UI
when the Presence Sensor device type is selected.

HomeKit requires illuminance between 0.0001 and 100000 lux. Readings outside that
range are clamped; invalid or missing light readings are not published as zero.
An unreachable device reports No Response when its characteristics are read.

The sensor must be connected to the network for LAN discovery and updates to work.
This device type does not add support for Zigbee sensors behind a gateway.
