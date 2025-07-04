Below is a list of configurations for devices by users of the plugin. Please follow the example template below, and include a link to the device. 


# Air Conditioner:



# Air Purifier



# Convector


# Dehumidifier


# Dimmer

## Simple Dimmer

**Treatlife Dimmable Smart Plug for Lamps**



Tested plugin version: ```2.0.1```

Tested by: [@benwtf](https://www.github.com/benwtf)

Link to buy: [Amazon](https://www.amazon.com/Treatlife-Dimmer-Halogen-Incandescent-Outlets/dp/B08LPYXK6L/ref=sr_1_2_sspa)

Capabilities: 
- [X] On/Off
- [X] Dimming
- [ ] Timer (Use Tuya app)
- [ ] Dimming Config (Use Tuya app)

Config: 
```json
            {
                "type": "SimpleDimmer",
                "name": "Lamp",
                "id": "xxx",
                "key": "xxx",
                "manufacturer": "Treatlife",
                "model": "WiFi Smart Dimmer Plug",
                "scaleBrightness": 1000
            }
```

Schema/DP's:
```
```


**Treatlife Dimmable Smart Plug DP12**

Tested plugin version: ```2.0.1```

Tested by: [@benwtf](https://www.github.com/benwtf)

Link to buy: [Amazon](https://www.amazon.com/Version-Treatlife-Individual-Control-Compatible/dp/B098DX5T92/ref=sr_1_1_sspa?crid=13J76MIVO3TS5&keywords=Treatlife+Smart+Dimmer+Plug&qid=1644282647&s=industrial&sprefix=treatlife+smart+dimmer+plug%2Cindustrial%2C246&sr=1-1-spons&psc=1&spLa=ZW5jcnlwdGVkUXVhbGlmaWVyPUE3SEZKM1laUE1aNjMmZW5jcnlwdGVkSWQ9QTAyODE4NjQxU0wxMzZZU0pQOE5aJmVuY3J5cHRlZEFkSWQ9QTAzMTQ3ODFDQTFNQ05aR0JXRVQmd2lkZ2V0TmFtZT1zcF9hdGYmYWN0aW9uPWNsaWNrUmVkaXJlY3QmZG9Ob3RMb2dDbGljaz10cnVl)

Notes: Works for plug 1. Can't figure out how to get Plug 2 set up yet.

Config:
```json
             {
                "type": "SimpleDimmer",
                "name": "TreatLife Dimmer",
                "id": "ab123c45cde6fgh789",
                "key": "111a22b3333cd444",
                "manufacturer": "TreatLife",
                "model": "DP12",
                "dpPower": 1,
                "dpBrightness": 2,
                "scaleBrightness": 1000
            }
```

Schema/DP's:
```json
      "status": [
        {
          "code": "switch_led_1",
          "value": true
        },
        {
          "code": "bright_value_1",
          "value": 528
        },
        {
          "code": "brightness_min_1",
          "value": 528
        },
        {
          "code": "led_type_1",
          "value": "led"
        },
        {
          "code": "countdown_1",
          "value": 0
        },
        {
          "code": "switch_led_2",
          "value": false
        },
        {
          "code": "bright_value_2",
          "value": 183
        },
        {
          "code": "brightness_min_2",
          "value": 183
        },
        {
          "code": "led_type_2",
          "value": "led"
        },
        {
          "code": "countdown_2",
          "value": 0
        },
        {
          "code": "light_mode",
          "value": "relay"
        }
      ],
```

# Fan


## Fan v2


## Fan Light

**Aubric Smart WiFi Fan Switch**

Tested plugin version: ```2.0.1```

Tested by: [@benwtf](https://github.com/benwtf)

Link to buy: [Amazon](https://www.amazon.com/gp/product/B07Z948VY4)

Capabilities: 
- [X] Fan Control
- [X] Light Control
- [ ] Timer (Use Tuya app)
- [ ] Beep/sound settings (Use Tuya app)

Config: 
```json

                {
                    "type": "Fanlight",
                    "name": "Bedroom Ceiling Fan",
                    "id": "xxx",
                    "key": "xxx",
                    "manufacturer": "Aubric",
                    "model": "Smart WiFi Fan Switch",
                    "useBrightness": "False",
                    "maxSpeed": 3
                }
```

Schema/DP's:
```
```


# Garage


# Heater


# Lights

## Simple Light (No Color)


## TW Light (Tunable White Light)

**MiBoxer / MiLight Tuya WL5 LightStrip Dimmer/Controller in TW Mode**

Tested plugin version: ```2.0.1```

Tested by: [@chellmann](https://github.com/chellmann)

Link to buy: [Amazon](https://www.amazon.de/s?k=miboxer+wl5)

Config:
```json
{
                    "type": "TWLight",
                    "name": "XXXX",
                    "id": "XXXX",
                    "ip": "192.168.30.100",
                    "key": "XXXX",
                    "manufacturer": "MiBoxer",
                    "model": "WL5",
                    "dpPower": 20,
                    "dpBrightness": 22,
                    "dpColorTemperature": 23,
                    "minWhiteColor": 188, //according to your LED Strip, Value in Mired - (1000000 / Kelvin)
                    "maxWhiteColor": 454,
                    "scaleBrightness": 1000,
                    "scaleWhiteColor": 1000
                }
```

**Merkury Innovations Dimmable 75W Equivalent Wi-Fi Smart Bulb, Color - BW904**

Tested plugin version: ```2.0.1```

Tested by: [@clarionite](https://github.com/clarionite)

Link to buy: [WalMart](https://www.walmart.com/ip/Merkury-Innovations-Dimmable-75W-Equivalent-Wi-Fi-Smart-Bulb-Color-4-Pack/521143695?wmlspartner=wlpa&selectedSellerId=0&wl13=3057&adid=22222222420450916370&wmlspartner=wmtlabs&wl0=&wl1=g&wl2=c&wl3=547331341345&wl4=aud-1219917706781:pla-293946777986&wl5=9027965&wl6=&wl7=&wl8=&wl9=pla&wl10=8175035&wl11=local&wl12=521143695&wl13=3057&veh=sem_LIA&gclid=CjwKCAiAo4OQBhBBEiwA5KWu_3B33XEAxJ1jUy4EaqpqvtVFJWXRaLDrBiD2XHNIQ7nmQBrIkLUdAhoCPE0QAvD_BwE&gclsrc=aw.ds)

Capabilities: 
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color Temperature 

Config:
```json
             {
                    "type": "RGBTWLight",
                    "name": "Merkury Color",
                    "id": "ab123c45cde6fgh789",
                    "key": "111a22b3333cd444",
                    "manufacturer": "Merkury BW904 Smart Bulb",
                    "model": "MI-BW904-999W",
                    "dpColorTemperature": 4
                }
```

Schema/DP's:
```
```

**Treatlife Smart Tunable White Bulb**

Tested plugin version: ```2.0.1```

Tested by: [@benwtf](https://www.github.com/benwtf)

Link to buy: [Amazon](https://www.amazon.com/gp/product/B08J3X9XQ3)

Capabilities: 
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color Temperature 
- [ ] - Timer (Use Tuya app)

Config: 
```json
                {
                    "type": "TWLight",
                    "name": "Office Lamp",
                    "id": "xxx",
                    "key": "xxx",
                    "manufacturer": "Treatlife",
                    "model": "Smart Light Bulb",
                    "dpPower": 20,
                    "dpBrightness": 22,
                    "dpColorTemperature": 23,
                    "minWhiteColor": 154,
                    "maxWhiteColor": 370,
                    "scaleBrightness": 1000,
                    "scaleWhiteColor": 1000
                }
```

Schema/DP's:
```
```

**Arlec Grid Connect Smart 9.5W 806lm CCT ES Globe**

Tested plugin version: ```2.0.1```

Tested by: [@stoms12](https://github.com/stoms12)

Link to buy: [Bunnings](https://www.bunnings.co.nz/arlec-grid-connect-smart-9-5w-806lm-cct-es-globe_p0119820)

Capabilities: 
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color Temperature 
- [ ] - Timer (Use Tuya app)

Config: 
```json
        {
            "type": "TWLight",
            "name": "XXXX",
            "id": "XXXX",
            "key": "XXXX",
            "manufacturer": "Arlec",
            "model": "GLD110HA",
            "dpPower": 20,
            "dpBrightness": 22,
            "dpColorTemperature": 23,
            "minWhiteColor": 153,
            "maxWhiteColor": 413,
            "scaleBrightness": 1000,
            "scaleWhiteColor": 1000
        }
```

Schema/DP's:
```
```


**Merkury Innovations A19 Smart Light - BW942**

Tested plugin version: ```2.0.1```

Tested by: [@clarionite](https://github.com/clarionite)

Link to buy: [WalMart](https://www.walmart.com/ip/Merkury-Innovations-A19-Smart-Light-Bulb-60W-Dimmable-White-LED-Requires-2-4GHz-WiFi-1-Pack/493986946)

Capabilities: 
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color Temperature 

Config:
```json

             {
                    "type": "TWLight",
                    "name": "Merkury White Light",
                    "id": "ab123c45cde6fgh789",
                    "key": "111a22b3333cd444",
                    "manufacturer": "Merkury BW924 Bulb",
                    "model": "219605-MI-BW942"
                }

```

Schema/DP's:
```
```

**Ledvance Smart+ SUN@Home LED Recessed Spotlight / Downlight**

Tested plugin version: `3.1.1`

Tested by: [@whatUwant](https://github.com/whatUwant)

Link to buy: [Amazon](https://www.amazon.de/dp/B09B7L5NCX)

Capabilities: 
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color Temperature 

Config:
```json
{
  "type": "TWLight",
  "name": "Ledvance SUN@Home Downlight",
  "id": "ID_HERE",
  "key": "KEY_HERE",
  "manufacturer": "Ledvance",
  "model": "LDV S@H DL 120",
  "dpPower": 20,
  "dpBrightness": 22,
  "dpColorTemperature": 23,
  "minBrightness": 1,
  "scaleBrightness": 1000,
  "minWhiteColor": 200,
  "maxWhiteColor": 454,
  "scaleWhiteColor": 1000,
  "version": "3.3"
}
```

Schema/DP's:
```
```


## RGBTW Light (Red, Green, Blue, Tunable White Light)


**ChangM e16 Chandelier Bulb** 

Tested plugin version(s): ```(1.4.0 -> 2.0.1)```

Tested by: [@iRayanKhan](https://Github.com/iRayanKhan)

Link to buy: Amazon (removed)

Capabilities:
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color

Config: 
```json
                {
                    "name": "A Light",
                    "type": "RGBTWLight",
                    "manufacturer": "Rayan Khan",
                    "model": "OoogaBooga",
                    "id": "xx",
                    "key": "xx",
                    "scaleBrightness": 1000,
                    "dpPower": 20,
                    "dpMode": 21,
                    "dpBrightness": 22,
                    "dpColor": 24,
                    "colorFunction": "HSB"
                }
```

Schema/DP's:
```
```

**Feit Smart WiFi Bulb** 

Tested plugin version: ```2.0.1```

Tested by: [@dropbeardevs](https://github.com/dropbeardevs)

Link to buy: [Costco](https://www.costco.com/feit-electric-wi-fi-smart-bulbs%2c-4-pack.product.100417461.html)

Capabilities:
- [X] - Adaptive Lighting
- [X] - Brightness
- [X] - Color Temperature
- [X] - Color


Config: 
```json
                {
                    "type": "RGBTWLight",
                    "name": "xx",
                    "id": "xx",
                    "key": "xx",
                    "manufacturer": "Feit",
                    "model": "Smart WiFi Bulb",
                    "dpPower": 20,
                    "dpBrightness": 22,
                    "dpColorTemperature": 23,
                    "minWhiteColor": 140,
                    "maxWhiteColor": 400,
                    "dpMode": 21,
                    "dpColor": 24,
                    "colorFunction": "HSB",
                    "scaleBrightness": 1000,
                    "scaleWhiteColor": 1000
                }


```

Schema/DP's:
```
```


# Oil Diffuser



# Outlet

**Treatlife Smart Plug**

Tested plugin version: ```2.0.1```

Tested by: [@benwtf](https://www.github.com/benwtf)

Link to buy: [Amazon](https://www.amazon.com/Treatlife-Programmable-Outlet-Compatible-Assistant/dp/B088PNCJFQ/ref=sr_1_1_sspa)

Capabilities:
- [X] On/Off
- [ ] Timers (Use Tuya app)

Config: 
```json

            {
                "type": "Outlet",
                "name": "Subwoofer",
                "id": "xxx",
                "key": "xxx",
                "manufacturer": "Treatlife",
                "model": "Smart WiFi Plug"
            }

```

Schema/DP's:
```
```



# Switch


# Thermostat

