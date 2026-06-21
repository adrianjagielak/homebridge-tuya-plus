const TuyaAccessory = require('./lib/TuyaAccessory');
const TuyaDevice = require('./lib/TuyaDevice');
const TuyaDiscovery = require('./lib/TuyaDiscovery');
const TuyaCloudApi = require('./lib/TuyaCloudApi');
const TuyaCloudMessaging = require('./lib/TuyaCloudMessaging');

const OutletAccessory = require('./lib/OutletAccessory');
const SimpleLightAccessory = require('./lib/SimpleLightAccessory');
const MultiOutletAccessory = require('./lib/MultiOutletAccessory');
const CustomMultiOutletAccessory = require('./lib/CustomMultiOutletAccessory');
const RGBTWLightAccessory = require('./lib/RGBTWLightAccessory');
const RGBTWOutletAccessory = require('./lib/RGBTWOutletAccessory');
const TWLightAccessory = require('./lib/TWLightAccessory');
const AirConditionerAccessory = require('./lib/AirConditionerAccessory');
const AirPurifierAccessory = require('./lib/AirPurifierAccessory');
const DehumidifierAccessory = require('./lib/DehumidifierAccessory');
const ConvectorAccessory = require('./lib/ConvectorAccessory');
const GarageDoorAccessory = require('./lib/GarageDoorAccessory');
const SimpleGarageDoorAccessory = require('./lib/SimpleGarageDoorAccessory');
const WledDimmerAccessory = require('./lib/WledDimmerAccessory');
const SimpleDimmerAccessory = require('./lib/SimpleDimmerAccessory');
const SimpleDimmer2Accessory = require('./lib/SimpleDimmer2Accessory');
const SimpleBlindsAccessory = require('./lib/SimpleBlindsAccessory');
const SimpleHeaterAccessory = require('./lib/SimpleHeaterAccessory');
const SimpleFanAccessory = require('./lib/SimpleFanAccessory');
const SimpleFanLightAccessory = require('./lib/SimpleFanLightAccessory');
const SwitchAccessory = require('./lib/SwitchAccessory');
const ValveAccessory = require('./lib/ValveAccessory');
const IrrigationSystemAccessory = require('./lib/IrrigationSystemAccessory');
const OilDiffuserAccessory = require('./lib/OilDiffuserAccessory');
const DoorbellAccessory = require('./lib/DoorbellAccessory');
const VerticalBlindsWithTilt = require('./lib/VerticalBlindsWithTilt');
const PercentBlindsAccessory = require('./lib/PercentBlindsAccessory');

const PLUGIN_NAME = 'homebridge-tuya-plus';
const PLATFORM_NAME = 'TuyaLan';
// Seed used to derive accessory UUIDs. Must remain 'homebridge-tuya' so that
// devices already paired with HomeKit keep their existing identity (names,
// rooms, automations).
const UUID_SEED = 'homebridge-tuya';
const DEFAULT_DISCOVER_TIMEOUT = 60000;

// Lenient boolean coercion (matches BaseAccessory._coerceBoolean) so config
// values like true / "true" / 1 all read as true.
const coerceBoolean = (b, df = false) =>
    typeof b === 'boolean' ? b :
    typeof b === 'string' ? b.toLowerCase().trim() === 'true' :
    typeof b === 'number' ? b !== 0 : df;

const CLASS_DEF = {
    outlet: OutletAccessory,
    simplelight: SimpleLightAccessory,
    rgbtwlight: RGBTWLightAccessory,
    rgbtwoutlet: RGBTWOutletAccessory,
    twlight: TWLightAccessory,
    multioutlet: MultiOutletAccessory,
    custommultioutlet: CustomMultiOutletAccessory,
    airconditioner: AirConditionerAccessory,
    airpurifier: AirPurifierAccessory,
    dehumidifier: DehumidifierAccessory,
    convector: ConvectorAccessory,
    garagedoor: GarageDoorAccessory,
    simplegaragedoor: SimpleGarageDoorAccessory,
    simpledimmer: SimpleDimmerAccessory,
    wleddimmer: WledDimmerAccessory,
    simpledimmer2: SimpleDimmer2Accessory,
    simpleblinds: SimpleBlindsAccessory,
    simpleheater: SimpleHeaterAccessory,
    switch: SwitchAccessory,
    fan: SimpleFanAccessory,
    fanlight: SimpleFanLightAccessory,
    watervalve: ValveAccessory,
    irrigationsystem: IrrigationSystemAccessory,
    oildiffuser: OilDiffuserAccessory,
    doorbell: DoorbellAccessory,
    verticalblindswithtilt: VerticalBlindsWithTilt,
    percentblinds: PercentBlindsAccessory
};

