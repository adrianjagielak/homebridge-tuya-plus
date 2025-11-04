const dgram = require('dgram');
const crypto = require('crypto');
const EventEmitter = require('events');

const UDP_KEY = Buffer.from('6c1ec8e2bb9bb59ab50b0daf649b410a', 'hex');

const GCM_DISCOVERY_KEY = crypto.createHash('md5').update('yGAdlopoPVldABfn').digest(); // v3.5 UDP/GCM key
const PREFIX_55AA = 0x000055aa; // v3.1-3.4
const PREFIX_6699 = 0x00006699; // v3.5
const SUFFIX_AA55 = 0x0000aa55;
const SUFFIX_9966 = 0x00009966;

class TuyaDiscovery extends EventEmitter {
    constructor() {
        super();

        this.discovered = new Map();
        this.limitedIds = [];
        this._servers = {};
        this._running = false;
    }

    start(props) {
        this.log = props.log;

        const opts = props || {};

        if (opts.clear) {
            this.removeAllListeners();
            this.discovered.clear();
        }

        this.limitedIds.splice(0);
        if (Array.isArray(opts.ids)) [].push.apply(this.limitedIds, opts.ids);

        this._running = true;
        this._start(6666);
        this._start(6667);
        this._start(7000); // v3.5 direct-reply port
        this._sendV35Probe(); // broadcast a probe so silent 3.5 devices answer us

        return this;
    }

    stop() {
        this._running = false;
        this._stop(6666);
        this._stop(6667);
        this._stop(7000);

        return this;
    }

    end() {
        this.stop();
        process.nextTick(() => {
            this.removeAllListeners();
            this.discovered.clear();
            this.log.info('Discovery ended.');
            this.emit('end');
        });

        return this;
    }

    _start(port) {
        this._stop(port);

        const server = this._servers[port] = dgram.createSocket({type: 'udp4', reuseAddr: true});
        server.on('error', this._onDgramError.bind(this, port));
        server.on('close', this._onDgramClose.bind(this, port));
        server.on('message', this._onDgramMessage.bind(this, port));

        server.bind(port, () => {
            this.log.info(`Discovery - Discovery started on port ${port}.`);
        });
    }

    _stop(port) {
        if (this._servers[port]) {
            this._servers[port].removeAllListeners();
            this._servers[port].close();
            this._servers[port] = null;
        }
    }

    _onDgramError(port, err) {
        this._stop(port);

        if (err && err.code === 'EADDRINUSE') {
            this.log.warn(`Discovery - Port ${port} is in use. Will retry in 15 seconds.`);

            setTimeout(() => {
                this._start(port);
            }, 15000);
        } else {
            this.log.error(`Discovery - Port ${port} failed:\n${err.stack}`);
        }
    }

    _onDgramClose(port) {
        this._stop(port);

        this.log.info(`Discovery - Port ${port} closed.${this._running ? ' Restarting...' : ''}`);
        if (this._running)
            setTimeout(() => {
                this._start(port);
            }, 1000);
    }

    _onDgramMessage(port, msg, info) {
        const len = msg.length;
        const prefix = msg.readUInt32BE(0);
        const suffix = msg.readUInt32BE(len - 4);

        /* 3.1-3.4 packets: 0x55AA … 0xAA55
           3.5  packets: 0x6699 … 0x9966  */
        const isV34Frame = prefix === 0x000055aa && suffix === 0x0000aa55;
        const isV35Frame = prefix === 0x00006699 && suffix === 0x00009966;

        if (!isV34Frame && !isV35Frame) {
            // Not a Tuya discovery frame – ignore.
            return;
        }

        if (isV34Frame) {
            // original logic v3.1-3.4 devices
            return this._handleV34(msg, port, info);
        }

        /* v3.5 handling */
        return this._handleV35(msg, port, info);
    }

