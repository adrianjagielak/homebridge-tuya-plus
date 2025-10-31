const BaseAccessory = require('./BaseAccessory');

class VerticalBlindsWithTilt extends BaseAccessory {
    static getCategory(Categories) {
        return Categories.WINDOW_COVERING;
    }

    constructor(...props) {
        super(...props);
        this.lastCloseTime = 0;
        this.lastOpenTime = 0;
        this.lastTiltCommand = null;
        this.tiltBufferTimeout = null;
        this.tiltDelayTimeout = null;
        this.positionStateTimeout = null; // For tracking when movement completes
        this.isMoving = false; // Track if blinds are currently moving
    }

    _registerPlatformAccessory() {
        const {Service} = this.hap;

        this.accessory.addService(Service.WindowCovering, this.device.context.name);
    }

    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.WindowCovering);
        this._checkServiceName(service, this.device.context.name);

        // dp_id 1: control (open/close/stop) - for vertical position
        // dp_id 2: percent_control - for rotation/tilt control
        // dp_id 3: percent_state - read-only tilt status
        this.dpAction = this._getCustomDP(this.device.context.dpAction) || '1';
        this.dpTilt = this._getCustomDP(this.device.context.dpTilt) || '2';
        this.dpTiltState = this._getCustomDP(this.device.context.dpTiltState) || '3';
        
        // Time in seconds for blinds to fully close/extend (default: 30 seconds)
        this.timeToClose = this.device.context.timeToClose || 30;
        
        // Initialize position based on device state
        this.currentPosition = this._getInitialPosition(dps);
        
        const characteristicCurrentPosition = service.getCharacteristic(Characteristic.CurrentPosition)
            .updateValue(this.currentPosition)
            .on('get', this.getPosition.bind(this));

        const characteristicTargetPosition = service.getCharacteristic(Characteristic.TargetPosition)
            .updateValue(this.currentPosition)
            .on('get', this.getPosition.bind(this))
            .on('set', this.setPosition.bind(this));

        const characteristicPositionState = service.getCharacteristic(Characteristic.PositionState)
            .updateValue(Characteristic.PositionState.STOPPED)
            .on('get', this.getPositionState.bind(this));

        // Add tilt angle support - use percent_state for reading, percent_control for writing
        const characteristicCurrentHorizontalTilt = service.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle)
            .updateValue(this._getTiltAngle(dps[this.dpTiltState] || dps[this.dpTilt]))
            .on('get', this.getTiltAngle.bind(this));

        const characteristicTargetHorizontalTilt = service.getCharacteristic(Characteristic.TargetHorizontalTiltAngle)
            .updateValue(this._getTiltAngle(dps[this.dpTiltState] || dps[this.dpTilt]))
            .on('get', this.getTiltAngle.bind(this))
            .on('set', this.setTiltAngle.bind(this));

        this.characteristicCurrentPosition = characteristicCurrentPosition;
        this.characteristicTargetPosition = characteristicTargetPosition;
        this.characteristicPositionState = characteristicPositionState;
        this.characteristicCurrentHorizontalTilt = characteristicCurrentHorizontalTilt;
        this.characteristicTargetHorizontalTilt = characteristicTargetHorizontalTilt;
    }

    // Position methods
    _getInitialPosition(dps) {
        // Try to restore last known position from persistent cache
        // This survives Homebridge restarts
        if (this.accessory.context.cachedPosition !== undefined) {
            this.log('[TuyaAccessory] Restored position from cache:', this.accessory.context.cachedPosition + '%');
            return this.accessory.context.cachedPosition;
        }
        
        // First time setup - default to open
        this.log('[TuyaAccessory] Initial position unknown (first time setup), defaulting to open (100%)');
        return 100;
    }

    getPosition(callback) {
        // Since there's no position percentage, return tracked position
        callback(null, this.currentPosition);
    }

    setPosition(value, callback) {
        const {Characteristic} = this.hap;
        
        if (value === 0) {
            // Close blinds - but skip if already closed
            if (this.currentPosition === 0) {
                this.log('[TuyaAccessory] Blinds already closed, skipping close command');
                // Still allow tilt commands to proceed without delay
                return callback && callback(null);
            }
            
            // Actually need to close - track the time and set moving state
            this.log('[TuyaAccessory] Closing blinds');
            this.lastCloseTime = Date.now();
            this.isMoving = true;
            
            // Check if a tilt command was sent during previous movement
            if (this.lastTiltCommand && (Date.now() - this.lastTiltCommand.time < this.timeToClose * 1000)) {
                this.log('[TuyaAccessory] Close command received while tilt was pending - rescheduling tilt delay');
                
                // Cancel the buffer timeout if it exists
                if (this.tiltBufferTimeout) {
                    clearTimeout(this.tiltBufferTimeout);
                    this.tiltBufferTimeout = null;
                }
                
                // Cancel any existing delay
                if (this.tiltDelayTimeout) {
                    clearTimeout(this.tiltDelayTimeout);
                }
                
                // Schedule the tilt for after close completes
                const delayMs = this.timeToClose * 1000;
                this.tiltDelayTimeout = setTimeout(() => {
                    this.log('[TuyaAccessory] Executing delayed tilt angle:', this.lastTiltCommand.angle, '-> Tuya percent_control:', this.lastTiltCommand.value);
                    this._executeTilt(this.lastTiltCommand.value);
                    this.tiltDelayTimeout = null;
                    this.lastTiltCommand = null;
                }, delayMs);
            }
            
            this.currentPosition = 0;
            this.accessory.context.cachedPosition = 0; // Persist across restarts
            this.characteristicCurrentPosition.updateValue(0);
            this.characteristicPositionState.updateValue(Characteristic.PositionState.DECREASING);
            
            // Set timeout to mark as stopped after closing completes
            if (this.positionStateTimeout) {
                clearTimeout(this.positionStateTimeout);
            }
            this.positionStateTimeout = setTimeout(() => {
                this.log('[TuyaAccessory] Blinds finished closing');
                this.characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
                this.isMoving = false;
                this.lastCloseTime = 0;
                this.positionStateTimeout = null;
            }, this.timeToClose * 1000);
            
            return this.setState(this.dpAction, 'close', callback);
            
        } else if (value === 100) {
            // Open blinds - but skip if already open
            if (this.currentPosition === 100) {
                this.log('[TuyaAccessory] Blinds already open, skipping open command');
                return callback && callback(null);
            }
            
            // Actually need to open - reset close time and cancel any pending tilts
            this.log('[TuyaAccessory] Opening blinds');
            this._cancelPendingTilts();
            this.lastCloseTime = 0;
            this.lastTiltCommand = null;
            this.currentPosition = 100;
            this.accessory.context.cachedPosition = 100; // Persist across restarts
            this.characteristicCurrentPosition.updateValue(100);
            this.characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);
            return this.setState(this.dpAction, 'open', callback);
            
        } else {
            // For partial positions, open fully then user can adjust manually
            this.log('[TuyaAccessory] Partial position requested, opening fully');
            this._cancelPendingTilts();
            this.lastCloseTime = 0;
            this.lastTiltCommand = null;
            this.currentPosition = 100;
            this.accessory.context.cachedPosition = 100; // Persist across restarts
            this.characteristicCurrentPosition.updateValue(100);
            return this.setState(this.dpAction, 'open', callback);
        }
    }

    getPositionState(callback) {
        const {Characteristic} = this.hap;
        return callback(null, Characteristic.PositionState.STOPPED);
    }

    // Tilt angle methods
    getTiltAngle(callback) {
        // Read from percent_state (dp_id 3)
        this.getState([this.dpTiltState], (err, dps) => {
            if (err) return callback(err);
            callback(null, this._getTiltAngle(dps[this.dpTiltState]));
        });
    }

    _getTiltAngle(value) {
        // Convert Tuya percentage (0-100) to HomeKit tilt angle (-90 to 90)
        // Tuya: 0 = fully closed, 50 = most open, 100 = fully closed other direction
        // HomeKit: -90 = fully closed, 0 = most open, 90 = fully closed other direction
        const tuyaValue = parseInt(value);
        if (isNaN(tuyaValue)) return 0;
        return (tuyaValue - 50) * 1.8; // Maps 0-100 to -90 to 90
    }

    setTiltAngle(value, callback) {
        // Convert HomeKit tilt angle (-90 to 90) to Tuya percentage (0-100)
        const tuyaValue = Math.round((value / 1.8) + 50);
        const clampedValue = Math.max(0, Math.min(100, tuyaValue));
        
        // Store this command with timestamp
        this.lastTiltCommand = {
            angle: value,
            value: clampedValue,
            time: Date.now()
        };
        
        // Check if a close command was sent recently (within 3 seconds)
        const timeSinceClose = Date.now() - this.lastCloseTime;
        const shouldDelay = this.lastCloseTime > 0 && timeSinceClose < 3000;
        
        if (shouldDelay) {
            // Delay the tilt command until after blinds finish closing
            const delayMs = (this.timeToClose * 1000) - timeSinceClose;
            this.log('[TuyaAccessory] Tilt command received shortly after close - delaying by', Math.round(delayMs / 1000), 'seconds');
            
            // Cancel any existing delayed tilt
            this._cancelPendingTilts();
            
            // Schedule the tilt command
            this.tiltDelayTimeout = setTimeout(() => {
                this.log('[TuyaAccessory] Executing delayed tilt angle:', value, '-> Tuya percent_control:', clampedValue);
                this._executeTilt(clampedValue);
                this.tiltDelayTimeout = null;
                this.lastCloseTime = 0;
                this.lastTiltCommand = null;
            }, delayMs);
            
            // Call callback immediately so HomeKit doesn't wait
            return callback && callback(null);
            
        } else {
            // Add a small buffer (200ms) to wait for a potential close command
            // This handles the case where tilt arrives just before close
            this.log('[TuyaAccessory] Setting tilt angle:', value, '-> Tuya percent_control:', clampedValue);
            
            // Cancel any existing buffer
            if (this.tiltBufferTimeout) {
                clearTimeout(this.tiltBufferTimeout);
            }
            
            this.tiltBufferTimeout = setTimeout(() => {
                // Check again if close command arrived during the buffer
                if (this.lastCloseTime > 0 && (Date.now() - this.lastCloseTime < 3000)) {
                    this.log('[TuyaAccessory] Close command arrived during tilt buffer - extending delay');
                    // The setPosition method will handle rescheduling
                } else {
                    // No close command, execute tilt normally
                    this._executeTilt(clampedValue);
                    this.lastTiltCommand = null;
                }
                this.tiltBufferTimeout = null;
            }, 200);
            
            return callback && callback(null);
        }
    }

    _executeTilt(value) {
        // Force update: Bypass setState caching and call device.update directly
        // This is needed because percent_control (dp 2) is not reported in device state
        if (!this.device.connected) {
            this.log('[TuyaAccessory] Cannot execute tilt - device not connected');
            return;
        }
        
        this.device.update({[this.dpTilt]: value});
    }

    _cancelPendingTilts() {
        if (this.tiltBufferTimeout) {
            clearTimeout(this.tiltBufferTimeout);
            this.tiltBufferTimeout = null;
            this.log('[TuyaAccessory] Cleared pending tilt buffer');
        }
        if (this.tiltDelayTimeout) {
            clearTimeout(this.tiltDelayTimeout);
            this.tiltDelayTimeout = null;
            this.log('[TuyaAccessory] Cleared pending tilt delay');
        }
    }

    updateState(data) {
        const {Characteristic} = this.hap;
        
        // Update tilt based on percent_state (dp_id 3)
        if (data[this.dpTiltState] !== undefined) {
            const tiltAngle = this._getTiltAngle(data[this.dpTiltState]);
            this.log.debug('[TuyaAccessory] Tilt state updated to:', data[this.dpTiltState], '-> angle:', tiltAngle);
            this.characteristicCurrentHorizontalTilt.updateValue(tiltAngle);
            this.characteristicTargetHorizontalTilt.updateValue(tiltAngle);
        }

        // Update position state based on control actions
        if (data[this.dpAction] !== undefined) {
            const action = data[this.dpAction];
            this.log.debug('[TuyaAccessory] Control action:', action);
            
            if (action === 'open') {
                this.currentPosition = 100;
                this.accessory.context.cachedPosition = 100; // Persist across restarts
                this.characteristicCurrentPosition.updateValue(100);
                this.characteristicTargetPosition.updateValue(100);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);
            } else if (action === 'close') {
                this.currentPosition = 0;
                this.accessory.context.cachedPosition = 0; // Persist across restarts
                this.characteristicCurrentPosition.updateValue(0);
                this.characteristicTargetPosition.updateValue(0);
                this.characteristicPositionState.updateValue(Characteristic.PositionState.DECREASING);
            } else if (action === 'stop') {
                this.characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
            }
        }
    }
}

module.exports = VerticalBlindsWithTilt;