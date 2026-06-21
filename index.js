const TuyaAccessory = require('./lib/TuyaAccessory');
const TuyaDiscovery = require('./lib/TuyaDiscovery');
const TuyaCloudApi = require('./lib/TuyaCloudApi');
const TuyaCloudDevice = require('./lib/TuyaCloudDevice');
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
        // Shared Tuya Cloud clients, keyed by credential set, so several
        // cloud devices on the same project share one token + one realtime
        // (MQTT) connection. Empty unless cloud devices are configured.
        this.cloudApis = new Map();
        this.cloudMessagers = new Map();
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
        const devices = {};
        const connectedDevices = [];
        const fakeDevices = [];
        const cloudDevices = [];
        this.config.devices.forEach(device => {
            try {
                device.id = ('' + device.id).trim();
                // Cloud devices don't need a local key; only trim when present.
                if (device.key != null) device.key = ('' + device.key).trim();
                device.type = ('' + device.type).trim();

                device.ip = ('' + (device.ip || '')).trim();
            } catch(ex) {}

            if (!device.type) return this.log.error('%s (%s) doesn\'t have a type defined.', device.name || 'Unnamed device', device.id);
            if (!CLASS_DEF[device.type.toLowerCase()]) return this.log.error('%s (%s) doesn\'t have a valid type defined.', device.name || 'Unnamed device', device.id);

            if (this._isCloudDevice(device)) cloudDevices.push({name: device.id.slice(8), ...device});
            else if (device.fake) fakeDevices.push({name: device.id.slice(8), ...device});
            else devices[device.id] = {name: device.id.slice(8), ...device};
        });

        // Cloud devices are reached over the internet, not the LAN, so they need
        // no discovery — wire them up right away.
        cloudDevices.forEach(config => this._addCloudAccessory(config));

        const deviceIds = Object.keys(devices);
        if (deviceIds.length === 0) {
            if (cloudDevices.length === 0) this.log.error('No valid configured devices found.');
            return; // cloud-only (or empty) configuration: nothing to discover over LAN
        }

        this.log.info('Starting discovery...');

        TuyaDiscovery.start({ids: deviceIds, log: this.log})
            .on('discover', config => {
                if (!config || !config.id) return;
                if (!devices[config.id]) return this.log.warn('Discovered a device that has not been configured yet (%s@%s).', config.id, config.ip);

                connectedDevices.push(config.id);

                this.log.info('Discovered %s (%s) identified as %s (%s)', devices[config.id].name, config.id, devices[config.id].type, config.version);

                // The version broadcast by the device wins over a configured `version`,
                // but `forceVersion` overrides everything (e.g. to pin a device that
                // reports a newer protocol, like 3.6, to a specific stack).
                const device = new TuyaAccessory({
                    ...devices[config.id], ...config,
                    ...(devices[config.id].forceVersion ? {version: devices[config.id].forceVersion} : {}),
                    log: this.log,
                    UUID: UUID.generate(UUID_SEED + ':' + config.id),
                    connect: false
                });
                this.addAccessory(device);
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

        setTimeout(() => {
            deviceIds.forEach(deviceId => {
                if (connectedDevices.includes(deviceId)) return;

                if (devices[deviceId].ip) {

                    this.log.info('Failed to discover %s (%s) in time but will connect via %s.', devices[deviceId].name, deviceId, devices[deviceId].ip);

                    const device = new TuyaAccessory({
                        ...devices[deviceId],
                        ...(devices[deviceId].forceVersion ? {version: devices[deviceId].forceVersion} : {}),
                        log: this.log,
                        UUID: UUID.generate(UUID_SEED + ':' + deviceId),
                        connect: false
                    });
                    this.addAccessory(device);
                } else {
                    this.log.warn('Failed to discover %s (%s) in time but will keep looking.', devices[deviceId].name, deviceId);
                }
            });
        }, this.config.discoverTimeout ?? DEFAULT_DISCOVER_TIMEOUT);
    }

    /* ------------------------------------------------------------------ *
     *  Tuya Cloud helpers (for devices that can't be reached over the LAN,
     *  e.g. battery-powered "sleepy" irrigation timers). This plugin stays
     *  LAN-first; these paths are only exercised by devices opting in with
     *  `cloud: true` (or a per-device `cloud` credentials object).
     * ------------------------------------------------------------------ */

    _isCloudDevice(device) {
        return !!(device && (device.cloud === true || (typeof device.cloud === 'object' && device.cloud)));
    }

    // Effective cloud credentials/options for a device: the platform-level
    // `cloud` block, overlaid with any per-device `cloud` object.
    _resolveCloudConfig(device) {
        const platform = (this.config.cloud && typeof this.config.cloud === 'object') ? this.config.cloud : {};
        const perDevice = (typeof device.cloud === 'object' && device.cloud) ? device.cloud : {};
        return {...platform, ...perDevice};
    }

    // One TuyaCloudApi per credential set, so multiple cloud devices on the
    // same Tuya project share a single token.
    _getCloudApi(cloudCfg) {
        const key = TuyaCloudApi.keyFor(cloudCfg);
        if (!this.cloudApis.has(key)) {
            this.cloudApis.set(key, new TuyaCloudApi({...cloudCfg, log: this.log}));
        }
        return this.cloudApis.get(key);
    }

    // One shared realtime (MQTT) stream per credential set, unless realtime is
    // disabled. Returns null when realtime is off — the device then shows its
    // initial state and stays controllable, but won't receive live updates.
    _getCloudMessaging(api, cloudCfg) {
        const realtime = cloudCfg.realtime === undefined ? true : coerceBoolean(cloudCfg.realtime, true);
        if (!realtime) return null;
        const key = TuyaCloudApi.keyFor(cloudCfg);
        if (!this.cloudMessagers.has(key)) {
            this.cloudMessagers.set(key, new TuyaCloudMessaging({api, log: this.log}));
        }
        return this.cloudMessagers.get(key);
    }

    _addCloudAccessory(config) {
        const cloudCfg = this._resolveCloudConfig(config);
        if (!cloudCfg.accessId || !cloudCfg.accessKey) {
            return this.log.error('%s (%s) is configured for the Tuya Cloud, but no credentials were found. Add a top-level "cloud" block (accessId, accessKey, region) or a per-device "cloud" object.', config.name, config.id);
        }

        const api = this._getCloudApi(cloudCfg);
        const messaging = this._getCloudMessaging(api, cloudCfg);

        this.log.info('Adding cloud device: %s (%s) via %s', config.name, config.id, api.endpoint);

        this.addAccessory(new TuyaCloudDevice({
            ...config,
            cloud: true, // normalise so accessories can detect cloud mode
            cloudApi: api,
            messaging,
            log: this.log,
            UUID: UUID.generate(UUID_SEED + ':' + config.id),
            connect: false
        }));
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
