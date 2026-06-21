const BaseAccessory = require('./BaseAccessory');
const http = require('http');
const maxWledBrightness = 255;

// Debounce and warmup settings for WLED calls
const wledDebounceMs = 50;
const wledWarmupMs = 8000;

class WledDimmerAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.LIGHTBULB;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.Lightbulb, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.Lightbulb);
        this._checkServiceName(service, this.device.context.name);

        this.dpPower = this._getCustomDP(this.device.context.dpPower) || '1';
        this.dpBrightness = this._getCustomDP(this.device.context.dpBrightness) || this._getCustomDP(this.device.context.dp) || '2';

        // State for debounced / delayed WLED updates
        this._wledPendingBri = null;
        this._wledDebounceTimer = null;
        this._wledReadyAt = 0;

        // State for WLED preset effect switches
        this._wledEffectSwitches = [];
        this._wledCurrentEffectIndex = null;

        // Allow a couple of different spellings just in case
        const syncCfg =
            this.device.context.syncBrightnessToWled ||
            this.device.context.syncBrightnessToWLED ||
            null;
        this.syncBrightnessToWled = (syncCfg && ('' + syncCfg).trim()) || null;

        this.log.debug(
            '[WLED Sync] %s: syncBrightnessToWled=%s',
            this.device.context.name,
            this.syncBrightnessToWled || 'disabled'
        );

        const characteristicOn = service.getCharacteristic(Characteristic.On)
            .updateValue(dps[this.dpPower])
            .onGet(() => this.getStateAsync(this.dpPower))
            .onSet(value => this.setStateAsync(this.dpPower, value));

        const characteristicBrightness = service.getCharacteristic(Characteristic.Brightness);
        // Keep a reference so we can update brightness from background WLED calls
        this._characteristicBrightness = characteristicBrightness;

        if (this.syncBrightnessToWled) {
            // Start with 100% locally while we fetch the actual WLED brightness
            characteristicBrightness
                .updateValue(100)
                .onGet(() => this.getBrightness())
                .onSet(value => this.setBrightness(value));

            // Force Tuya dimmer brightness to 100% on startup
            const maxTuyaBrightness = this.convertBrightnessFromHomeKitToTuya(100);
            if (dps[this.dpBrightness] !== maxTuyaBrightness) {
                this.log.debug(
                    '[WLED Sync] %s: setting Tuya brightness DP%s to max (%s)',
                    this.device.context.name,
                    this.dpBrightness,
                    maxTuyaBrightness
                );
                this.setState(this.dpBrightness, maxTuyaBrightness, () => {});
            }
        } else {
            const initial = this.convertBrightnessFromTuyaToHomeKit(dps[this.dpBrightness]);
            this.log.debug(
                '%s: initial Tuya brightness DP%s=%s -> HomeKit %s%%',
                this.device.context.name,
                this.dpBrightness,
                dps[this.dpBrightness],
                initial
            );
            characteristicBrightness
                .updateValue(initial)
                .onGet(() => this.getBrightness())
                .onSet(value => this.setBrightness(value));
        }

        // Optional: create one HomeKit Switch per configured WLED preset effect.
        // Each switch, when turned ON, will push the corresponding effect ID to WLED.
        const presetEffects = this.device.context.presetEffects;
        if (Array.isArray(presetEffects) && presetEffects.length) {
            const {Service: HapService, Characteristic: HapCharacteristic} = this.hap;

            const validEffectServices = [];
            this._wledEffectSwitches = [];

            presetEffects.forEach((effectCfg, index) => {
                if (!effectCfg) return;

                const effectId = effectCfg.fx != null ? effectCfg.fx : effectCfg.id;
                if (!isFinite(effectId)) {
                    this.log.warn(
                        '[WLED Sync] %s: presetEffects[%s] is missing a numeric id/fx, skipping: %s',
                        this.device.context.name,
                        index,
                        JSON.stringify(effectCfg)
                    );
                    return;
                }

                const effectName = (effectCfg.name && String(effectCfg.name).trim()) || `Effect ${index + 1}`;
                const staticColor = effectCfg.staticColor && String(effectCfg.staticColor).trim();
                const displayName = effectName;
                const subtype = `wledEffect ${index + 1}`;

                let effectService = this.accessory.getServiceById(HapService.Switch, subtype);
                if (effectService) {
                    this._checkServiceName(effectService, displayName);
                } else {
                    effectService = this.accessory.addService(HapService.Switch, displayName, subtype);
                }

                validEffectServices.push(effectService);

                const onCharacteristic = effectService
                    .getCharacteristic(HapCharacteristic.On)
                    .on('set', (value, callback) => {
                        // Only react to turning the switch ON; turning OFF just clears the toggle in HomeKit.
                        if (!value) {
                            return callback();
                        }

                        // If the light is off, ignore effect change and turn this switch back off.
                        if (!this.device.state[this.dpPower]) {
                            setImmediate(() => {
                                effectService.getCharacteristic(HapCharacteristic.On).updateValue(false);
                            });
                            return callback();
                        }

                        this.log.debug(
                            '[WLED Sync] %s: setting preset effect "%s" (id=%s, index=%s)',
                            this.device.context.name,
                            effectName,
                            effectId,
                            index + 1
                        );

                        const rgb = this._parseStaticColor(staticColor);

                        if (!this.device.state[this.dpPower]) {
                            this.log.error(
                                '[WLED Sync] %s: lamp is off',
                                this.device.context.name
                            );
                            setImmediate(() => {
                                effectService.getCharacteristic(HapCharacteristic.On).updateValue(false);
                            });
                            return callback();
                        }

                        this._setWledEffect(effectId, rgb, err => {
                            if (err) {
                                this.log.error(
                                    '[WLED Sync] %s: failed to set preset effect "%s" (id=%s): %s',
                                    this.device.context.name,
                                    effectName,
                                    effectId,
                                    err
                                );
                                setImmediate(() => {
                                    effectService.getCharacteristic(HapCharacteristic.On).updateValue(false);
                                });
                                return callback();
                            }

                            // Remember active effect locally and turn off other switches for a radio-button-style UX.
                            this._wledCurrentEffectIndex = (index + 1);
                            this._wledEffectSwitches.forEach(sw => {
                                if (sw.effectName !== effectName && sw.characteristic.value) {
                                    sw.characteristic.updateValue(false);
                                }
                            });

                            callback();
                        });
                    })
                    .on('get', cb => {
                        if (!this.device.connected) return cb(this._commError());
                        cb(null, this.device.state[this.dpPower] && this._wledCurrentEffectIndex === (index + 1));
                    });

                this._wledEffectSwitches.push({
                    effectId,
                    name: effectName,
                    characteristic: onCharacteristic
                });
            });

            // Clean up any stale WLED preset effect services that are no longer in config.
            this.accessory.services
                .filter(service => service.UUID === HapService.Switch.UUID && service.subtype && service.subtype.startsWith('wledEffect '))
                .forEach(service => {
                    if (!validEffectServices.includes(service)) {
                        this.log.debug('Removing', service.displayName);
                        this.accessory.removeService(service);
                    }
                });
        }

        this.device.on('change', changes => {
            // Log full DPS changes so we can see exactly what Tuya reported
            this.log.debug(
                '%s DPS changes: %s %s was:',
                this.device.context.name,
                JSON.stringify(changes),
                'dpPower=' + this.dpPower,
                this.device.state[this.dpPower]
            );

            if (changes.hasOwnProperty(this.dpPower)) {
                const oldPower = !!characteristicOn.value;
                const newPower = !!changes[this.dpPower];

                this.log.debug(
                    '%s power change detected on DP%s: %s -> %s',
                    this.device.context.name,
                    this.dpPower,
                    oldPower,
                    newPower
                );

                if (oldPower !== newPower) {
                    characteristicOn.updateValue(newPower);
                }

                // Track warmup window for WLED after power ON
                if (this.syncBrightnessToWled && newPower) {
                    this._wledReadyAt = Date.now() + wledWarmupMs;
                    this.log.debug(
                        '[WLED Sync] %s: power ON -> delaying WLED API calls for %sms',
                        this.device.context.name,
                        wledWarmupMs
                    );
                }

                // Cancel any pending brightness updates when turning OFF
                if (this.syncBrightnessToWled && !newPower) {
                    if (this._wledDebounceTimer) {
                        clearTimeout(this._wledDebounceTimer);
                        this._wledDebounceTimer = null;
                    }
                    this._wledPendingBri = null;
                }
            }

            // When WLED sync is enabled, also mirror manual Tuya (Smart Life) brightness changes to WLED
            if (this.syncBrightnessToWled && changes.hasOwnProperty(this.dpBrightness)) {
                const tuyaValue = changes[this.dpBrightness];
                const maxTuyaBrightness = this.convertBrightnessFromHomeKitToTuya(100);

                // Ignore the "forced back to 100%" update to avoid feedback loops
                if (tuyaValue === maxTuyaBrightness) {
                    this.log.debug(
                        '[WLED Sync] %s: Tuya DP%s reported max brightness (%s), ignoring',
                        this.device.context.name,
                        this.dpBrightness,
                        tuyaValue
                    );
                    return;
                }

                const percent = this.convertBrightnessFromTuyaToHomeKit(tuyaValue);
                const bri = Math.max(0, Math.min(maxWledBrightness, Math.round((percent / 100) * maxWledBrightness)));

                this.log.debug(
                    '[WLED Sync] %s: Tuya DP%s changed to %s -> %s%% -> WLED bri=%s (debounced)',
                    this.device.context.name,
                    this.dpBrightness,
                    tuyaValue,
                    percent,
                    bri
                );

                // Queue a debounced WLED update to match the Tuya app change
                this._scheduleWledBrightness(bri, 'Tuya brightness change', err => {
                    if (err) {
                        this.log.error(
                            '[WLED Sync] %s: failed to push Tuya-origin brightness to WLED (err=%s)',
                            this.device.context.name,
                            err
                        );
                        return;
                    }

                    // Reflect that brightness back into HomeKit
                    characteristicBrightness.updateValue(percent);

                    // After a short delay, force Tuya brightness back to 100% so it stops dimming the strip
                    if (this._wledForceMaxTimeout) {
                        clearTimeout(this._wledForceMaxTimeout);
                    }
                    this._wledForceMaxTimeout = setTimeout(() => {
                        this.log.debug(
                            '[WLED Sync] %s: forcing Tuya DP%s back to max (%s) after Tuya app change',
                            this.device.context.name,
                            this.dpBrightness,
                            maxTuyaBrightness
                        );
                        this.setState(this.dpBrightness, maxTuyaBrightness, () => {});
                    }, 5000);
                });
            } else if (!this.syncBrightnessToWled && changes.hasOwnProperty(this.dpBrightness) && this.convertBrightnessFromHomeKitToTuya(characteristicBrightness.value) !== changes[this.dpBrightness]) {
                characteristicBrightness.updateValue(this.convertBrightnessFromTuyaToHomeKit(changes[this.dpBrightness]));
            }
        });
    }

    getBrightness() {
        if (!this.device.connected) throw this._commError();
        if (this.syncBrightnessToWled) {
            // If we already have a cached WLED brightness, return it immediately.
            if (this._lastWledPercent != null) {
                this.log.debug(
                    '[WLED Sync] %s: getBrightness() -> using cached %s%%',
                    this.device.context.name,
                    this._lastWledPercent
                );
                return this._lastWledPercent;
            }
            return 50;
        } else {
            return this.convertBrightnessFromTuyaToHomeKit(this.device.state[this.dpBrightness]);
        }
    }

    setBrightness(value) {
        if (this.syncBrightnessToWled) {
            this.log.debug(
                '[WLED Sync] %s: setBrightness(%s%%)',
                this.device.context.name,
                value
            );

            // Remember the target level immediately so HomeKit/UI stays in sync.
            this._lastWledPercent = value;

            // Ensure Tuya stays at 100% so it doesn't interfere with WLED.
            const maxTuyaBrightness = this.convertBrightnessFromHomeKitToTuya(100);
            if (this.device.state[this.dpBrightness] !== maxTuyaBrightness) {
                this.log.debug(
                    '[WLED Sync] %s: ensuring Tuya DP%s=%s (max)',
                    this.device.context.name,
                    this.dpBrightness,
                    maxTuyaBrightness
                );
                // Fire-and-forget; don't tie HomeKit callback to Tuya I/O.
                this.setStateInBackground(this.dpBrightness, maxTuyaBrightness);
            }

            // Compute desired WLED brightness once.
            const bri = Math.max(0, Math.min(maxWledBrightness, Math.round((value / 100) * maxWledBrightness)));
            this.log.debug(
                '[WLED Sync] %s: mapped HomeKit %s%% -> WLED bri=%s (debounced background)',
                this.device.context.name,
                value,
                bri
            );

            // Schedule the WLED update in the background with debounce and warmup handling.
            this._scheduleWledBrightness(bri, 'HomeKit setBrightness');

            // Return to HomeKit immediately; don't wait for network I/O.
            return null;
        } else {
            return this.setStateAsync(this.dpBrightness, this.convertBrightnessFromHomeKitToTuya(value));
        }
    }

    _getWledTarget() {
        if (!this.syncBrightnessToWled) return null;
        const parts = String(this.syncBrightnessToWled).split(':');
        const host = parts[0];
        const port = parts[1] ? parseInt(parts[1], 10) || 80 : 80;
        this.log.debug(
            '[WLED Sync] %s: target host=%s port=%s',
            this.device.context.name,
            host,
            port
        );
        return {host, port};
    }

    _getWledBrightness(callback) {
        const target = this._getWledTarget();
        if (!target) {
            this.log.error(
                '[WLED Sync] %s: _getWledBrightness but no target configured',
                this.device.context.name
            );
            return callback(true);
        }

        // Ensure we never call the provided callback more than once
        const done = (err, bri) => {
            if (done.called) return;
            done.called = true;
            callback(err, bri);
        };

        const options = {
            host: target.host,
            port: target.port,
            path: '/json/state',
            method: 'GET',
            timeout: 1000
        };

        this.log.debug(
            '[WLED Sync] %s: GET http://%s:%s/json/state',
            this.device.context.name,
            target.host,
            target.port
        );

        const req = http.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data || '{}');
                    // WLED exposes brightness as "bri" in the root of the state response
                    const bri = json.bri != null ? json.bri : (json.state && json.state.bri);
                    if (!isFinite(bri)) {
                        this.log.error(
                            '[WLED Sync] %s: /json/state response has no numeric bri: %s',
                            this.device.context.name,
                            data
                        );
                        return done(true);
                    }
                    this.log.debug(
                        '[WLED Sync] %s: /json/state -> bri=%s',
                        this.device.context.name,
                        bri
                    );
                    done(null, bri);
                } catch (e) {
                    this.log.error('Failed to parse WLED state from %s: %s', this.syncBrightnessToWled, e.message);
                    done(true);
                }
            });
        });

        req.on('error', err => {
            this.log.error('Error talking to WLED at %s: %s', this.syncBrightnessToWled, err.message);
            done(true);
        });

        req.on('timeout', () => {
            req.destroy();
            done(true);
        });

        req.end();
    }

    _setWledBrightness(brightness, callback) {
        const target = this._getWledTarget();
        if (!target) {
            this.log.error(
                '[WLED Sync] %s: _setWledBrightness but no target configured',
                this.device.context.name
            );
            if (callback) callback(true);
            return;
        }

        // Ensure we never call the provided callback more than once
        const done = (err) => {
            if (!callback) return;
            if (done.called) return;
            done.called = true;
            callback(err);
        };

        const body = JSON.stringify({bri: brightness});

        const options = {
            host: target.host,
            port: target.port,
            path: '/json/state',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 1000
        };

        this.log.debug(
            '[WLED Sync] %s: POST http://%s:%s/json/state body=%s',
            this.device.context.name,
            target.host,
            target.port,
            body
        );

        const req = http.request(options, res => {
            // Consume response and ignore body
            res.on('data', () => {});
            res.on('end', () => {
                this.log.debug(
                    '[WLED Sync] %s: WLED brightness set, HTTP %s',
                    this.device.context.name,
                    res.statusCode
                );
                done && done();
            });
        });

        req.on('error', err => {
            this.log.error('Error setting WLED brightness on %s: %s', this.syncBrightnessToWled, err.message);
            done && done(true);
        });

        req.on('timeout', () => {
            req.destroy();
            done && done(true);
        });

        req.write(body);
        req.end();
    }

    _setWledEffect(effectId, rgbColor, callback) {
        const target = this._getWledTarget();
        if (!target) {
            this.log.error(
                '[WLED Sync] %s: _setWledEffect but no target configured',
                this.device.context.name
            );
            if (callback) callback(true);
            return;
        }

        // Ensure we never call the provided callback more than once
        const done = (err) => {
            if (!callback) return;
            if (done.called) return;
            done.called = true;
            callback(err);
        };

        // Build WLED JSON: always set effect (fx), and if a valid staticColor
        // is provided, also override the first segment color.
        const seg = {fx: effectId};
        if (Array.isArray(rgbColor) && rgbColor.length === 3 && rgbColor.every(c => Number.isInteger(c))) {
            seg.col = [rgbColor];
        }

        const body = JSON.stringify({seg: [seg]});

        const options = {
            host: target.host,
            port: target.port,
            path: '/json/state',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 1000
        };

        this.log.debug(
            '[WLED Sync] %s: POST http://%s:%s/json/state body=%s (preset effect)',
            this.device.context.name,
            target.host,
            target.port,
            body
        );

        const req = http.request(options, res => {
            // Consume response and ignore body
            res.on('data', () => {});
            res.on('end', () => {
                this.log.debug(
                    '[WLED Sync] %s: WLED effect set to %s, HTTP %s',
                    this.device.context.name,
                    effectId,
                    res.statusCode
                );
                done && done();
            });
        });

        req.on('error', err => {
            this.log.error('Error setting WLED effect on %s: %s', this.syncBrightnessToWled, err.message);
            done && done(true);
        });

        req.on('timeout', () => {
            req.destroy();
            done && done(true);
        });

        req.write(body);
        req.end();
    }

    _parseStaticColor(color) {
        if (!color) return null;

        let hex = String(color).trim().toLowerCase();
        if (hex[0] === '#') hex = hex.slice(1);

        if (hex.length !== 6 || !/^[0-9a-f]{6}$/.test(hex)) {
            this.log.warn(
                '[WLED Sync] %s: staticColor "%s" is not a valid 6-digit hex string, ignoring',
                this.device.context.name,
                color
            );
            return null;
        }

        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);

        return [r, g, b];
    }

    _scheduleWledBrightness(brightness, reason, callback) {
        if (!this.syncBrightnessToWled) {
            callback && callback(true);
            return;
        }

        // Remember the last requested brightness; multiple calls within the debounce window collapse into one.
        this._wledPendingBri = brightness;

        if (this._wledDebounceTimer) {
            clearTimeout(this._wledDebounceTimer);
            this._wledDebounceTimer = null;
        }

        const now = Date.now();
        const warmupDelay = this._wledReadyAt && now < this._wledReadyAt ? (this._wledReadyAt - now) : 0;
        const delay = warmupDelay + wledDebounceMs;

        this.log.debug(
            '[WLED Sync] %s: scheduling WLED bri=%s in %sms (%s)',
            this.device.context.name,
            brightness,
            delay,
            reason || 'unspecified'
        );

        this._wledDebounceTimer = setTimeout(() => {
            this._wledDebounceTimer = null;

            // If the light is now off, skip the call.
            if (!this.device.state[this.dpPower]) {
                this.log.debug(
                    '[WLED Sync] %s: skipping scheduled WLED bri=%s because power is OFF',
                    this.device.context.name,
                    this._wledPendingBri
                );
                this._wledPendingBri = null;
                callback && callback(true);
                return;
            }

            const briToSend = this._wledPendingBri;
            this._wledPendingBri = null;

            setImmediate(() => {
                this._setWledBrightness(briToSend, err => {
                    if (err) {
                        this.log.error(
                            '[WLED Sync] %s: scheduled WLED bri=%s failed: %s',
                            this.device.context.name,
                            briToSend,
                            err
                        );
                    }
                    callback && callback(err);
                });
            });
        }, delay);
    }
}

module.exports = WledDimmerAccessory;