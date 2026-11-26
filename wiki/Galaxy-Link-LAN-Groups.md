# Galaxy Link LAN groups

This optional transport setting controls an existing Galaxy Link group through
its Wi-Fi member. Group control has been verified on a four-light ALUSSO
RGB+CCT set using Tuya LAN protocol 3.3. Existing light handlers and data-point
mappings are reused; individual Bluetooth fitting control is not implemented.

## Reuse of the existing light controls

Group support is a transport option on the existing light accessory. It does
not define separate power, dimming, colour or white-temperature commands.
`RGBTWLightAccessory` keeps its existing DP mapping, value conversions and
HomeKit handlers. The shared transport takes those same DP values and adds the
group address envelope when `lanGroup` is configured.

For example, the normal white-brightness handler can produce `{"3": 750}`.
The group transport sends that unchanged DP object as:

```json
{
  "cid": "0058",
  "ctype": 2,
  "dps": {"3": 750},
  "mbid": "c020"
}
```

The capture requires Tuya command 13 for this envelope, in place of command 7
used for ordinary Tuya 3.3 device writes. Encryption and packet framing remain
the existing transport implementation. Tests exercise the registered RGB light
handlers for power, white/colour brightness, temperature, hue/saturation and a
custom brightness DP, and verify their DP values are unchanged by group routing.

Startup state handling, report filtering, repeated group writes and disabling
member-only cloud fallback support the shared transport. No separate group
commands are needed for brightness, colour or white-temperature changes.

## Find group addresses with `tuya-lan-group-find`

The plugin ships a command-line finder that reads a packet capture and reports
the `cid` and `mbid` the Tuya Smart app used to address the group. Run it on the
Homebridge server (or any machine with Node.js and the capture file).

1. Add the Wi-Fi light to the TuyaLan platform as a normal light and save the
   config, so the finder can use its local key and IP.
2. Record a short capture while switching the existing group on and off in
   Tuya Smart. Disable phone Bluetooth so the command uses Wi-Fi. If another
   local controller (including Homebridge) holds the light's connection, stop
   it for the capture.
3. Run the finder with the light's id or name:

   ```bash
   npx -p homebridge-tuya-plus tuya-lan-group-find --device "Living Room Downlights" tuya-group.pcap
   ```

   On a hb-service or Docker install the plugin is already installed, so run
   it from the Homebridge storage directory to use that copy instead of
   downloading one (prefix with `sudo` if `config.json` is not readable):

   ```bash
   cd /var/lib/homebridge && npx tuya-lan-group-find --device "Living Room Downlights" tuya-group.pcap
   ```

4. Review the reported light address, `cid` and `mbid`. If several
   combinations are listed, pick the group you intended to control.
