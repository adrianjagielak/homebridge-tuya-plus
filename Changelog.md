# Changelog

All notable changes to this project will be documented in this file. This project uses [semantic versioning](https://semver.org/).

## Unreleased

* [+] **Tuya Cloud support for devices that can't be reached over the LAN** — most notably battery-powered "sleepy" irrigation/sprinkler timers, which sleep almost all the time and only ever talk to Tuya's cloud, so the local protocol can never reach them. The plugin stays LAN-first: cloud is strictly opt-in. Add a top-level `cloud` credentials block (or a per-device `cloud` object) and set `"cloud": true` on the device.
  * Realtime updates arrive over Tuya's **MQTT** message service (via the optional `mqtt` dependency, installed automatically); initial state and control use the Tuya OpenAPI. There is no polling.
  * Works with both **Custom** and **Smart Home** Cloud projects (the latter via app-account login).
  * The existing **IrrigationSystem** accessory works unchanged over the cloud — its data-points are simply addressed by Tuya "code" (e.g. `switch_1`, `battery_percentage`) instead of a numeric id; the device logs its codes on startup.
  * See the wiki: **[Tuya Cloud Setup](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Tuya-Cloud-Setup.md)**.
* [*] **Fix realtime (MQTT) cloud updates being silently dropped** — external changes (physical buttons, the Tuya app, the device's own timers) now show up in HomeKit within a second or two. The decryptor was verifying the AES-GCM auth tag (`decipher.final()`), but Tuya's real status frames don't carry a tag that verifies against the documented AAD, so every realtime message was being thrown away. Now decrypts with `update()` only, matching the official `tuya/tuya-homebridge` and `0x5e/homebridge-tuya-platform` implementations.
* [*] **Fix cloud irrigation valves that could be turned on but not off** — the per-zone write coalescer was dropping any command that matched the last-known `device.state`. Cloud devices never optimistically advance `state` (it only moves once the realtime stream confirms the device), so an "off" issued before the "on" was echoed matched the stale "off" and was discarded — HomeKit showed the zone closed while it kept running. Queued commands are now sent as-is (callers already queue only genuine changes).
* [*] **IrrigationSystem: remove the rain sensor.** It never reported reliably on these devices, and bundling a sensor (a different HomeKit category) in the same accessory forced the Home app to fragment the sprinkler into "sub-accessories" — blocking control from the main tile and hiding the system master on/off. The accessory is now a single, clean sprinkler tile (IrrigationSystem + valves + optional battery); any leftover Contact/Leak sensor service from a previous build is removed automatically on restart. The `noRainSensor`, `rainSensorType`, `rainInverted`, `dpRain` and `rainOnValue` options are gone.
* [*] **IrrigationSystem: add the HAP Service Label service for multi-valve controllers** — an accessory that exposes a collection of same-type services (more than one `Valve`) must include a `ServiceLabel` service to anchor each valve's `ServiceLabelIndex`. It was missing, so stricter Home app clients (notably iOS) scattered the zones as separate tiles instead of nesting them under the single irrigation tile. The service is added automatically (with the Arabic-numerals namespace) whenever there is more than one valve; user-set zone names still take precedence.
* [*] **IrrigationSystem: stop the valve toggle flickering after a press** — tapping a zone briefly snapped back to the old state before settling on the new one. The `Active` getters returned the raw `device.state`, which (for cloud devices) only advances once the realtime stream echoes the write back, so a read in that window reported the pre-press value. The getters now report the value HomeKit already shows (optimistic on press, then confirmed/corrected by device-side change events); they still surface "No Response" while disconnected.
* [*] **Tuya Cloud: report real device online/offline status.** Cloud devices previously always showed as reachable. They now mirror Tuya's `online` flag (read from the device record on connect and re-checked when the realtime stream reconnects), so HomeKit shows **"No Response"** when the device is genuinely offline. If the lookup isn't permitted (the project lacks the device-management API), the device is assumed reachable so control is never blocked.

## 2.0.1 (2021-03-25)
This update includes the following changes:

[+] Fixes [#233](https://github.com/iRayanKhan/homebridge-tuya/issues/233#issue-833662092), where tempature divisor was not applying, thanks @xortuna [#238](https://github.com/iRayanKhan/homebridge-tuya/pull/238)

[!] Note: The next release of this plugin (2.1.0) will change the config to "Tuya", instead of "TuyaLan". No change is needed 'till 2.1.0 is released.
I am in need of beta testers for 2.1.0 once the next beta goes live, please stay tuned in the homebridge discord server for an announcement. 

## 2.0.0 (2021-03-12)
This update includes the following changes:

* [+] Verified by Homebridge. [#264](https://github.com/homebridge/verified/issues/264)
* [!] Note: The next release of this plugin (2.1.0) will change the config to "Tuya", instead of "TuyaLan". No change is needed 'till 2.1.0 is released.


## 1.5.1 (2021-03-02)
This update includes the following changes:

* [+] Fix garage door accessory for Wofea devices, thanks @pelletip [#221](https://github.com/iRayanKhan/homebridge-tuya/pull/221)

* [+] Fix log prefix for the following device types: BaseAccessory, RGBTWLight, SimpleBlinds(1), SimpleBlinds2, SimpleFanLight, SimpleHeater, SimpleLight, TuyaAccessory, and ValveAccessory.

* [!] Warning: V2.0 will be released once this plugin is verified. The platform name will change from TuyaLan to just Tuya. Please be prepared once V2.0 comes out. No action is required at this time. 

## 1.5.0 (2021-02-28)
This update includes the following changes:

* Updated dependencies [#215](https://github.com/iRayanKhan/homebridge-tuya/pull/215) + [#216](https://github.com/iRayanKhan/homebridge-tuya/pull/216)
* Removed plugin prefix from Manufacturer (may have to clear cachedAccessories)
* Fix crash on launch for garage accessory "ReferenceError: dps is not defined" [#201](https://github.com/iRayanKhan/homebridge-tuya/pull/201) Thanks @longzheng
* Added dpStatus configuration for Wofea garage door [#202](https://github.com/iRayanKhan/homebridge-tuya/pull/202) Thanks @longzheng
* Allow more numbers and strings for cmdLow, and cmdHigh [#204](https://github.com/iRayanKhan/homebridge-tuya/pull/204) Thanks @fra-iesus
* Note: If you have custom logic or support for an unsupported accessory, please open a PR so it can be merged in!
* Note: Update to Homebridge v1.3.1 to fix "No Response" for TW/RGBTW Lights. 

## 1.4.0 (2021-02-14)
Happy Valentines day!
This update includes the following changes, courtesy of @davidh2075:

* CachedAccessories Displayname now sync with the configuration [#196](https://github.com/iRayanKhan/homebridge-tuya/pull/196)
* Fix for ECONNRESET spam [#197](https://github.com/iRayanKhan/homebridge-tuya/pull/197)
* Support for Kogan garage door accessory [#198](https://github.com/iRayanKhan/homebridge-tuya/pull/198)


## 1.3.0 (2021-01-25)
* Added Adaptive Lighting to TW/RGBTW bulbs. Thanks @tom-23 [186]


## 1.2.0 (2021-01-05)
* Fix UDP errors in log, thanks @Giocirque [#78]
* Merged fix for simpleFanLightAccessory DS-03 support, thanks @sholleman [#168]


## 1.1 (2020-10-28)
* Added Changelog.md
* Added Oil Diffuser accessory, thanks @nitaybz    (#144) 
* Added Dehumidifier accessory, thanks @fra-iesus  (#143)
* Added AirPurifier  accessory, thanks @dhutchison (#139)

