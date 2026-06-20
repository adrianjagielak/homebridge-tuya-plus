<p align="center">
    <img src="https://raw.githubusercontent.com/adrianjagielak/homebridge-tuya-plus/main/assets/Tuya-Plugin-Branding.png" height="100"><br>
</p>


<span align="center">

# homebridge-tuya-plus

[![npm](https://img.shields.io/npm/v/homebridge-tuya-plus.svg)](https://www.npmjs.com/package/homebridge-tuya-plus)


</span>



A community-maintained Homebridge plugin for controlling Tuya devices locally over LAN. Control your supported Tuya accessories locally in HomeKit.

* [Supported Device Types](#supported-device-types)
* [Supported Tuya Protocol Versions](#supported-tuya-protocol-versions)
* [Installation Instructions](#installation-instructions)
* [Configuration](#configuration)
* [Known Issues](#known-issues)
* [Troubleshooting](#troubleshooting)
* [Credits](#credits)
* [License](#license)
* [Donating](#donating)

## Supported Device Types
> Click the number next to your device to find the possible DataPoint "DP" values, then add as needed to your config.

* Air Conditioner<sup>[1](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#air-conditioners)</sup> 
* Air Purifiers<sup>[2]()</sup>
* Convectors<sup>[3](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#heat-convectors)</sup>
* Dehumidifers<sup>[4](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md)</sup>
* Dimmers<sup>[5](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#simple-dimmers)</sup>
* Fan<sup>[6](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md)</sup>
* Fan v2<sup>[7](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md)</sup>
* Garages<sup>[8](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#garage-doors)</sup>
* Heaters<sup>[9](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md)</sup>
* Irrigation Systems / Sprinklers<sup>[17](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#irrigation-systems--sprinklers)</sup> (multi-valve, per-zone timers, rain sensor, battery)
* Lights
  * On/Off<sup>[10](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md)</sup>
  * Brightness<sup>[11](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#tunable-white-light-bulbs)</sup>
  * Color<sup>[12](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#white-and-color-light-bulbs)</sup> (Hue, Saturation, Adaptive Lighting)
* Oil Diffusers<sup>[13](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md)</sup>
* Outlets<sup>[14](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#outlets)</sup>
* Switches<sup>[15](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#switch)</sup>
* Vertical Blinds<sup>[16](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#vertical-blinds-with-tilt)</sup>

Note: Motion, and other sensor types don't behave well with responce requests, so they will not be added. 

## Supported Tuya Protocol Versions

The plugin speaks every published Tuya LAN protocol version:

| Tuya LAN protocol | Framing | Encryption | Status |
|---|---|---|---|
| 3.1 | `0x55AA` | AES-128-ECB (base64, control only) | ✅ Supported |
| 3.2 | `0x55AA` | AES-128-ECB | ✅ Supported |
| 3.3 | `0x55AA` | AES-128-ECB | ✅ Supported |
| 3.4 | `0x55AA` | AES-128-ECB, session key, HMAC-SHA256 | ✅ Supported |
| 3.5 | `0x6699` | AES-128-GCM, session key | ✅ Supported |
| 3.6 and newer | — | — | ✅ Forward-compatible (see below) |

The protocol version is auto-detected from the device's discovery broadcast, so you normally don't need to configure anything.

Protocol **3.5** is currently the newest Tuya LAN protocol in existence: it is the latest version implemented by Tuya's own open-source device SDK ([TuyaOpen](https://github.com/tuya/TuyaOpen)) and by the reference reverse-engineered implementations ([tinytuya](https://github.com/jasonacox/tinytuya/blob/master/PROTOCOL.md)). No device firmware speaking a "3.6" protocol has been observed in the wild so far.

This plugin is nevertheless **3.6-ready**: if a device reports a newer protocol version (e.g. `3.6`) in its broadcast, the plugin automatically talks to it using the newest (3.5/GCM) protocol stack while tagging payloads with the device's reported version — the same forward-compatibility strategy used by tinytuya. Should such a device misbehave, you can pin it to a specific protocol with the `forceVersion` device option (e.g. `"forceVersion": "3.5"`), or use `version` to set a protocol for devices that can't be discovered (e.g. on another subnet).

## Cloud devices (for hardware that can't be controlled locally)

This is a **LAN-first** plugin — virtually every Tuya device is controlled locally, which is faster, more private, and keeps working without internet. A few devices, though, simply **can't** be reached over the LAN: battery-powered "sleepy" devices — most notably the multi-zone **irrigation / faucet timers** — sleep almost all the time and only ever connect out to Tuya's cloud, so they never answer on the local network (Tuya's own docs confirm LAN control is unavailable for these low-power devices).

For exactly these cases the plugin can talk to a device through the **Tuya Cloud** instead — strictly **opt-in, per device**. You add your Tuya Cloud project credentials once and set `"cloud": true` on the device; everything else (including the full Irrigation System accessory — all zones, durations, battery) works the same. Live updates arrive instantly over Tuya's MQTT message service.

👉 **[Tuya Cloud Setup guide](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Tuya-Cloud-Setup.md)** — how to get credentials and configure a cloud device.

## Installation Instructions

#### Option 1: Install via Homebridge Config UI X:

Search for "Tuya" in [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x) and install `homebridge-tuya-plus`.

#### Option 2: Manually Install:

```
sudo npm install -g homebridge-tuya-plus
```

#### Bleeding-edge (`dev`) builds:

Every commit to `main` is automatically published to npm under the `dev` tag — a
separate, unstable channel. The stable release always stays on `latest`, so this
won't affect normal installs. To try the latest in-development build:

```
sudo npm install -g homebridge-tuya-plus@dev
```

These are versioned like `3.13.1-dev.<n>` and may be unstable; use the default
install above for production.

## Configuration
> UI

1. Navigate to the Plugins page in [homebridge-config-ui-x](https://github.com/oznu/homebridge-config-ui-x).
2. Click the **Settings** button for the Tuya plugin.
3. Add your device types
4. Add device parameters<sup>[10](apple.com/)</sup>
5. Restart Homebridge for the changes to take effect.

> Manual

1. Edit the config.json file to add your device types, and parameters. 
2. Restart Homebridge

## Known Issues

1. If your devices add, but you can't control them, make sure you entered the DataPoint "DP" values for your device. 

## Contributing

If you have new accessory logic for a new device, please add a function defined by manufacturer, and describe your changes in the readME file. 

## Credits

* [iRayanKhan](https://github.com/iRayanKhan) - developer of the original [homebridge-tuya](https://github.com/iRayanKhan/homebridge-tuya) plugin. 
* [AMoo-Miki](https://github.com/AMoo-Miki) - developer of the [Tuya-Lan](https://github.com/AMoo-Miki/homebridge-tuya-lan) plugin which this plugin is based off. 
* mxDanger - Plugin branding.
* [CodeTheWeb](https://github.com/CodeTheWeb) - developer of [TuyaApi](https://github.com/codetheweb/tuyapi), who gratiously provided this repo's name.
* [Oznu](https://github.com/oznu) - developer of Homebridge, added ```config.schema.json``` , fixed dependencies, and helped inspire this readME off his [gsh](https://github.com/oznu/homebridge-gsh) plugin.

#

Go check out my other Homebridge plugins:

* [homebridge-futurehome](https://github.com/adrianjagielak/homebridge-futurehome) ([npm](https://npmjs.com/package/homebridge-futurehome))
* [homebridge-tuya-plus](https://github.com/adrianjagielak/homebridge-tuya-plus) ([npm](https://npmjs.com/package/homebridge-tuya-plus))
* [homebridge-eqiva-swift-bridge](https://github.com/adrianjagielak/eqiva-smart-lock-bridge) ([npm](https://npmjs.com/package/homebridge-eqiva-swift-bridge))
* [homebridge-intex-plus](https://github.com/adrianjagielak/homebridge-intex-plus) ([npm](https://npmjs.com/package/homebridge-intex-plus))
* [homebridge-simple-router-status](https://github.com/adrianjagielak/homebridge-simple-router-status) ([npm](https://npmjs.com/package/homebridge-simple-router-status))
