'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024;
const MAX_PACKETS = 100000;
const MAX_FLOWS = 256;
const MAX_FRAMES = 10000;
const PREFIX = Buffer.from('000055aa', 'hex');
const SUPPORTED_LINKS = new Set([0, 1, 101, 108, 113, 228, 276]);
const crcTable = Array.from({length: 256}, (_, n) => {
    for (let bit = 0; bit < 8; bit++) n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
    return n >>> 0;
});
const crc32 = data => {
    let crc = 0xffffffff;
    for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
    return (crc ^ 0xffffffff) >>> 0;
};

function* packets(data) {
    const magic = data.subarray(0, 4).toString('hex');
    if (['d4c3b2a1', 'a1b2c3d4', '4d3cb2a1', 'a1b23c4d'].includes(magic)) {
        if (data.length < 24) throw new Error('The PCAP header is incomplete.');
        const little = magic === 'd4c3b2a1' || magic === '4d3cb2a1';
        const read = offset => little ? data.readUInt32LE(offset) : data.readUInt32BE(offset);
        const link = read(20) & 0xffff;
        if (!SUPPORTED_LINKS.has(link)) throw new Error('Unsupported capture link type. Use Ethernet, raw IP or Linux cooked capture.');
        for (let offset = 24; offset < data.length;) {
            if (offset + 16 > data.length) throw new Error('The PCAP record header is incomplete.');
            const length = read(offset + 8);
            if (offset + 16 + length > data.length) throw new Error('The PCAP contains an incomplete packet record.');
            yield {link, data: data.subarray(offset + 16, offset + 16 + length)};
            offset += 16 + length;
        }
        return;
    }
    if (magic !== '0a0d0d0a') throw new Error('Choose a PCAP or PCAPNG packet capture.');
    let little;
    let interfaces = [];
    let sectionId = 0;
    for (let offset = 0; offset < data.length;) {
        if (offset + 12 > data.length) throw new Error('The PCAPNG block header is incomplete.');
        const section = data.readUInt32BE(offset) === 0x0a0d0d0a;
        if (section) {
            const bom = data.readUInt32BE(offset + 8);
            if (bom !== 0x1a2b3c4d && bom !== 0x4d3c2b1a) throw new Error('Invalid PCAPNG byte order.');
            little = bom === 0x4d3c2b1a;
            interfaces = [];
            sectionId++;
        }
        if (little === undefined) throw new Error('The PCAPNG section header is missing.');
        const read = at => little ? data.readUInt32LE(at) : data.readUInt32BE(at);
        const type = read(offset);
        const length = read(offset + 4);
        if (length < 12 || length % 4 || offset + length > data.length || read(offset + length - 4) !== length) {
            throw new Error('The PCAPNG contains an invalid or incomplete block.');
        }
        if (section && length < 28) throw new Error('The PCAPNG section header is incomplete.');
        if (type === 1) {
            if (length < 20 || interfaces.length >= MAX_FLOWS) throw new Error('Invalid PCAPNG interface block.');
            interfaces.push(little ? data.readUInt16LE(offset + 8) : data.readUInt16BE(offset + 8));
        } else if (type === 6) {
            if (length < 32) throw new Error('Invalid PCAPNG packet block.');
            const link = interfaces[read(offset + 8)];
            const captured = read(offset + 20);
            if (link === undefined || captured > length - 32) throw new Error('Invalid PCAPNG packet length or interface.');
            if (SUPPORTED_LINKS.has(link)) yield {link, sectionId, data: data.subarray(offset + 28, offset + 28 + captured)};
        } else if (type === 3) {
            if (length < 16 || !interfaces.length) throw new Error('Invalid PCAPNG simple packet block.');
            const captured = Math.min(read(offset + 8), length - 16);
            if (SUPPORTED_LINKS.has(interfaces[0])) yield {link: interfaces[0], sectionId, data: data.subarray(offset + 12, offset + 12 + captured)};
        }
        offset += length;
    }
}

function tcpPayload(packet, ip, port) {
    const data = packet.data;
    let offset;
    if (packet.link === 1) {
        if (data.length < 14) return;
        offset = 14;
        let type = data.readUInt16BE(12);
        while ([0x8100, 0x88a8, 0x9100].includes(type)) {
            if (offset + 4 > data.length) return;
            type = data.readUInt16BE(offset + 2);
            offset += 4;
        }
        if (type !== 0x0800) return;
    } else if (packet.link === 113) {
        if (data.length < 16 || data.readUInt16BE(14) !== 0x0800) return;
        offset = 16;
    } else if (packet.link === 276) {
        if (data.length < 20 || data.readUInt16BE(0) !== 0x0800) return;
        offset = 20;
    } else {
        offset = packet.link === 0 || packet.link === 108 ? 4 : 0;
    }
    if (offset + 20 > data.length || data[offset] >>> 4 !== 4 || data[offset + 9] !== 6) return;
    const ihl = (data[offset] & 15) * 4;
    const total = data.readUInt16BE(offset + 2);
    if (ihl < 20 || total < ihl + 20 || offset + total > data.length || data.readUInt16BE(offset + 6) & 0x3fff) return;
    const address = Array.from(data.subarray(offset + 16, offset + 20)).join('.');
    const source = Array.from(data.subarray(offset + 12, offset + 16)).join('.');
    const tcp = offset + ihl;
    if (data.readUInt16BE(tcp + 2) !== port || (ip && ip !== address)) return;
    const header = (data[tcp + 12] >>> 4) * 4;
    if (header < 20 || ihl + header > total) return;
    const flags = data[tcp + 13];
    return {
        flow: `${packet.sectionId || 0}/${source}:${data.readUInt16BE(tcp)}>${address}:${port}`, address, flags,
        sequence: (data.readUInt32BE(tcp + 4) + ((flags & 2) ? 1 : 0)) >>> 0,
        data: data.subarray(tcp + header, offset + total)
    };
}