let Characteristic, Formats, Perms, Categories, PlatformAccessory, Service, AdaptiveLightingController, UUID;

module.exports = function(homebridge) {
    ({
        platformAccessory: PlatformAccessory,
        hap: {Characteristic, Formats, Perms, Categories, Service, AdaptiveLightingController, uuid: UUID}
    } = homebridge);

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, TuyaLan, true);
};

class TuyaLan {
    constructor(...props) {
        [this.log, this.config, this.api] = [...props];

        this.cachedAccessories = new Map();
        // One TuyaDevice per configured device, keyed by Tuya id, so discovery can
        // hand each its LAN target once it's found on the network.
        this.tuyaDevices = new Map();
        // A SINGLE shared Tuya Cloud session (OpenAPI token + realtime MQTT) for the
        // whole platform — the global fallback every device can lean on. Stays null
        // unless cloud credentials are configured.
        this.cloudApi = null;
        this.cloudMessaging = null;
        this.api.hap.EnergyCharacteristics = require('./lib/EnergyCharacteristics')(this.api.hap);

        if(!this.config || !this.config.devices) {
            this.log("No devices found. Check that you have specified them in your config.json file.");
            return false;
        }

        this._expectedUUIDs = this.config.devices.map(device => UUID.generate(UUID_SEED +(device.fake ? ':fake:' : ':') + device.id));

        this.api.on('didFinishLaunching', () => {
            this.discoverDevices();
        });
    }

    discoverDevices() {
        // Bring up the single shared cloud session first, so every device that opts
        // into (or falls back to) the cloud shares one token and one MQTT stream.
        this._setupCloudSession();

        const lanDeviceIds = [];      // ids we still want to find on the LAN
        const connectedDevices = [];  // ids discovered on the LAN
        const fakeDevices = [];

        this.config.devices.forEach(device => {
            try {
                device.id = ('' + device.id).trim();
                // Cloud-only devices don't need a local key; only trim when present.
                if (device.key != null) device.key = ('' + device.key).trim();
                device.type = ('' + device.type).trim();

                device.ip = ('' + (device.ip || '')).trim();
            } catch(ex) {}

            if (!device.type) return this.log.error('%s (%s) doesn\'t have a type defined.', device.name || 'Unnamed device', device.id);
            if (!CLASS_DEF[device.type.toLowerCase()]) return this.log.error('%s (%s) doesn\'t have a valid type defined.', device.name || 'Unnamed device', device.id);

            if (device.fake) {
                fakeDevices.push({name: device.id.slice(8), ...device});
                return;
            }

            const tuyaDevice = this._createDevice({name: device.id.slice(8), ...device});
            this.tuyaDevices.set(device.id, tuyaDevice);
            this.addAccessory(tuyaDevice);

            // A device that can be reached locally (has a local key and isn't a
            // cloud-only/"sleepy" unit) still wants LAN discovery; the cloud, if
            // configured, is its fallback.
            if (device.key && !tuyaDevice.cloudPrimary) lanDeviceIds.push(device.id);
        });

        fakeDevices.forEach(config => {
            this.log.info('Adding fake device: %s', config.name);
            this.addAccessory(new TuyaAccessory({
                ...config,
                log: this.log,
                UUID: UUID.generate(UUID_SEED + ':fake:' + config.id),
                connect: false
            }));
        });

        if (lanDeviceIds.length === 0) {
            if (this.tuyaDevices.size === 0 && fakeDevices.length === 0) this.log.error('No valid configured devices found.');
            return; // cloud-only (or empty) configuration: nothing to discover over the LAN
        }

        this.log.info('Starting discovery...');

        TuyaDiscovery.start({ids: lanDeviceIds, log: this.log})
            .on('discover', config => {
                if (!config || !config.id) return;
                const tuyaDevice = this.tuyaDevices.get(config.id);
                if (!tuyaDevice) return this.log.warn('Discovered a device that has not been configured yet (%s@%s).', config.id, config.ip);
                if (connectedDevices.includes(config.id)) return;

                connectedDevices.push(config.id);

                this.log.info('Discovered %s (%s) identified as %s (%s)', tuyaDevice.context.name, config.id, tuyaDevice.context.type, config.version);

                // The version broadcast by the device wins over a configured `version`,
                // but `forceVersion` overrides everything; attachLan applies that order.
                tuyaDevice.attachLan({ip: config.ip, version: config.version});
            });

        setTimeout(() => {
            lanDeviceIds.forEach(deviceId => {
                if (connectedDevices.includes(deviceId)) return;

                const tuyaDevice = this.tuyaDevices.get(deviceId);
                if (!tuyaDevice) return;

                if (tuyaDevice.context.ip) {
                    this.log.info('Failed to discover %s (%s) in time but will connect via %s.', tuyaDevice.context.name, deviceId, tuyaDevice.context.ip);
                    tuyaDevice.attachLan({ip: tuyaDevice.context.ip});
                } else if (tuyaDevice.cloud) {
                    this.log.info('Failed to discover %s (%s) on the LAN; it will run over the Tuya Cloud fallback.', tuyaDevice.context.name, deviceId);
                } else {
                    this.log.warn('Failed to discover %s (%s) in time but will keep looking.', tuyaDevice.context.name, deviceId);
                }
            });
        }, this.config.discoverTimeout ?? DEFAULT_DISCOVER_TIMEOUT);
    }

