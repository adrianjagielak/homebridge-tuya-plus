#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const program = require('commander');
const {findConfigPath, listLights, selectLight, findLanGroups, lanGroupSnippet} = require('../lib/LanGroupDiscovery');

let captureFile;

program
    .name('tuya-lan-group-find')
    .description('Find the Tuya LAN group addresses (cid and mbid) of a light in a packet capture.')
    .usage('[options] <capture.pcap|capture.pcapng>')
    .option('--device <id or name>', 'saved light in the Homebridge config whose key and IP to use')
    .option('--config <path>', 'Homebridge config.json to read the light from (default: the usual Homebridge locations)')
    .option('--key <key>', 'local key of the Wi-Fi light, instead of reading it from the config')
    .option('--ip <address>', 'IPv4 address of the Wi-Fi light (overrides the config)')
    .option('--port <port>', 'Tuya TCP port of the light', value => parseInt(value, 10))
    .option('--json', 'print the result as JSON')
    .arguments('<capture>')
    .action(file => {
        captureFile = file;
    })
    .parse(process.argv);

const fail = message => {
    console.error(`Error: ${message}`);
    process.exit(1);
};

function readConfig() {
    const configPath = program.config ? path.resolve(program.config) : findConfigPath();
    if (!configPath) fail('Could not find the Homebridge config.json. Pass it with --config <path>, or pass --key instead.');
    try {
        return {configPath, config: JSON.parse(fs.readFileSync(configPath, 'utf8'))};
    } catch (error) {
        return fail(`Unable to read ${configPath}: ${error.code === 'EACCES' ? 'permission denied (try running with sudo)' : error.message}`);
    }
}

function resolveTarget() {
    if (program.key) {
        return {name: program.ip || 'the light', key: program.key, ip: program.ip, port: program.port};
    }
    const {configPath, config} = readConfig();
    if (!program.device) {
        const lights = listLights(config);
        const list = lights.length
            ? lights.map(light => `  ${light.id}  ${light.name} (${light.type}${light.ip ? `, ${light.ip}` : ''})`).join('\n')
            : '  (no TuyaLan lights found)';
        fail(`Choose a light with --device <id or name>. Saved lights in ${configPath}:\n${list}`);
    }
    try {
        const device = selectLight(config, program.device);
        return {
            name: device.name || device.id,
            key: device.key,
            ip: program.ip || device.ip,
            port: program.port || device.port,
            forceVersion: device.forceVersion
        };
    } catch (error) {
        return fail(error.message);
    }
}

if (!captureFile) {
    program.outputHelp();
    process.exit(1);
}

const target = resolveTarget();
let capture;
try {
    capture = fs.readFileSync(captureFile);
} catch (error) {
    fail(`Unable to read the capture ${captureFile}: ${error.message}`);
}

let result;
try {
    result = findLanGroups(capture, target);
} catch (error) {
    fail(error.message);
}

if (program.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.groups.length ? 0 : 2);
}

if (!result.groups.length) {
    const {stats} = result;
    console.log(`No Tuya 3.3 group commands for ${target.name} were found in the capture.`);
    console.log(`Packets: ${stats.packets}, to the light: ${stats.devicePackets}, valid Tuya frames: ${stats.validFrames}, decrypted commands: ${stats.decryptedCommands}.`);
    if (!stats.devicePackets) console.log('No traffic to the light was captured. Check the IP and capture on the router/access point or a mirrored port.');
    else if (!stats.decryptedCommands) console.log('Nothing could be decrypted. Check that the local key is current.');
    else console.log('Commands were found but none addressed a group. Change the group (not the single light) in Tuya Smart with phone Bluetooth off.');
    process.exit(2);
}

console.log(`Found ${result.groups.length} group address combination(s) for ${target.name}:\n`);
for (const group of result.groups) {
    console.log(`  cid ${group.cid}, mbid ${group.mbid}  (light ${group.address}, ${group.commands} command${group.commands === 1 ? '' : 's'})`);
}
console.log('\nAdd this to the light\'s existing device entry in the TuyaLan platform, then restart Homebridge:\n');
console.log(JSON.stringify(lanGroupSnippet(result.groups[0]), null, 2).split('\n').slice(1, -1).join('\n'));
if (result.groups.length > 1) console.log('\nSeveral groups were seen; replace cid and mbid with the group you want this accessory to control.');
