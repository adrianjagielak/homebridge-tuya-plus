This is the current list of supported devices type that work with this plugin.
If you are looking for verified configurations for your specific device, please refer to Supported Devices.



|Device  |Type|Notes  |
|:---|:---:|:---|
|Smart Plug|`Outlet`<sup>[1](#outlets)</sup>|Smart plugs that just turn on and off <small>([instructions](#outlets))</small>| 
|Smart Light Bulb Socket|`SimpleLight`|Light sockets that just turn on and off|
|Simple Light Bulb|`SimpleLight`|Light bulbs that just turn on and off|
|Tunable White Light Bulb|`TWLight`<sup>[2](#tunable-white-light-bulbs)</sup>|Bulbs with tunable white and dimming functionality <small>([instructions](#tunable-white-light-bulbs))</small>|
|White and Color Light Bulb|`RGBTWLight`<sup>[3](#white-and-color-light-bulbs)</sup>|Colored bulbs with tunable white and dimming functionality <small>([instructions](#white-and-color-light-bulbs))</small>|
|Smart Power Strip|`MultiOutlet`<sup>[4](#smart-power-strips)</sup>|Smart power strips that have sequential data-points and allow each outlet to be turned on and off individually <small>([instructions](#smart-power-strips))</small>|
|Non-sequential Power Strip|`CustomMultiOutlet`<sup>[5](#non-sequential-power-strips)</sup>|Smart power strips that have non-sequential data-points for each outlet <small>([instructions](#non-sequential-power-strips))</small>|
|Barely Smart Power Strip|`Outlet`|Smart power strips that don't allow individual control of the outlets|
|Air Conditioner|`AirConditioner`<sup>[6](#air-conditioners)</sup>|Cooling and heating devices <small>([instructions](#air-conditioners))</small>|
|Heat Convector|`Convector`<sup>[7](#heat-convectors)</sup>|Heating panels <small>([instructions](#heat-convectors))</small>|
|Simple Dimmer|`SimpleDimmer`<sup>[8](#simple-dimmers)</sup>|Dimmer switches with power control <small>([instructions](#simple-dimmers))</small>|
|WLED Dimmer|`WledDimmer`<sup>[8](#simple-dimmers)</sup>|Dimmer switches with power control, plus optional WLED brightness sync and preset-effect switches <small>([instructions](#simple-dimmers))</small>|
|Simple Heater|`SimpleHeater`<sup>[9](#simple-heaters)</sup>|Heating solutions with only temperature control <small>([instructions](#simple-heaters))</small>|
|Garage Door|`GarageDoor`<sup>[10](#garage-doors)</sup>|Smart garage doors or garage door openers <small>([instructions](#garage-doors))</small>|
|Simple Garage Door|`SimpleGarageDoor`<sup>[10](#simple-garage-doors)</sup>|Sliding gate openers and garage door controllers with open/stop/close action DPs and a simple three-value status DP <small>([instructions](#simple-garage-doors))</small>|
|Simple Blinds|`SimpleBlinds`<sup>[11](#simple-blinds)</sup>|Smart blinds and smart switches that control blinds <small>([instructions](#simple-blinds))</small>|
|Simple Blinds2|`SimpleBlinds2`<sup>[11](#simple-blinds)</sup>|Smart blinds and smart switches that control blinds(Use if simple Blinds (1) doesn't work for you. <small>([instructions](#simple-blinds))</small>|
|Vertical Blinds with Tilt|`VerticalBlindsWithTilt`<sup>[11](#vertical-blinds-with-tilt)</sup>|Smart vertical blinds with open/close and panel rotation <small>([instructions](#vertical-blinds-with-tilt))</small>|
|Percent Control Blinds|`PercentBlinds`<sup>[11](#percent-control-blinds)</sup>|Blinds that natively report and accept a percentage position via a `percent_control` datapoint <small>([instructions](#percent-control-blinds))</small>|
|Smart Plug w/ White and Color Lights|`RGBTWOutlet`<sup>[12](#outlets-with-white-and-color-lights)</sup>|Smart plugs that have controllable RGBTW LEDs <small>([instructions](#outlets-with-white-and-color-lights))</small>|
|Smart Fan Regulator|`SimpleFanAccessory`<sup>[more](#smart-fan-regulators-and-accessories)</sup>|Smart Fan Regulators that have controllable Speeds <small>([instructions](#smart-fan-regulators-and-accessories))</small>|
|Smart Fan with Light|`SimpleFanLightAccessory`<sup>[more](#smart-fan-with-light)</sup>|Smart Fan devices that have controllable Speeds, Directions and a built-in Light<small>([instructions](#smart-fan-with-light))</small>|
|Smart Switch|`Switch`<sup>[13](#switch)</sup>|Smart switches that just turn on and off <small>([instructions](#switch))</small>| 




## Additional Parameters

### Switch
These are swich gangs

```json5
{
    "name": "My Switch",
    "type": "Switch",
    "manufacturer": "Tuya",
    "model": "Tuya Switch",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Define number of switches it support */
    "switchCount": 3,
}
```

### Outlets
These are plugs with a single outlet that can only be turned on or off.

```json5
{
    "name": "My Outlet",
    "type": "Outlet",
    "manufacturer": "EZH",
    "model": "Wifi Mini Smart Life Outlet",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* If your device provides energy parameters, define these */

    /* Datapoint identifier for voltage reporting */
    "voltsId": 9,

    /* Datapoint identifier for amperage reporting */
    "ampsId": 8,

    /* Datapoint identifier for wattage reporting */
    "wattsId": 7,

    /* Often voltage is reported divided by 10; if that is 
       not the case for you, override the default */
    "voltsDivisor": 10,

    /* Often amperage is reported divided by 1000; if that is
       not the case for you, override the default */
    "ampsDivisor": 1000,

    /* Often wattage is reported divided by 10; if that is
       not the case for you, override the default */
    "wattsDivisor": 10,

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for power */
    "dpPower": 1
}
```

### Tunable White Light Bulbs
These are light bulbs that let you control the brightness and tune the bulb's light from warm white to daylight white.

```json5
{
    "name": "My Tunable White Bulb",
    "type": "TWLight",
    "manufacturer": "Iotton",
    "model": "Smart White Bulb",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for power */
    "dpPower": 1,

    /* Override the default datapoint identifier for brightness */
    "dpBrightness": 2,

    /* Override the default datapoint identifier for color-temperature */
    "dpColorTemperature": 3,

    /* Minimum white temperature mired value
       (See https://en.wikipedia.org/wiki/Mired) */
    "minWhiteColor": 140,

    /* Maximum white temperature mired value */
    "maxWhiteColor": 400
}
```

### White and Color Light Bulbs
These are bulbs that can produce white light as well as colors and allow you to control the brightness. They also let you tune the color-temperature of the white light.

There are two kinds of color devices: (1) the most common ones use 14 characters to represent the color (`HEXHSB`), and (2) others use 12 characters for the color (`HSB`). The `colorFunction` defaults to `HEXHSB` but can be overriden in the config block to properly use the second type.

It is common for `HEXHSB` devices to use white color temperature and brightness values from 0 to 255 (scale of `255`). It is also common for `HSB` devices to use white color temperature and brightness values from 0 to 1000 (scale of `1000`). If a device doesn't follow these common values, `scaleWhiteColor` and `scaleBrightness` can help.   

```json5
{
    "name": "My Colored Bulb",
    "type": "RGBTWLight",
    "manufacturer": "Novostella",
    "model": "Color Changing Floor Light",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for power */
    "dpPower": 1,

    /* Override the default datapoint identifier for mode (white vs color) */
    "dpMode": 2,

    /* Override the default datapoint identifier for brightness */
    "dpBrightness": 3,

    /* Override the default datapoint identifier for color-temperature of the whites */
    "dpColorTemperature": 4,

    /* Override the default datapoint identifier for color */
    "dpColor": 5,

    /* Minimum white temperature mired value
       (See https://en.wikipedia.org/wiki/Mired) */
    "minWhiteColor": 140,

    /* Maximum white temperature mired value */
    "maxWhiteColor": 400,

    /* Override the color format (default: HEXHSB)
       Only use if your device is not recognized correctly
       Using HSB defaults the scale of brightness and white color to 1000 */
    "colorFunction": "HEXHSB",

    /* Override the default brightness scale */
    "scaleBrightness": 255,
                          
    /* Override the default color temperature scale */
    "scaleWhiteColor": 255
}
```

### Smart Power Strips
These device can have any number of controllable outlets. To let the plugin know how many your device supports, add an additional parameter named `outletCount`.

```json5
{
    "name": "My Power Strip",
    "type": "MultiOutlet",
    "manufacturer": "GeekBee",
    "model": "Smart Wifi Power Strip",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",
    /* This device has 3 outlets and 2 USB ports, all individually controllable */
    "outletCount": 5
}
```

### Non-sequential Power Strips
Some smart power strips don't have sequential data-points. Using `CustomMultiOutlet` you can introduce the data-points.

```json5
{
    "name": "My Power Strip",
    "type": "CustomMultiOutlet",
    "manufacturer": "GeekBee",
    "model": "Smart Wifi Power Strip",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",
    /* Introduce your data-points here; add more as needed. */
    "outlets": [
        {
            "name": "Outlet 1",
            "dp": 1
        },
        {
            "name": "Outlet 2",
            "dp": 2
        },
        {
            "name": "USB 1",
            "dp": 7
        }
    ]
}
```

### Air Conditioners
These devices have cooling and/or heating capabilities; they could also have _dry_, _fan_, or others modes but HomeKit's definition doesn't facilitate modes other than _heat_, _cool_, and _auto_. By default, _heat_, _cool_ and _auto_ modes are enabled; to let the plugin know that a device doesn't have heating, cooling or auto capabilities, add an additional parameter named `noHeat`, `noCool` or `noAuto` and set it to `true`.

Tuya devices don't follow a unified pattern for naming the modes, for example cooling mode is called _COOL_ on Kogan's KAPRA14WFGA but _cold_ on Igenix's IG9901WIFI and most "standard" Tuya AC (category `kt`) firmwares. The phrases are also **case-sensitive**. By default, the plugin uses the phrases _COOL_, _HEAT_ and _AUTO_ while communicating with your device; if your device uses different phrases (a very common case — many ACs report lowercase `cold` / `hot` / `auto` / `wet` / `wind`), override them with `cmdCool`, `cmdHeat` and `cmdAuto`. If the modes don't switch at all, this is almost always the reason.

> **Tip — finding the exact phrases.** The phrases are the raw values of the `mode` data-point (DP `4`). You can read them from the [Tuya IoT Platform](https://iot.tuya.com) → _Cloud → API Explorer → Query Things Data Model_ (or _Get Device Specification_) for your device. For example, a device whose `mode` enum range is `["auto","cold","wet","wind","hot"]` needs `cmdCool: "cold"`, `cmdHeat: "hot"`, `cmdAuto: "auto"`.

The fan speed data-point (DP `5`, `windspeed`) is usually an **enum of string values** like `"1"`, `"2"`, `"3"`. Set `fanSpeedSteps` to the number of speeds (e.g. `3`); this both maps HomeKit's 0–100 % slider onto the right number of steps and — importantly — sends the speed as a string, which these firmwares require. Without it the fan may silently ignore speed changes.

Many ACs have no child-lock data-point; if yours doesn't, set `noChildLock: true` so the plugin doesn't add a (non-functional) lock control. Likewise, set `noRotationSpeed: true` if the device has no fan-speed control.

Additional parameters can be found in the sample below.

```json5
{
    "name": "My Air Conditioner",
    "type": "AirConditioner",
    "manufacturer": "Kogan",
    "model": "KAPRA14WFGA",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* This device has no cooling function */
    "noCool": true,

    /* This device has no heating function */
    "noHeat": true ,

    /* This device has no auto function */
    "noAuto": true,

    /* Override cooling phrase (case-sensitive; e.g. "cold" on many devices) */
    "cmdCool": "COOL",

    /* Override heating phrase (case-sensitive; e.g. "hot" on many devices) */
    "cmdHeat": "HEAT",

    /* Override auto phrase (case-sensitive; e.g. "auto" on many devices) */
    "cmdAuto": "AUTO",

    /* Number of fan speeds; also sends the speed as a string (required by most ACs) */
    "fanSpeedSteps": 3,

    /* This device has no fan-speed control */
    "noRotationSpeed": true,

    /* This device has no child-lock data-point */
    "noChildLock": true,

    /* This device has no oscillation (swinging) function */
    "noSwing": true,

    /* Minimum temperature supported, in Celsius (°C) */
    "minTemperature": 15,

    /* Maximum temperature supported, in Celsius (°C) */
    "maxTemperature": 40,

    /* Temperature change steps, in Celsius (°C) */
    "minTemperatureSteps": 1,

    /* Only if your firmware reports/accepts temperatures scaled by 10 (e.g. 170 = 17.0 °C) */
    "temperatureDivisor": 10
}
```

### Heat Convectors
The heating panels have a _low_ or _high_ setting but since HomeKit's definition doesn't accommodate that, I have mapped it to `Fan Speed`; be aware that when the fan speed slider is at the lowest value, it turns the device off. By default, the plugin uses _LOW_ and _HIGH_ to request these settings and these commands can be configured using `cmdLow` and `cmdHigh`; if your device uses _Low_ and _High_, add these two additional parameters to your config. Additional parameters can be found in the sample below.

If your signature doesn't have a variation of _low_ or _high_, `SimpleHeater` would be the correct device `type` to use and not this one. 

```json5
{
    "name": "My Heat Convector",
    "type": "Convector",
    "manufacturer": "Gorenje",
    "model": "OptiHeat 2000 EWP",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier of activity */
    "dpActive": 7,

    /* Override the default datapoint identifier for the desired temperature*/
    "dpDesiredTemperature": 2,

    /* Override the default datapoint identifier for the current temperature */
    "dpCurrentTemperature": 3,

    /* Override the default datapoint identifier for rotation speed */
    "dpRotationSpeed": 4,

    /* Override the default datapoint identifier for child-lock */
    "dpChildLock": 6,

    /* Override the default datapoint identifier for temperature-display units */
    "dpTemperatureDisplayUnits": 19,

    /* Override phrase for low setting */
    "cmdLow": "Low",

    /* Override phrase for high setting */
    "cmdHigh": "High",

    /* This device does not provide locking the physical controls */
    "noChildLock": true,

    /* This device has no function to change the temperature units */
    "noTemperatureUnit": true,

    /* Minimum temperature supported, in Celsius (°C) */
    "minTemperature": 15,

    /* Maximum temperature supported, in Celsius (°C) */
    "maxTemperature": 35
}
```

### Simple Dimmers / WLED Dimmers
These are switches that allow turning on and off, and dimming. Two distinct types are available:

- `SimpleDimmer` — a plain dimmer with power and brightness control.
- `WledDimmer` — a dimmer that can additionally drive a [WLED](https://kno.wled.ge/) controller (e.g. a Tuya-based relay/dimmer feeding power to a WLED strip). With none of the WLED options below configured, it behaves exactly like a `SimpleDimmer`.

The following options apply to `WledDimmer` only (they are ignored by `SimpleDimmer`):

- `syncBrightnessToWled`: set to the WLED device IP (e.g. "192.168.1.50" or "192.168.1.50:80") to sync HomeKit brightness changes directly to WLED over HTTP, keeping the Tuya dimmer at 100%. This talks to the WLED controller directly on your **LAN**, independently of how the Tuya dimmer is reached — so if the Tuya dimmer is ever on the cloud fallback (because the LAN is down), the WLED sync is best-effort and may not go through until the LAN is back.
- `presetEffects`: array of effect configs to expose as switches in HomeKit (each turns on a WLED fx preset, optionally with staticColor).

```json5
{
    "name": "My WLED Dimmer",
    "type": "WledDimmer",
    "manufacturer": "TESSAN",
    "model": "Smart Dimmer Switch",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for power */
    "dpPower": 1,

    /* Override the default datapoint identifier for brightness */
    "dpBrightness": 2,

    /* Override the default datapoint identifier for scaleBrightness. Common values are 255 or 1000 */
    "scaleBrightness": 1000,

    /* WLED sync: forward brightness to a WLED instance instead of using the Tuya dimmer's level */
    "syncBrightnessToWled": "192.168.1.123",

    /* Optional preset effect switches (for WLED) */
    "presetEffects": [
      { "name": "Solid", "fx": 0, "staticColor": "#FFFFFF" },
      { "name": "Rainbow", "fx": 2 }
    ]
}
```

### Simple Heaters
While defined mainly to develop a more robust device type, this can be used to control a heating device by only setting a desired temperature.

```json5
{
    "name": "My Simple Heater",
    "type": "SimpleHeater",
    "manufacturer": "Branded",
    "model": "Simple",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for being active */
    "dpActive": 1,

    /* Override the default datapoint identifier for the desired temperature */
    "dpDesiredTemperature": 2,

    /* Override the default datapoint identifier for the current temperature */
    "dpCurrentTemperature": 3,

    /* If your device reports temperatures in multiples of the real value, introduce it here.
       e.g., if your device reports 155 for 15.5°C, use the value 10 */
    "temperatureDivisor": 1,

    /* Minimum temperature supported, in Celsius (°C) */
    "minTemperature": 15,

    /* Maximum temperature supported, in Celsius (°C) */
    "maxTemperature": 35
}
```

### Garage Doors
While still in early testing, you can use this to open and close the garage doors. If your garage door or garage door opener does more that just open and close, for example reports its position or detects obstacles, please create an issue and paste your signature with any information you can provide; this is so we can build a better solution for you together.

```json5
{
    "name": "My Garage Door",
    "type": "GarageDoor",
    "manufacturer": "eWeLink",
    "model": "WiFi Switch Garage Door Controller",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for triggering the opener */
    "dpAction": 1,

    /* Override the default datapoint identifier for the state of the door */
    "dpStatus": 2,

    /* If the app reports open when the door is closed, 
       and reports closed when it is open */
    "flipState": true
}
```

### Simple Garage Doors
For sliding gate openers and garage door controllers that expose momentary
open/stop/close action DPs plus a single status DP that reports the gate's
movement. The controller only distinguishes three states — `11` (stopped),
`12` (opening or open) and `13` (closing or closed) — so the plugin collapses
them for HomeKit: `11`/`12` are treated as **OPEN** and `13` as **CLOSED**.
Both the current and target door state are mirrored straight from this DP, so
HomeKit stays in sync however the gate was operated (Home app, a physical
remote, the Tuya app, ...).

Opening is direct: the controller reverses on its own, so an open command is
fired straight away even while the gate is closing. Closing is asymmetric — the
controller ignores a close command while the gate is actively moving. So unless
the status DP already reads `11` (stopped, e.g. after a partial-open or an
external stop, where close is accepted immediately), a close is sent as
**stop → wait `stopBeforeCloseMs` → close**. There is no obstruction detection.

```json5
{
    "name": "My Sliding Gate",
    "type": "SimpleGarageDoor",
    "manufacturer": "Generic",
    "model": "Generic Sliding Gate Controller",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for the open action */
    "dpOpen": 101,

    /* Override the default datapoint identifier for the close action */
    "dpClose": 102,

    /* Override the default datapoint identifier for the stop action
       (used by the partial-open feature and the stop-before-close) */
    "dpStop": 103,

    /* Override the default datapoint identifier for the reported state.
       11 (stopped) and 12 (opening/open) are treated as OPEN; 13
       (closing/closed) is treated as CLOSED. */
    "dpState": 105,

    /* Optional. The controller ignores a close while the gate is moving,
       so unless the state DP already reads 11 (stopped) the plugin sends
       stop, waits this many milliseconds, then sends close. Tune to about
       how long the gate takes to halt after a stop. Default 1500. */
    "stopBeforeCloseMs": 1500,

    /* Optional. If set, exposes an extra stateful switch that mirrors
       whether the gate is currently open in HomeKit's view. Tapping it
       ON triggers a partial-open: the gate opens and then stops itself
       this many milliseconds after it actually starts moving, leaving the
       gate partially open. Tapping it OFF triggers a standard full close.
       Useful for letting someone pass through briefly. Leave unset to skip
       the switch. */
    "partialOpenMs": 2000,

    /* Optional. Exposes extra Force Open and Force Close momentary
       switches alongside the main GarageDoorOpener. They fire the same
       open/close actions as the main toggle, but being plain switches
       they can be used in HomeKit automations (which won't accept
       GarageDoorOpener targets directly). Default false. */
    "forceSwitches": true
}
```

### Simple Blinds
Normally the blinds don't report their position. This plugin attempts to time the movements to guesstimate the positions. You can adjust a few parameters to make it really close for you.

```json5
{
    "name": "My Simple Blinds",
    "type": "SimpleBlinds",
    "manufacturer": "TeePao",
    "model": "Roller Switch",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* How many seconds does it take to fully open from a fully closed state  */
    "timeToOpen": 45,

    /* How many seconds it spends tightening the blinds while closing */
    "timeToTighten": 0,

    /* If the app reports open when the blinds are closed, 
       and reports closed when they are open */
    "flipState": true
}
```

### Vertical Blinds with Tilt
Support for Tuya/Graywind Smart Vertical Blinds with open/close (retract/extend) AND panel rotation (tilt). In order to handle setting both the open/close position AND the rotation simultaneously with an automation, configure the timeToClose value in seconds to be at least the amount of time it takes your blinds to close. The rotation command will be queued up to send after this delay. On my 7-foot-wide blinds, this was 20 seconds. Default is 30.

#### Minimal Configuration
```json
{
  "name": "Bedroom Blinds",
  "type": "VerticalBlindsWithTilt",
  "id": "032000123456789abcde",
  "key": "0123456789abcdef"
}
```

#### Full Configuration
```json
{
  "name": "Living Room Blinds",
  "type": "VerticalBlindsWithTilt",
  "manufacturer": "Tuya",
  "model": "Smart Vertical Blinds",
  "id": "032000123456789abcde",
  "key": "0123456789abcdef",
  "dpAction": 1,
  "dpTilt": 2,
  "dpTiltState": 3,
  "timeToClose": 30
}
```

### Percent Control Blinds
These are blinds or roller shades that natively report their current position and accept a target position as a percentage via a `percent_control` datapoint. Unlike `SimpleBlinds`, no timing calibration is needed — the device reports its actual position directly.

#### Minimal Configuration
```json
{
    "name": "My Blinds",
    "type": "PercentBlinds",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef"
}
```

#### Full Configuration
```json5
{
    "name": "My Blinds",
    "type": "PercentBlinds",
    "manufacturer": "Tuya",
    "model": "Smart Roller Blind",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for setting target position (0–100) */
    "dpPercentControl": "2",

    /* Override the default datapoint identifier for reading current position (0–100).
       Use "3" if your device reports position on a separate datapoint from control. */
    "dpPercentState": "2",

    /* If the device reports 0 as fully open instead of fully closed, flip the range */
    "flipState": true
}
```

### Outlets with White and Color Lights
These are plugs with a single outlet that that have controllable white and colored LEDs on them.

There are two kinds of color devices: (1) the most common ones use 14 characters to represent the color (`HEXHSB`), and (2) others use 12 characters for the color (`HSB`). The `colorFunction` defaults to `HEXHSB` but can be overriden in the config block to properly use the second type.

It is common for `HEXHSB` devices to use white color temperature and brightness values from 0 to 255 (scale of `255`). It is also common for `HSB` devices to use white color temperature and brightness values from 0 to 1000 (scale of `1000`). If a device doesn't follow these common values, `scaleWhiteColor` and `scaleBrightness` can help.   

```json5
{
    "name": "My Colored Outlet",
    "type": "RGBTWOutlet",
    "manufacturer": "EZH",
    "model": "Wifi Colored Smart Life Outlet",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* If your device provides energy parameters, define these */

    /* Datapoint identifier for voltage reporting */
    "voltsId": 9,

    /* Datapoint identifier for amperage reporting */
    "ampsId": 8,

    /* Datapoint identifier for wattage reporting */
    "wattsId": 7,

    /* Often voltage is reported divided by 10; if that is 
       not the case for you, override the default */
    "voltsDivisor": 10,

    /* Often amperage is reported divided by 1000; if that is
       not the case for you, override the default */
    "ampsDivisor": 1000,

    /* Often wattage is reported divided by 10; if that is
       not the case for you, override the default */
    "wattsDivisor": 10,

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for outlet power */
    "dpPower": 101,

    /* Override the default datapoint identifier for light power */
    "dpLight": 1,

    /* Override the default datapoint identifier for mode (white vs color) */
    "dpMode": 2,

    /* Override the default datapoint identifier for brightness */
    "dpBrightness": 3,

    /* Override the default datapoint identifier for color-temperature of the whites */
    "dpColorTemperature": 4,

    /* Override the default datapoint identifier for color */
    "dpColor": 5,

    /* Minimum white temperature mired value
       (See https://en.wikipedia.org/wiki/Mired) */
    "minWhiteColor": 140,

    /* Maximum white temperature mired value */
    "maxWhiteColor": 400,

    /* Override the color format (default: HEXHSB)
       Only use if your device is not recognized correctly
       Using HSB defaults the scale of brightness and white color to 1000 */
    "colorFunction": "HEXHSB",

    /* Override the default brightness scale */
    "scaleBrightness": 255,
                          
    /* Override the default color temperature scale */
    "scaleWhiteColor": 255
}
```

### Smart Fan Regulators and Accessories
These are accessories that may act as a regulator switch or an inbuilt regulator to your ceiling fan. Supported features include on/off switching, speed controls (generally managed through two buttons, one speed at a time in each direction, up and down), and direction control (forward/reverse). There are two kinds of regulator devices: (1) the most common ones use 3 speed controls, and (2) others use 5 speed controls which are found compatible with most fan regulators in India, Australia, and the UK.

```json5
{
    "name": "My Fan",
    "type": "Fan",
    "manufacturer": "HomeMate",
    "model": "HomeMate 5-Speed Smart Touch-Controlled Fan Regulator",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Override the default datapoint identifier of activity */
    "dpActive": "1",

    /* Override the default datapoint identifier of rotation speed */
    "dpRotationSpeed": "2",

    /* Override the default datapoint identifier of direction control (forward/reverse) */
    "dpRotationDirection": 63
}
```

### Smart Fan with Light
These are accessories that combine fan and lighting control in one device. Supported features include on/off switching, speed controls (generally managed through two buttons, one speed at a time in each direction, up and down), direction control (forward/reverse), as well as light power, brightness, and color temperature controls. There are multiple kinds of devices with different speed and light control capabilities.

```json5
{
    "type": "FanLight",
    "name": "My Fan with Light",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",
    "manufacturer": "Hunter Pacific International",
    "model": "Polar v2 Fan",

    "dpLight": 20,
    "useBrightness": true,
    "dpBrightness": 22,
    "minBrightness": 1,
    "scaleBrightness": 9,
    "dpColorTemperature": 23,

    "dpActive": 60,
    "dpRotationSpeed": 62,
    "maxSpeed": 9,
    "dpRotationDirection": 63
}
```

If the light, brightness and turning the fan **off** all work, but turning the fan **on** or changing its speed is silently ignored, your fan's firmware most likely rejects LAN packets that carry more than one data point at once (some `fsd` ceiling fans behave this way). Set `"singleDpWrites": true` to send the fan power and speed as separate packets — matching how the Tuya cloud issues these commands:

```json5
{
    "type": "FanLight",
    "name": "My Fan with Light",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    "dpActive": 60,
    "dpRotationSpeed": 62,

    /* Send each data point in its own packet instead of combining them. */
    "singleDpWrites": true
}
```

### Irrigation Systems / Sprinklers

Multi-valve Tuya irrigation/sprinkler controllers (the battery-powered Wi-Fi "faucet timers" that expose several `switch_*` valves and a `battery_percentage`) are exposed as a single, fully-fledged HomeKit **Irrigation System** accessory:

* one **Irrigation System** tile that contains every zone,
* one **Valve** per zone (`ValveType = Irrigation`) — each with its own on/off, its own **Duration** picker and a live countdown,
* an optional **Battery** service (level, low-battery warning, and — for solar/USB-C rechargeable units that report it — live charging status).

Because these devices are slow to respond, all zone changes that happen close together — turning the whole system on/off, or running a scene that toggles several zones — are merged into a **single** Tuya command instead of a burst of them.

> **⚠️ Can't connect locally?** Most of these are battery-powered **"sleepy"** devices that **cannot be controlled over the LAN at all** — they sleep to save battery and only ever reach Tuya's cloud. If discovery never finds yours (or it won't connect), control it over the **[Tuya Cloud](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Tuya-Cloud-Setup.md)** instead: add cloud credentials once and set `"cloud": true` on the device. Everything below works the same — data-points are just addressed by their Tuya *code* (e.g. `switch_1`), which the plugin logs on startup.

```json5
// Cloud example (also needs a top-level "cloud" credentials block — see the Tuya Cloud Setup guide)
{
    "name": "Garden Irrigation",
    "type": "IrrigationSystem",
    "id": "bfae6739xxxxxxxxxxxxxx",   // the cloud Device ID
    "cloud": true,
    "valveCount": 4
}
```

#### Minimal Configuration

The defaults match the common 4-zone layout (valves A–D on data-points `1`–`4`, battery on `46`):

```json5
{
    "name": "Garden Irrigation",
    "type": "IrrigationSystem",
    "manufacturer": "Generic",
    "model": "4-Zone Water Timer",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef"
}
```

#### Per-zone timers and "indefinite" mode

Each zone has its own **Duration**. When a zone is switched on it runs for that duration and is then closed automatically. Two mechanisms enforce this together:

* a **software timer** in the plugin drives HomeKit's live countdown and the precise (sub-minute) shut-off while Homebridge is connected — it also re-closes a zone that was switched on at the device or that was already running when Homebridge restarted; and
* the device's **own countdown timer**, when the controller exposes one (`countdown_1..n`, DP `17..` by default). Each zone's duration is mirrored to it (as whole minutes), so the valve still closes on schedule **even if Homebridge or the network drops out while it's running** — the hardware closes itself. This is on by default whenever the device reports these data-points; set `nativeCountdown: false` to fall back to the software timer alone.

On connect the plugin lines the two up: a valid device countdown is adopted as the zone's Duration, while a device left on an unbounded (`0`) or out-of-range countdown is corrected to HomeKit's own Duration so a zone can never be stuck running with no auto-close.

* Set a zone's duration to **`0`** to make it run **indefinitely** (until it is switched off again) — handy for long, manual watering tasks. (The hardware countdown is set to `0` too, which the device also reads as "no limit".)
* The hardware countdown is whole **minutes**, capped by the device at **120 min**; HomeKit's Duration is in seconds. The largest device countdown the plugin treats as valid is also bounded by `maxDuration` (default `7200`s = 120 min) — lower `maxDuration` to e.g. `3600` to have any device countdown over 60 minutes corrected down on connect.
* Apple's Home app only offers duration presets up to **1 hour**. For longer runs (up to `maxDuration`) or to preset "indefinite" zones, set `defaultDuration` / the per-valve `defaultDuration` in the config, or use the Eve app.

#### Master ("toggle all") switch

Switching the whole Irrigation System tile **off** closes every open zone, and switching it **on** opens every zone — each as one combined command (mirroring the physical "all" button many of these controllers have). Either direction can be disabled with `masterTurnsOffAllZones` / `masterTurnsOnAllZones`.

#### Full Configuration

```json5
{
    "name": "Garden Irrigation",
    "type": "IrrigationSystem",
    "manufacturer": "Generic",
    "model": "4-Zone Water Timer",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* --- Zones --- */
    /* Simple: number of valves on sequential data-points 1, 2, 3, … */
    "valveCount": 4,
    /* …or, for custom names / non-sequential data-points, define them explicitly
       (this overrides valveCount). defaultDuration is in seconds; 0 = indefinite.
       dpCountdown is the device's built-in auto-off timer for the zone; it
       defaults to the switch dp + 16 (so switch 1 → countdown 17) and only needs
       setting for code-addressed or non-standard zones. */
    "valves": [
        { "name": "Front Lawn", "dp": 1, "defaultDuration": 900 },
        { "name": "Back Lawn",  "dp": 2, "defaultDuration": 900 },
        { "name": "Flower Beds","dp": 3, "defaultDuration": 600 },
        { "name": "Drip Line",  "dp": 4, "defaultDuration": 0, "dpCountdown": 20 }
    ],

    /* --- Timers --- */
    "defaultDuration": 600,   /* default per-zone run time, seconds (0 = indefinite) */
    "maxDuration": 7200,      /* upper bound advertised to HomeKit, seconds */
    "nativeCountdown": true,  /* mirror durations to the device's own countdown timer
                                 (countdown_1.., DP 17..) so zones still auto-close
                                 offline; set false for software-timer-only */

    /* --- Master switch behaviour --- */
    "masterTurnsOnAllZones": true,
    "masterTurnsOffAllZones": true,
    "commandDebounce": 500,   /* ms window for merging zone changes into one command */

    /* --- Battery (omit / set noBattery:true if mains-powered) --- */
    "dpBattery": 46,
    "lowBatteryThreshold": 20,
    "dpCharging": 101,   /* boolean charging-status DP (solar / USB-C); omit if not reported */
    /* "noBattery": true, */
}
```