function* runs(segments) {
    const anchor = segments[0].sequence;
    const ordered = segments.map(s => ({offset: (s.sequence - anchor) | 0, data: s.data}))
        .sort((a, b) => a.offset - b.offset);
    let chunks = [];
    let end;
    for (const segment of ordered) {
        if (end !== undefined && segment.offset > end) {
            yield Buffer.concat(chunks);
            chunks = [];
            end = undefined;
        }
        const skip = end === undefined ? 0 : Math.max(0, end - segment.offset);
        if (skip >= segment.data.length) continue;
        chunks.push(segment.data.subarray(skip));
        end = segment.offset + segment.data.length;
    }
    if (chunks.length) yield Buffer.concat(chunks);
}

function searchLanGroups(capture, {key, ip, port = 6668}) {
    if (!Buffer.isBuffer(capture) || capture.length < 12 || capture.length > MAX_CAPTURE_BYTES) {
        throw new Error('Choose a packet capture no larger than 16 MiB.');
    }
    if (typeof key !== 'string' || Buffer.byteLength(key) !== 16) throw new Error('The selected light needs its current 16-byte local key.');
    if (ip && net.isIP(ip) !== 4) throw new Error('Capture search currently supports IPv4 device addresses.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid device TCP port.');
    const stats = {packets: 0, devicePackets: 0, validFrames: 0, decryptedCommands: 0, groupCommands: 0};
    const active = new Map();
    const flows = [];
    for (const packet of packets(capture)) {
        if (++stats.packets > MAX_PACKETS) throw new Error('The capture contains too many packets. Record a shorter device-filtered capture.');
        const tcp = tcpPayload(packet, ip, port);
        if (!tcp) continue;
        stats.devicePackets++;
        let flow = active.get(tcp.flow);
        if (!flow || ((tcp.flags & 2) && flow.syn !== tcp.sequence)) {
            if (flows.length >= MAX_FLOWS) throw new Error('The capture contains too many connections. Filter it to the selected device.');
            flow = {address: tcp.address, syn: tcp.flags & 2 ? tcp.sequence : undefined, segments: []};
            flows.push(flow);
            active.set(tcp.flow, flow);
        }
        if (tcp.data.length) flow.segments.push(tcp);
        if (tcp.flags & 5) active.delete(tcp.flow);
    }
    const groups = new Map();
    let examined = 0;
    for (const flow of flows) {
        if (!flow.segments.length) continue;
        for (const stream of runs(flow.segments)) {
            for (let offset = 0; offset + 24 <= stream.length;) {
                offset = stream.indexOf(PREFIX, offset);
                if (offset < 0 || offset + 24 > stream.length) break;
                if (++examined > MAX_FRAMES) throw new Error('The capture contains too many Tuya frames. Record a shorter capture.');
                const length = stream.readUInt32BE(offset + 12);
                if (length < 8 || length > 65536) { offset++; continue; }
                const end = offset + 16 + length;
                if (end > stream.length) { offset++; continue; }
                const frame = stream.subarray(offset, end);
                offset = end;
                if (frame.readUInt32BE(frame.length - 4) !== 0xaa55 || crc32(frame.subarray(0, -8)) !== frame.readUInt32BE(frame.length - 8)) continue;
                stats.validFrames++;
                if (frame.readUInt32BE(8) !== 13 || frame.subarray(16, 19).toString() !== '3.3') continue;
                const encrypted = frame.subarray(31, -8);
                if (!encrypted.length || encrypted.length % 16) continue;
                let message;
                try {
                    const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key), null);
                    message = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
                } catch (_) { continue; }
                stats.decryptedCommands++;
                if (!message || message.ctype !== 2 || typeof message.cid !== 'string' || typeof message.mbid !== 'string' ||
                    !/^[0-9a-f]{4}$/i.test(message.cid) || !/^[0-9a-f]{4}$/i.test(message.mbid) ||
                    !message.dps || typeof message.dps !== 'object' || Array.isArray(message.dps) || !Object.keys(message.dps).length) continue;
                stats.groupCommands++;
                const cid = message.cid.toLowerCase(), mbid = message.mbid.toLowerCase();
                const groupId = `${flow.address}/${cid}/${mbid}`;
                const group = groups.get(groupId) || {cid, mbid, address: flow.address, commands: 0};
                group.commands++;
                groups.set(groupId, group);
            }
        }
    }
    return {groups: [...groups.values()], stats};
}

module.exports = {searchLanGroups, MAX_CAPTURE_BYTES};
