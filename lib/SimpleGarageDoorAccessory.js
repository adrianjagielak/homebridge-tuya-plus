const BaseAccessory = require('./BaseAccessory');

// Delay between the stop command and the open/close command.
//
// Sending the opposite direction command while the gate is already moving
// has no effect, so stop needs to be called every time before calling open or close.
//
// Without the delay between the stop and open/close command some controllers
// drop the direction command because it arrives before they have
// finished processing the stop.
const STOP_TO_DIRECTION_DELAY_MS = 500;

// Delay between the direction command and flipping CurrentDoorState. The
// device has no position feedback so this is purely cosmetic — it keeps
// HomeKit's "Opening..."/"Closing..." caption visible for at least this long.
const CURRENT_STATE_DELAY_MS = 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class SimpleGarageDoorAccessory extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.GARAGE_DOOR_OPENER;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.GarageDoorOpener, this.device.context.name);

        super._registerPlatformAccessory();
    }

    _registerCharacteristics() {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.GarageDoorOpener);
        this._checkServiceName(service, this.device.context.name);

        this.dpOpen = this._getCustomDP(this.device.context.dpOpen) || '1';
        this.dpStop = this._getCustomDP(this.device.context.dpStop) || '2';
        this.dpClose = this._getCustomDP(this.device.context.dpClose) || '3';

        // The device only exposes momentary action DPs, so the target state is
        // tracked locally and persisted via the homebridge accessory context.
        if (this.accessory.context.cachedTargetDoorState !== Characteristic.TargetDoorState.OPEN &&
            this.accessory.context.cachedTargetDoorState !== Characteristic.TargetDoorState.CLOSED) {
            this.accessory.context.cachedTargetDoorState = Characteristic.TargetDoorState.OPEN;
        }
        const initialTarget = this.accessory.context.cachedTargetDoorState;
        this.currentDoorState = initialTarget === Characteristic.TargetDoorState.OPEN
            ? Characteristic.CurrentDoorState.OPEN
            : Characteristic.CurrentDoorState.CLOSED;

        // Each setTargetDoorState invocation bumps this token; an older
        // in-flight chain bails out at its next await when the token changes.
        this.opToken = 0;

        this.characteristicTargetDoorState = service.getCharacteristic(Characteristic.TargetDoorState)
            .updateValue(initialTarget)
            .onGet(() => this.accessory.context.cachedTargetDoorState)
            .onSet(value => this.setTargetDoorState(value));

        this.characteristicCurrentDoorState = service.getCharacteristic(Characteristic.CurrentDoorState)
            .updateValue(this.currentDoorState)
            .onGet(() => this.currentDoorState);

        service.getCharacteristic(Characteristic.ObstructionDetected)
            .updateValue(false)
            .onGet(() => false);
    }

    // Wraps the synchronous Tuya write so the caller can await it. The Tuya
    // transport is fire-and-forget at the JS level — the data has been handed
    // to the kernel by the time setMultiStateLegacyAsync returns — but using
    // an awaited call keeps the command sequence in one readable async chain.
    async _sendDps(dps) {
        this.setMultiStateLegacyAsync(dps);
    }

    async setTargetDoorState(value) {
        const {Characteristic} = this.hap;

        this.accessory.context.cachedTargetDoorState = value;

        const opToken = ++this.opToken;

        // Send stop first so reversing direction mid-motion works; if the gate
        // is already idle, the stop is a no-op on the device side.
        await this._sendDps({[this.dpStop]: true});
        if (opToken !== this.opToken) return;

        await sleep(STOP_TO_DIRECTION_DELAY_MS);
        if (opToken !== this.opToken) return;

        if (value === Characteristic.TargetDoorState.OPEN) {
            await this._sendDps({[this.dpOpen]: true});
        } else {
            await this._sendDps({[this.dpClose]: true});
        }
        if (opToken !== this.opToken) return;

        await sleep(CURRENT_STATE_DELAY_MS);
        if (opToken !== this.opToken) return;

        this.currentDoorState = value === Characteristic.TargetDoorState.OPEN
            ? Characteristic.CurrentDoorState.OPEN
            : Characteristic.CurrentDoorState.CLOSED;
        this.characteristicCurrentDoorState.updateValue(this.currentDoorState);
    }
}

module.exports = SimpleGarageDoorAccessory;
