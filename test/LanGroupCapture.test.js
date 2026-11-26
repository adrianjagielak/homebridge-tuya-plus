'use strict';

const {searchLanGroups, MAX_CAPTURE_BYTES} = require('../lib/LanGroupCapture');
const {KEY, GROUP, ADDRESS, GOLDEN, frame, packet, pcap, pcapng} = require('./support/lan-group-capture');
const search = data => searchLanGroups(data, {key: KEY, ip: ADDRESS});

describe('offline LAN group discovery', () => {
    test('finds the address in the independently captured golden frame', () => {
        expect(search(pcap([packet(GOLDEN)])).groups).toEqual([{cid: '0058', mbid: 'c020', address: ADDRESS, commands: 1}]);
    });
    test.each([0, 1, 101, 108, 113, 228, 276])('supports link type %i', link => {
        expect(search(pcap([packet(frame(), {link})], link)).groups).toHaveLength(1);
    });
    test.each([true, false])('supports both PCAP byte orders (%s)', little => {
        expect(search(pcap([packet(frame())], 276, little)).groups).toHaveLength(1);
    });
    test.each([true, false])('supports both PCAPNG byte orders (%s)', little => {
        expect(search(pcapng([packet(frame())], 276, little)).groups).toHaveLength(1);
    });
    test('reassembles split, out-of-order and retransmitted TCP data once', () => {
        const data = frame();
        const first = packet(data.subarray(0, 20));
        const last = packet(data.subarray(20), {sequence: 1020});
        expect(search(pcap([last, first, first])).groups[0].commands).toBe(1);
    });
    test('keeps separate PCAPNG sections independent when TCP tuples are reused', () => {
        const capture = Buffer.concat([
            pcapng([packet(frame())]),
            pcapng([packet(frame({...GROUP, cid: '0059'}))], 276, false)
        ]);
        expect(search(capture).groups).toHaveLength(2);
    });
    test('handles sequence-number wraparound', () => {
        const data = frame();
        const seq = 0xfffffff0;
        expect(search(pcap([packet(data.subarray(0, 40), {sequence: seq}), packet(data.subarray(40), {sequence: (seq + 40) >>> 0})])).groups).toHaveLength(1);
    });
    test('does not join frames across missing TCP bytes', () => {
        const data = frame();
        expect(search(pcap([packet(data.subarray(0, 20)), packet(data.subarray(30), {sequence: 1030})])).groups).toEqual([]);
    });
    test('returns all observed groups without choosing one', () => {
        const data = Buffer.concat([frame(), frame({...GROUP, cid: '0059', mbid: 'C021'}), frame()]);
        const result = search(pcap([packet(data)]));
        expect(result.groups).toEqual([
            {cid: '0058', mbid: 'c020', address: ADDRESS, commands: 2},
            {cid: '0059', mbid: 'c021', address: ADDRESS, commands: 1}
        ]);
        expect(JSON.stringify(result)).not.toContain(KEY);
        expect(JSON.stringify(result)).not.toContain('dps');
    });
    test('filters another device even if the same key is supplied', () => {
        expect(search(pcap([packet(frame(), {address: '192.0.2.51'})])).groups).toEqual([]);
    });
    test('can match by the selected key when the configured IP is automatic', () => {
        expect(searchLanGroups(pcap([packet(frame())]), {key: KEY}).groups).toHaveLength(1);
    });
    test('never guesses addresses for a wrong key', () => {
        expect(searchLanGroups(pcap([packet(frame())]), {key: 'fedcba9876543210'}).groups).toEqual([]);
    });
    test.each([{...GROUP, ctype: 0}, {...GROUP, cid: '58'}, {...GROUP, mbid: 'zzzz'}, {...GROUP, dps: {}}, {devId: 'example', dps: {'1': true}}])('rejects non-group envelopes', message => {
        expect(search(pcap([packet(frame(message))])).groups).toEqual([]);
    });
    test('does not treat another protocol header as supported', () => {
        expect(search(pcap([packet(frame(GROUP, KEY, '3.4'))])).groups).toEqual([]);
    });
    test('rejects a corrupt frame checksum', () => {
        const data = frame(); data[40] ^= 1;
        expect(search(pcap([packet(data)])).groups).toEqual([]);
    });
    test('rejects malformed and over-limit files with safe errors', () => {
        expect(() => search(Buffer.alloc(MAX_CAPTURE_BYTES + 1))).toThrow('16 MiB');
        expect(() => search(Buffer.alloc(32))).toThrow('PCAP');
        expect(() => search(pcap([packet(frame())]).subarray(0, -1))).toThrow('incomplete');
        expect(() => search(pcapng([packet(frame())]).subarray(0, -1))).toThrow('incomplete');
        expect(() => searchLanGroups(pcap([]), {key: 'short'})).toThrow('16-byte');
    });
});