    /* ------------------------------------------------------------------ *
     *  Tuya Cloud — a single, global fallback session.
     *
     *  This plugin stays LAN-first: every device is controlled locally when it
     *  can be. When a top-level `cloud` block is configured, the plugin keeps one
     *  shared Tuya Cloud session alive in the background, and every device gains a
     *  transparent cloud fallback for the moments the LAN can't be reached (a
     *  flaky connection, or a battery-powered "sleepy" device that never appears
     *  on the LAN at all). It's all opt-in — without `cloud`, nothing here runs.
     * ------------------------------------------------------------------ */

    // The credentials for the single global session: the platform-level `cloud`
    // block. For backward compatibility we also accept credentials left on a
    // device's own `cloud` object (older, per-device style) and adopt the first
    // set found, since the plugin now runs just one session.
    _resolveGlobalCloudConfig() {
        if (this.config.cloud && typeof this.config.cloud === 'object') return this.config.cloud;

        for (const device of this.config.devices) {
            if (device && typeof device.cloud === 'object' && device.cloud && device.cloud.accessId && device.cloud.accessKey) {
                this.log.warn('Per-device "cloud" credentials are deprecated; adopting %s\'s as the single global Tuya Cloud session. Move them to a top-level "cloud" block.', device.name || device.id);
                return device.cloud;
            }
        }
        return null;
    }

    _setupCloudSession() {
        const cloudCfg = this._resolveGlobalCloudConfig();
        if (!cloudCfg || !cloudCfg.accessId || !cloudCfg.accessKey) {
            if (this.config.devices.some(d => d && d.cloud)) {
                this.log.error('A device is configured for the Tuya Cloud, but no usable credentials were found. Add a top-level "cloud" block (accessId, accessKey, region). See the wiki: Tuya Cloud Setup.');
            }
            return;
        }

        this.cloudApi = new TuyaCloudApi({...cloudCfg, log: this.log});

        const realtime = cloudCfg.realtime === undefined ? true : coerceBoolean(cloudCfg.realtime, true);
        this.cloudMessaging = realtime ? new TuyaCloudMessaging({api: this.cloudApi, log: this.log}) : null;

        this.log.info('Tuya Cloud fallback enabled via %s%s.', this.cloudApi.endpoint, this.cloudMessaging ? ' (with realtime updates)' : ' (realtime updates disabled)');
    }

    // Whether a device participates in the cloud session at all. With a session
    // configured, every device does — that is the global fallback — unless it
    // opts out (`cloud: false`) or the fallback is globally disabled
    // (`cloud.fallback: false`, which keeps cloud for the explicitly-cloud devices
    // only, matching the older opt-in-per-device behavior).
    _deviceUsesCloud(device) {
        if (!this.cloudApi) return false;
        if (device.cloud === false) return false;
        if (this._isCloudPrimary(device)) return true;
        return !(this.config.cloud && this.config.cloud.fallback === false);
    }

    // Cloud-primary devices are reached over the cloud first and don't wait for (or
    // warn about) the LAN — the battery-powered "sleepy" timers, and any device the
    // user explicitly pins with `cloud: true` (or the legacy per-device creds).
    _isCloudPrimary(device) {
        return device.cloud === true || (typeof device.cloud === 'object' && !!device.cloud);
    }

