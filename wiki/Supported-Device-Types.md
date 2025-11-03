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
|Simple Heater|`SimpleHeater`<sup>[9](#simple-heaters)</sup>|Heating solutions with only temperature control <small>([instructions](#simple-heaters))</small>|
|Garage Door|`GarageDoor`<sup>[10](#garage-doors)</sup>|Smart garage doors or garage door openers <small>([instructions](#garage-doors))</small>|
|Simple Blinds|`SimpleBlinds`<sup>[11](#simple-blinds)</sup>|Smart blinds and smart switches that control blinds <small>([instructions](#simple-blinds))</small>|
|Simple Blinds2|`SimpleBlinds2`<sup>[11](#simple-blinds)</sup>|Smart blinds and smart switches that control blinds(Use if simple Blinds (1) doesn't work for you. <small>([instructions](#simple-blinds))</small>|
|Vertical Blinds with Tilt|`VerticalBlindsWithTilt`<sup>[11](#vertical-blinds-with-tilt)</sup>|Smart vertical blinds with open/close and panel rotation <small>([instructions](#vertical-blinds-with-tilt))</small>|
|Smart Plug w/ White and Color Lights|`RGBTWOutlet`<sup>[12](#outlets-with-white-and-color-lights)</sup>|Smart plugs that have controllable RGBTW LEDs <small>([instructions](#outlets-with-white-and-color-lights))</small>|
|Smart Fan Regulator|`SimpleFanAccessory`<sup>[more](#smart-fan-regulators-and-accessories)</sup>|Smart Fan Regulators that have controllable Speeds <small>([instructions](#smart-fan-regulators-and-accessories))</small>|
|Smart Fan with Light|`SimpleFanLightAccessory`<sup>[more](#smart-fan-with-light)</sup>|Smart Fan devices that have controllable Speeds, Directions and a built-in Light<small>([instructions](#smart-fan-with-light))</small>|




## Additional Parameters
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
These devices have cooling and/or heating capabilities; they could also have _dry_, _fan_, or others modes but HomeKit's definition doesn't facilitate modes other than _heat_, _cool_, and _auto_. By default, _heat_ and _cool_ modes are enabled; to let the plugin know that a device doesn't have heating or cooling capabilities, add an additional parameter named `noHeat` or `noCool` and set it to `true`. Tuya devices don't follow a unified pattern for naming the modes, for example cooling mode is called _COOL_ on Kogan's KAPRA14WFGA and _cold_ on Igenix's IG9901WIFI; by default, the plugin uses the phrases _COOL_ and _HEAT_ while communicating with your device but to let the plugin know that a device has different phrases, add additional parameters using `cmdHeat` and `cmdCool`. Additional parameters can be found in the sample below.

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

    /* Override cooling phrase */
    "cmdCool": "COOL",

    /* Override heating phrase */
    "cmdHeat": "HEAT",

    /* This device has no oscillation (swinging) function */
    "noSwing": true,

    /* Minimum temperature supported, in Celsius (°C) */
    "minTemperature": 15,

    /* Maximum temperature supported, in Celsius (°C) */
    "maxTemperature": 40,

    /* Temperature change steps, in Celsius (°C) */
    "minTemperatureSteps": 1
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

### Simple Dimmers
These are switches allow turning on and off, and dimming. 

```json5
{
    "name": "My Simple Dimmer",
    "type": "SimpleDimmer",
    "manufacturer": "TESSAN",
    "model": "Smart Dimmer Switch",
    "id": "032000123456789abcde",
    "key": "0123456789abcdef",

    /* Additional parameters to override defaults only if needed */

    /* Override the default datapoint identifier for power */
    "dpPower": 1,

    /* Override the default datapoint identifier for brightness */
    "dpBrightness": 2

    /* Override the default datapoint identifier for scaleBrightness. Common values are 255 or 1000 */
    "scaleBrightness": 1000

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
