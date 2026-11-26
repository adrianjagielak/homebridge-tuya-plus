'use strict';

const crypto = require('node:crypto');
const KEY = '0123456789abcdef';
const GROUP = {cid: '0058', ctype: 2, dps: {'1': false}, mbid: 'c020'};
const ADDRESS = '192.0.2.50';
const GOLDEN = Buffer.from('000055aa000000010000000d00000057332e3300000000000000000000000035dc001e766f5da604f317f994e31d0aa6a13c184f585a8b6b802aa8f554364786f7db64a0e6c864cc800319eea3cdf3337a3659280b727173aa5ac18f64d99d2a084ddb0000aa55', 'hex');

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function frame(message = GROUP, key = KEY, version = '3.3') {
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
    const data = Buffer.alloc(16 + 15 + encrypted.length + 8);
    data.writeUInt32BE(0x55aa, 0);
    data.writeUInt32BE(1, 4);
    data.writeUInt32BE(13, 8);
    data.writeUInt32BE(data.length - 16, 12);
    data.write(version, 16);
    encrypted.copy(data, 31);
    data.writeUInt32BE(crc32(data.subarray(0, -8)), data.length - 8);
    data.writeUInt32BE(0xaa55, data.length - 4);
    return data;
}
function packet(payload, {sequence = 1000, address = ADDRESS, port = 6668, flags = 0x18, link = 276} = {}) {
    const offsets = {0: 4, 1: 14, 101: 0, 108: 4, 113: 16, 228: 0, 276: 20};
    const offset = offsets[link];
    const data = Buffer.alloc(offset + 40 + payload.length);
    if (link === 1) data.writeUInt16BE(0x0800, 12);
    if (link === 113) data.writeUInt16BE(0x0800, 14);
    if (link === 276) data.writeUInt16BE(0x0800, 0);
    data[offset] = 0x45;
    data.writeUInt16BE(40 + payload.length, offset + 2);
    data[offset + 9] = 6;
    Buffer.from([192, 0, 2, 1]).copy(data, offset + 12);
    Buffer.from(address.split('.').map(Number)).copy(data, offset + 16);
    data.writeUInt16BE(43210, offset + 20);
    data.writeUInt16BE(port, offset + 22);
    data.writeUInt32BE(sequence >>> 0, offset + 24);
    data[offset + 32] = 0x50;
    data[offset + 33] = flags;
    payload.copy(data, offset + 40);
    return data;
}
function pcap(packets, link = 276, little = true) {
    const header = Buffer.alloc(24);
    const write = (buffer, value, offset) => little ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset);
    write(header, 0xa1b2c3d4, 0);
    if (little) header.writeUInt16LE(2, 4); else header.writeUInt16BE(2, 4);
    write(header, 65535, 16);
    write(header, link, 20);
    const records = packets.map(data => {
        const record = Buffer.alloc(16);
        write(record, data.length, 8);
        write(record, data.length, 12);
        return Buffer.concat([record, data]);
    });
    return Buffer.concat([header, ...records]);
}
function pcapng(packets, link = 276, little = true) {
    const write = (buffer, value, offset) => little ? buffer.writeUInt32LE(value, offset) : buffer.writeUInt32BE(value, offset);
    const block = (type, body) => {
        const data = Buffer.alloc(12 + Math.ceil(body.length / 4) * 4);
        write(data, type, 0); write(data, data.length, 4); body.copy(data, 8); write(data, data.length, data.length - 4);
        return data;
    };
    const section = Buffer.alloc(16); write(section, 0x1a2b3c4d, 0);
    const iface = Buffer.alloc(8); if (little) iface.writeUInt16LE(link); else iface.writeUInt16BE(link); write(iface, 65535, 4);
    return Buffer.concat([block(0x0a0d0d0a, section), block(1, iface), ...packets.map(data => {
        const body = Buffer.alloc(20 + data.length); write(body, data.length, 12); write(body, data.length, 16); data.copy(body, 20);
        return block(6, body);
    })]);
}

module.exports = {KEY, GROUP, ADDRESS, GOLDEN, frame, packet, pcap, pcapng};