    _createDevice(device) {
        const usesCloud = this._deviceUsesCloud(device);
        const cloudPrimary = this._isCloudPrimary(device);
        return new TuyaDevice({
            ...device,
            // Normalise `cloud` to a plain boolean on the device's context so
            // accessories' own cloud checks (e.g. IrrigationSystem._isCloud) keep
            // working whether the user wrote `cloud: true` or a credentials object.
            cloud: cloudPrimary ? true : device.cloud,
            cloudPrimary,
            cloudApi: usesCloud ? this.cloudApi : undefined,
            messaging: usesCloud ? this.cloudMessaging : undefined,
            cloudStartDelay: usesCloud ? this._nextCloudStartDelay() : 0,
            log: this.log,
            UUID: UUID.generate(UUID_SEED + ':' + device.id),
            connect: false
        });
    }

    // Spread the cloud devices' first reads over a few seconds so a large install
    // doesn't fire dozens of OpenAPI calls at once and trip Tuya's per-second rate
    // limit at startup.
    _nextCloudStartDelay() {
        this._cloudStartCount = (this._cloudStartCount || 0) + 1;
        return Math.min(15000, (this._cloudStartCount - 1) * 300);
    }

    registerPlatformAccessories(platformAccessories) {
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, Array.isArray(platformAccessories) ? platformAccessories : [platformAccessories]);
    }

    configureAccessory(accessory) {
        // also checks null objects or empty config - this._expectedUUIDs
        if (accessory instanceof PlatformAccessory && this._expectedUUIDs && this._expectedUUIDs.includes(accessory.UUID)) {
            this.cachedAccessories.set(accessory.UUID, accessory);
            accessory.services.forEach(service => {
                if (service.UUID === Service.AccessoryInformation.UUID) return;
                service.characteristics.some(characteristic => {
                    if (!characteristic.props ||
                        !Array.isArray(characteristic.props.perms) ||
                        characteristic.props.perms.length !== 3 ||
                        !(characteristic.props.perms.includes(Perms.WRITE) && characteristic.props.perms.includes(Perms.NOTIFY))
                    ) return;

                    this.log.info('Marked %s unreachable by faulting Service.%s.%s', accessory.displayName, service.displayName, characteristic.displayName);

                    characteristic.updateValue(new Error('Unreachable'));
                    return true;
                });
            });
        } else {
            /*
             * Irrespective of this unregistering, Homebridge continues
             * to "_prepareAssociatedHAPAccessory" and "addBridgedAccessory".
             * This timeout will hopefully remove the accessory after that has happened.
             */
            setTimeout(() => {
                this.removeAccessory(accessory);
            }, 1000);
        }
    }

    addAccessory(device) {
        const deviceConfig = device.context;
        const type = (deviceConfig.type || '').toLowerCase();

        const Accessory = CLASS_DEF[type];

        let accessory = this.cachedAccessories.get(deviceConfig.UUID),
            isCached = true;

        const expectedCategory = Accessory.getCategory(Categories);

        // Only treat a cached accessory as a "different type" when we actually
        // have a category to compare against. If getCategory() resolves to
        // undefined (e.g. an unknown HAP category constant), HomeKit stores the
        // accessory as Categories.OTHER, so an undefined expectation would never
        // match and we would needlessly unregister & recreate the accessory on
        // every restart — wiping its HomeKit identity (name, room, automations).
        if (accessory && expectedCategory !== undefined && accessory.category !== expectedCategory) {
            this.log.info("%s has a different type (%s vs %s)", accessory.displayName, accessory.category, expectedCategory);
            this.removeAccessory(accessory);
            accessory = null;
        }

        if (!accessory) {
            accessory = new PlatformAccessory(deviceConfig.name, deviceConfig.UUID, expectedCategory);
            accessory.getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, deviceConfig.manufacturer || "Unknown")
                .setCharacteristic(Characteristic.Model, deviceConfig.model || "Unknown")
                .setCharacteristic(Characteristic.SerialNumber, deviceConfig.id.slice(8));

            isCached = false;
        }

        if (accessory && accessory.displayName !== deviceConfig.name) {
            this.log.info(
                "Configuration name %s differs from cached displayName %s. Updating cached displayName to %s ",
                deviceConfig.name, accessory.displayName, deviceConfig.name);
            accessory.displayName = deviceConfig.name;
        }

        this.cachedAccessories.set(deviceConfig.UUID, new Accessory(this, accessory, device, !isCached));
    }

    removeAccessory(homebridgeAccessory) {
        if (!homebridgeAccessory) return;

        this.log.warn('Unregistering', homebridgeAccessory.displayName);

        delete this.cachedAccessories[homebridgeAccessory.UUID];
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [homebridgeAccessory]);
    }

    removeAccessoryByUUID(uuid) {
        if (uuid) this.removeAccessory(this.cachedAccessories.get(uuid));
    }
}
