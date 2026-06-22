const BaseAccessory = require('./BaseAccessory');
const async = require('async');
const https = require('https');
const url = require('url');

const DP_DOORBELL = '154'; // provides base64-encoded URL of static image
const DP_DOOR = '148'; // provides boolean of whether the switch is toggled
const DP_GATE = '232'; // provides boolean of whether the switch is toggled 

const LOCK_TIMEOUT = 5000;

class DoorbellDelegate /*extends CameraStreamingDelegate*/ {

    constructor(log) {
        this.log = log || console;
        this.cameraImage = undefined;
    }

    setCameraImage(image) {
      this.cameraImage = image;
    }

    storeImage(urlString, callback) {
        const urlObject = url.parse(urlString);
        const me = this;
        https.get(urlObject, 
            function(res) {
                var body=Buffer.alloc(0);

                if (res.statusCode!==200) {
                    return me.log.error('Doorbell image fetch failed: HTTP %s', res.statusCode);
                }

                res.on('data', function(chunk) {
                    body=Buffer.concat([body, chunk]);
                });

                res.on('end', function() {
                    me.setCameraImage(body);
                    me.log.debug('Doorbell image stored.');
                    callback();
                });

                res.on('error', function(err) {
                    me.log.error('Doorbell image fetch error:', err);
                });
            }
        );
    }

    /* SnapshotRequest, SnapshotRequestCallback (function taking error or HAPStatus and Buffer), returns void */
    handleSnapshotRequest(request, callback) {
        //TODO honour the image size in the request (SnapshotRequest).
        callback(undefined, this.cameraImage);
    }

    
    /* PrepareStreamRequest, PrepareStreamCallback (function taking optional error and PrepareStreamResponse), returns void */
    prepareStream(request, callback) {

    }

    /* StreamingRequest, StreamRequestCallback (function taking optional Error), returns void */
    handleStreamRequest(request, callback) {

    }
}

class DoorbellAccessory extends BaseAccessory {
    
    static getCategory(Categories) {
        return Categories.CAMERA;
    }

    constructor(...props) {
        super(...props);
    }

    _registerPlatformAccessory() {
        const {Service, Characteristic} = this.hap;

        const doorbellService = this.accessory.getService(Service.Doorbell) || this.accessory.addService(Service.Doorbell);
        this._checkServiceName(doorbellService, this.device.context.name);

        doorbellService.setPrimaryService(true);
        super._registerPlatformAccessory();
    }


    _registerCharacteristics(dps) {
        const {Service, Characteristic} = this.hap;

        this.configureCamera();

        const service = this.accessory.getService(Service.Doorbell);


        this.device.on('change', (changes, state) => {
            if (changes.hasOwnProperty(DP_DOORBELL)) {
                const urlBase64 = changes[DP_DOORBELL];
                const strUrl = Buffer.from(urlBase64, 'base64');

                this.streamingDelegate.storeImage(strUrl.toString(), () => {
                  service.updateCharacteristic(Characteristic.ProgrammableSwitchEvent, Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
                  });
            }

            if (changes.hasOwnProperty(DP_DOOR)) {
                this.log.debug('Door button pressed');
            }

            if (changes.hasOwnProperty(DP_GATE)) {
                this.log.debug('Gate button pressed');
            }
        });
    }

    configureCamera() {
        this.streamingDelegate = new DoorbellDelegate(this.log);
        this.log.debug('Created camera streaming delegate.');
        const options = {
          cameraStreamCount: 1, 
          delegate: this.streamingDelegate,
          streamingOptions: {
            supportedCryptoSuites: [this.hap.SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80],
            video: {
              resolutions: [
                [320, 180, 30],
                [320, 240, 15], // Apple Watch requires this configuration
                [320, 240, 30],
                [480, 270, 30],
                [480, 360, 30],
                [640, 360, 30],
                [640, 480, 30],
                [1280, 720, 30],
                [1280, 960, 30],
                [1920, 1080, 30],
                [1600, 1200, 30],
              ],
              codec: {
                profiles: [this.hap.H264Profile.BASELINE, this.hap.H264Profile.MAIN, this.hap.H264Profile.HIGH],
                levels: [this.hap.H264Level.LEVEL3_1, this.hap.H264Level.LEVEL3_2, this.hap.H264Level.LEVEL4_0],
              },
            },
            audio: {
              twoWayAudio: true,
              codecs: [
                {
                  type: this.hap.AudioStreamingCodecType.AAC_ELD,
                  samplerate: this.hap.AudioStreamingSamplerate.KHZ_16,
                },
              ],
            },
          },
        };
    
        const cameraController = new this.hap.CameraController(options);
        this.accessory.configureController(cameraController);
    }

    pushDoor(callback) {
        this.device.update({[DP_DOOR.toString()] : !this.device.state[DP_DOOR]});
    }

    pushGate(callback) {
        this.setState(DP_GATE, !this.device.state[DP_GATE]);
    }


    handleLockCurrentStateGet() {
        return this.doorState;
      }
    
      handleLockTargetStateGet() {
        return this.doorState;
      }
    
      async handleLockTargetStateSet(value) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.LockMechanism);

        try {
          this.pushDoor();
    
          service.getCharacteristic(Characteristic.LockCurrentState).updateValue(value);
          service.getCharacteristic(Characteristic.LockTargetState).updateValue(value);
          this.doorState = value;
    
          setTimeout(() => {
            service.getCharacteristic(Characteristic.LockCurrentState).updateValue(Characteristic.LockCurrentState.SECURED);
            service.getCharacteristic(Characteristic.LockTargetState).updateValue(Characteristic.LockTargetState.SECURED);
            this.doorState = Characteristic.LockTargetState.SECURED;
          }, LOCK_TIMEOUT);
        } catch (error) {
          this.log.error('Unlock failed', error);
        }
      }

}

module.exports = DoorbellAccessory;
