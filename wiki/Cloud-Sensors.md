# Contact, smoke, and leak sensors

Use `ContactSensor`, `SmokeSensor`, or `LeakSensor` in the `TuyaLan` platform's
`devices` list. These read-only accessories work through the existing cloud
transport, including devices behind a gateway that cannot be reached over the LAN.
Configure the platform's [cloud credentials](Tuya-Cloud-Setup.md), and omit the
device's local `key` to keep it cloud-only:

```json
{
  "type": "ContactSensor",
  "name": "Front Door",
  "id": "YOUR_DEVICE_ID"
}
```

| Type | Default cloud codes | Detected state | Override |
| --- | --- | --- | --- |
| `ContactSensor` | `doorcontact_state`, then `switch` | `true` means open | `dpContact` |
| `SmokeSensor` | `smoke_sensor_status`, then `smoke_sensor_state` | `alarm` or `1` | `dpSmoke` |
| `LeakSensor` | `gas_sensor_status`, `gas_sensor_state`, `ch4_sensor_state`, `watersensor_state` | Any reported alarm | `dpLeak` |

The contact handler accepts booleans and their `0`/`1` or `false`/`true` string
equivalents. Smoke and leak handlers also accept `alarm`/`normal`. Missing or
unrecognized readings report No Response instead of being interpreted as safe.
An alarm on one leak data point takes precedence over other readings.

Custom data-point settings accept cloud codes or numeric LAN IDs. For a LAN
device, supply its local key and the matching numeric override. No device commands
are sent by these sensor handlers. Cloud updates use the existing MQTT stream;
the handlers add no polling.

## Battery

A battery service is added when a percentage data point is reported:
`battery_percentage`, `residual_electricity`, `wireless_electricity`, `va_battery`,
or `battery`. It can also appear when that reading arrives after the sensor's
initial update.

- `dpBattery`: override the percentage data point.
- `batteryDivisor`: divide the raw percentage by this value; default `1`.
- `dpBatteryState`: override `battery_state`. Its `low` state takes precedence
  over the percentage threshold; `middle`, `medium`, `high`, `normal`, and `full`
  are normal battery states.
- `lowBatteryThreshold`: percentage at or below which to report low battery when
  no battery-state code is present; default `20`.
- `dpCharging`: override `charge_state`. Devices without that reading report
  Not Chargeable.
- `noBattery`: disable the battery service.

## Attribution and migration

The cloud codes and battery mappings come from 0x5e's Tuya platform plugin;
Eliran Sapir adapted them for Tuya Plus. See [third-party notices](../THIRD_PARTY_NOTICES.md).

This adds device support, not an automatic migration from another plugin. Existing
accessory UUIDs, child-bridge pairing, and service IDs need separate migration work
to preserve HomeKit rooms and automations.