5. Add the printed `lanGroup` block to the light's existing device entry (see
   [Configuration](#configuration)), save, and restart the Tuya Plus child
   bridge.

Without `--device`, the finder lists the TuyaLan lights in the config. Options:

| Option | Meaning |
| --- | --- |
| `--device <id or name>` | Saved light whose local key, IP and port are used. |
| `--config <path>` | Homebridge `config.json`. Defaults to `~/.homebridge/config.json`, `/var/lib/homebridge/config.json` or `/homebridge/config.json`, whichever exists. |
| `--key <key>` | Use this local key instead of reading the config (it ends up in your shell history; prefer `--device`). |
| `--ip <address>` | Only search traffic to this IPv4 address. Overrides the config. |
| `--port <port>` | Tuya TCP port, default `6668`. |
| `--json` | Print the full result, including packet statistics, as JSON. |

It exits with `0` when a group was found, `2` when the capture contained no
group command (with a hint about what was missing) and `1` on errors.

A capture must see the phone-to-light TCP connection. Record it on the relevant
access point/router or a mirrored switch port; an ordinary capture on the
Homebridge host may not see traffic between two other devices. For example,
on a capture-capable access point/router, replace the example address with the
Wi-Fi light's address:

```sh
tcpdump -i any -s 0 -w tuya-group.pcap 'host 192.0.2.50 and tcp port 6668'
```

The finder accepts `.pcap` and `.pcapng` captures up to 16 MiB and searches
verified Tuya 3.3 command 13 envelopes with `ctype: 2`, `cid`, `mbid` and DPs.
It supports IPv4 TCP reassembly, Ethernet/VLAN, raw IP and Linux cooked
captures. Results are based on valid frame checksums and decryption with the
light's local key. It never prints the local key, decrypted DPs or raw packets.

This is a capture-assisted finder, not a device group-list query or an automatic
traffic recorder. It sends no commands to lights, works offline and never
changes your configuration. If no compatible group command is present, it
reports no group rather than guessing an address.

## Configuration

Add the following fields to the **existing Wi-Fi member's device entry**:

```json
{
  "forceVersion": "3.3",
  "lanGroup": {
    "cid": "0058",
    "mbid": "c020"
  }
}
```

Keep its existing `id`, `key`, IP and accessory type. Do not add another device
entry with that same ID. Keeping the ID preserves the existing accessory UUID.
The addresses above are from this owner's group; they are not universal defaults.
Deleting/recreating a Tuya group may change them.

If no downlight entry exists yet, this is a minimum on/off example. Replace the
device ID, key and IP with the Wi-Fi member's details:

```json
{
  "type": "SimpleLight",
  "name": "Living Room Downlights",
  "id": "YOUR_WIFI_MEMBER_DEVICE_ID",
  "key": "REPLACE_WITH_DOWNLIGHT_1_LOCAL_KEY",
  "ip": "192.168.1.50",
  "forceVersion": "3.3",
  "dpPower": 1,
  "lanGroup": {
    "cid": "0058",
    "mbid": "c020"
  }
}
```

Put that object inside the existing TuyaLan platform's `devices` array. Do not
replace the entire Homebridge config with it. Back up Homebridge through its UI
before installing or editing configuration. Restart only the Tuya Plus child
bridge after applying the patch and configuration.

The `SimpleLight` example exposes switching only. For an existing `RGBTWLight`
entry, retain that type and its DP mappings and add only the group settings.
Its existing brightness, colour and white-temperature controls then use the
same group transport; no separate group light class is required.

## Scope and status

- Group control has been verified on four ALUSSO fittings. Other numeric DPs
  use the same group envelope and existing light handlers. A complete hardware
  matrix for every brightness, colour and temperature setting is not recorded.
- Writes use command 13 with exactly `cid`, `ctype: 2`, `dps` and `mbid`.
- Only Tuya 3.3 is supported for `lanGroup`. Other devices retain their existing
  protocol behavior.
- Group reports must match all three addressing fields. Unaddressed member
  reports cannot overwrite group state after the initial startup query.
- The first normal device-query response seeds characteristic setup. That
  initial reading is the Wi-Fi member's state, not an independent confirmation
  that all four fittings share that state. Group reports update it afterwards.
- Repeated commands are sent even when they match cached group state, so an ON
  request can still bring back a member that was individually switched off.
- Cloud fallback is disabled for this group only. Sending a cloud command to
  the Wi-Fi member ID would not reproduce the LAN group operation.
- This creates one HomeKit light controlling the group. Individual Bluetooth
  fitting control is not implemented.
- An acknowledgement or a group report is not independent feedback from every
  Bluetooth fitting. Check the physical lights during the first test.
- The patch does not change IDs, cached accessories, pairings or other devices'
  configuration. It does not embed any local key.

## First HomeKit test

1. Close competing apps or local controllers connected to the Wi-Fi fitting
   before the test so their connections are released.
2. Leave the local network powered and connected. Disconnect the router's WAN
   and keep the iPhone's mobile data and Bluetooth off.
3. Turn the HomeKit group accessory OFF, wait a few seconds, then ON. Verify all
   four fittings each time.
4. If it fails, restore internet access and capture the Tuya Plus child-bridge
   log around that operation. Redact keys if sharing config.

## Reverting

Stop the Tuya Plus child bridge, remove `lanGroup` from the existing device
entry, and restart that child bridge to return to ordinary Wi-Fi-member
control. Preserve the device ID and HomeKit pairing throughout.