    _handleV34(pkt, port, info) {
        const len  = pkt.length;
        const size = pkt.readUInt32BE(12);

        if (len - size < 8) {
            this.log.error(`Discovery - UDP from ${info.address}:${port} size ${len - size}`);
            return;
        }

        const cleanMsg = pkt.slice(len - size + 4, len - 8);

        let decryptedMsg;
        if (port === 6667) { // encrypted replies
            try {
                const decipher = crypto.createDecipheriv('aes-128-ecb', UDP_KEY, '');
                decryptedMsg   = decipher.update(cleanMsg, 'utf8', 'utf8');
                decryptedMsg  += decipher.final('utf8');
            } catch (_) { /* ignore */ }
        }

        if (!decryptedMsg) decryptedMsg = cleanMsg.toString('utf8');

        try {
            const result = JSON.parse(decryptedMsg);
            if (result && result.gwId && result.ip) {
                this._onDiscover(result);
            } else {
                this.log.error(`Discovery - UDP from ${info.address}:${port} decrypted`, cleanMsg.toString('hex'));
            }
        } catch (ex) {
            this.log.error(`Discovery - Failed to parse discovery response on port ${port}: ${decryptedMsg}`);
            this.log.error(`Discovery - Failed to parse discovery raw message on port ${port}: ${pkt.toString('hex')}`);
        }
    }


    /*
     * Handle protocol-3.5 discovery replies (0x6699 … 0x9966, AES-GCM).
     *
     * Packet layout (offsets after the 4-byte prefix):
     *   1     version
     *   2     reserved
     *   3-6   sequence   (uint32)
     *   7-10  command    (0 for discovery)
     *   11-14 length     (uint32 – bytes that follow up to but NOT incl. suffix)
     *   15-26 IV         (12 bytes – GCM nonce)
     *   27-(n-20) cipher (variable)
     *   n-16  tag        (16-byte GCM auth tag)
     *   n     n+3 suffix 0x00009966
     */
    _handleV35(pkt, srcPort, info) {
        try {
            const len = pkt.length;
            const iv      = pkt.slice(18, 30);               // 12-byte nonce
            const cipher  = pkt.slice(30, len - 20);         // ciphertext
            const tag     = pkt.slice(len - 20, len - 4);    // 16-byte tag
            const aad     = pkt.slice(4, 18);                // version+reserved+seq+command+length
     
            const decipher = crypto.createDecipheriv(
                'aes-128-gcm',
                GCM_DISCOVERY_KEY,   // static key defined at top of file
                iv
            );
            decipher.setAuthTag(tag);
            decipher.setAAD(aad);
                 
            let decrypted = Buffer.concat([
                decipher.update(cipher),
                decipher.final()
            ]);
                 
            // Remove the first 4 null bytes if present
            if (decrypted.length > 4 && decrypted.readUInt32BE(0) === 0) {
                decrypted = decrypted.slice(4);
            }
                 
            const jsonStr = decrypted.toString('utf8').trim();
                 
            const payload = JSON.parse(jsonStr);
            if (payload && payload.gwId && payload.ip) {
                this._onDiscover(payload);
            }
        } catch (ex) {
            this.log.error(
                `Discovery v3.5 – failed to decrypt packet from ${info.address}:${srcPort}:`,
                ex.message
            );
        }
    }

    _onDiscover(data) {
        if (this.discovered.has(data.gwId)) return;

        data.id = data.gwId;
        delete data.gwId;

        this.discovered.set(data.id, data.ip);

        this.emit('discover', data);

        if (this.limitedIds.length &&
            this.limitedIds.includes(data.id) && // Just to avoid checking the rest unnecessarily
            this.limitedIds.length <= this.discovered.size &&
            this.limitedIds.every(id => this.discovered.has(id))
        ) {
            process.nextTick(() => {
                this.end();
            });
        }
    }

    _sendV35Probe() {
        const socket = dgram.createSocket('udp4');
        const payload = Buffer.from('{"from":"app","ip":"255.255.255.255"}');
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-128-gcm', GCM_DISCOVERY_KEY, iv);
        cipher.setAAD(Buffer.alloc(14)); // UUUU+seq+cmd+len = zeros OK for probe
        const enc = Buffer.concat([cipher.update(payload), cipher.final()]);
        const tag = cipher.getAuthTag();
        const len = Buffer.alloc(4); len.writeUInt32BE(iv.length + enc.length + tag.length, 0);
        const frame = Buffer.concat([
            Buffer.from([0,0,0,0x66,0x99].slice(0,4)), // 6699 prefix
            Buffer.alloc(14), // UUUU + seq + cmd (0) + len placeholder
            len,
            iv,
            enc,
            tag,
            Buffer.from('00009966','hex')
        ]);
        socket.send(frame, 7000, '255.255.255.255', () => socket.close());
    }
}

module.exports = new TuyaDiscovery();
