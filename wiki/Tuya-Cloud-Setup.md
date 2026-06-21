# Tuya Cloud Setup

This plugin is **LAN-first** — almost every Tuya device is controlled locally. But a few devices **cannot** be reached over the LAN at all:

> Battery-powered **"sleepy"** devices — most notably multi-zone **irrigation / faucet timers** — sleep almost all the time to save battery and only ever connect *outbound* to Tuya's cloud (over MQTT) for a brief moment when they wake. They never keep the local port open and never answer LAN discovery, so the local protocol can't reach them. (Tuya's own developer docs state LAN control is unavailable in low-power mode.)

For these devices the plugin can talk to the **Tuya Cloud** instead. It is **opt-in, per device** — your other devices stay 100% local.

* Initial state + control go through the Tuya OpenAPI (signed HTTPS).
* Live updates (including physical button presses) arrive over Tuya's **MQTT** message service — no polling.

---

## 1. Create a Tuya Cloud project

1. Sign up / log in at **[iot.tuya.com](https://iot.tuya.com/)** (the Tuya IoT Development Platform).
2. **Cloud → Development → Create Cloud Project.**
   * **Development Method:** choose **Smart Home**.
   * **Data Center:** pick the region your **Tuya Smart / Smart Life app account** is in (App → *Me → Settings → Account and Security → Region*). This matters — cross-region API calls are rejected.
3. After it's created, open the project — the **Overview** tab shows your **Access ID / Client ID** and **Access Secret / Client Secret**. You'll need both.

## 2. Authorize the required API services

In the project, go to **Service API → Go to Authorize** and make sure these are subscribed (all free):

* **IoT Core**
* **Authorization**
* **Smart Home Basic Service**
* **Device Status Notification** ← needed for realtime MQTT updates

> ⚠️ The free trial of *IoT Core* lasts ~6 months, after which you must click **Extend Trial Period** (Cloud → My Services). If it lapses you'll see *"No permissions. Your subscription … has expired."*

## 3. Link your app account (so the project can see your devices)

Still in the project: **Devices → Link App Account → Add App Account**, then in the **Tuya Smart / Smart Life** app go to **Me → ⊞ (scan icon, top-right)** and scan the QR code. Your irrigation timer should now appear under **Devices → All Devices**.

## 4. Find the device ID

**Devices → All Devices** → click your device → copy its **Device ID** (a string like `bfae6739…tfx`). (You can also find it in the Smart Life app: device → ✎/⚙ → *Device Information*.)

---

## 5. Configure the plugin

Add a **top-level `cloud` block** with your credentials, and set **`"cloud": true`** on the device. There are two project styles:

### Smart Home project (recommended — what most people have)

Authenticates as your app account (username/password), so it sees exactly the devices linked in step 3.

```json5
{
    "platform": "TuyaLan",
    "cloud": {
        "accessId": "your-access-id",
        "accessKey": "your-access-secret",
        "region": "eu",                         // eu / us / cn / in / sg / eu-w / us-e
        "username": "you@example.com",          // your Tuya/Smart Life app login
        "password": "your-app-password",
        "countryCode": "48",                    // your phone country code (e.g. 1, 44, 48)
        "schema": "tuyaSmart"                   // or "smartlife" if you use the Smart Life app
    },
    "devices": [
        {
            "name": "Garden Irrigation",
            "type": "IrrigationSystem",
            "id": "bfae6739xxxxxxxxxxxxxx",      // the cloud Device ID
            "cloud": true,
            "valveCount": 4
        }
    ]
}
```

### Custom project

If you created a **Custom** project (devices linked by QR to the project's asset) just omit `username`/`password`/`countryCode`/`schema`:

```json5
"cloud": {
    "accessId": "your-access-id",
    "accessKey": "your-access-secret",
    "region": "eu"
}
```

### Per-device credentials (optional)

Instead of (or in addition to) the platform block, a device can carry its own credentials — handy if different devices live in different Tuya projects:

```json5
{
    "name": "Garden Irrigation",
    "type": "IrrigationSystem",
    "id": "bfae6739xxxxxxxxxxxxxx",
    "cloud": {
        "accessId": "…",
        "accessKey": "…",
        "region": "eu",
        "username": "…",
        "password": "…",
        "countryCode": "48"
    }
}
```

> No local `key` is needed for cloud devices — the cloud authenticates with your project credentials.

---

## Data-points are addressed by "code" on the cloud

Over the LAN, data-points are numbered (1, 2, …). Over the **cloud** they're named **codes** (e.g. `switch_1`, `battery_percentage`). When a cloud device connects, the plugin **logs the exact codes** it reports, e.g.:

```
Garden Irrigation: Tuya Cloud data-point codes → switch_1=false, switch_2=false, switch_3=false, switch_4=false, countdown_1=0, …, battery_percentage=99
```

The `IrrigationSystem` defaults already match the common 4-zone layout (`switch_1`…`switch_4`, battery `battery_percentage`). If your device differs, use the logged codes:

```json5
"valves": [
    { "name": "Front Lawn", "dp": "switch_1", "defaultDuration": 900 },
    { "name": "Back Lawn",  "dp": "switch_2", "defaultDuration": 900 }
],
"dpBattery": "battery_percentage"
```

See **[Irrigation Systems / Sprinklers](https://github.com/adrianjagielak/homebridge-tuya-plus/blob/main/wiki/Supported-Device-Types.md#irrigation-systems--sprinklers)** for all options (per-zone durations, master switch, etc.).

---

## Realtime updates (MQTT)

Live updates use Tuya's MQTT message service via the **`mqtt`** package, which is an *optional dependency* installed automatically. If it's missing (or `"realtime": false`), cloud devices still work and stay controllable, but external changes (a physical button, the device's own timer) won't show up until Homebridge restarts. To force-install it:

```
sudo npm install -g mqtt
```

The realtime stream connects out to Tuya's broker on **port 8883** — make sure your firewall allows that outbound (it's open on normal home networks).

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `failed to connect to Tuya Cloud: token request failed … (code 1004)` | Wrong **Access ID/Secret**, or host clock skew — the signature includes a timestamp, so keep the machine **NTP-synced**. |
| `… (code 1106) permission deny` / `No permissions` | API service not authorized or **trial expired** (step 2), or **wrong region**, or you logged in with the developer account instead of the **app** account. |
| Device connects but shows nothing / `0` devices | **Region mismatch**, or the device isn't linked to the project (step 3), or the linked account isn't the device's **owner** (shared/guest access hides devices). |
| `realtime disabled: the optional "mqtt" package is not installed` | Install `mqtt` (above), or ignore if you don't need live external updates. |
| Realtime never connects (control works, external changes don't) | Outbound **port 8883** blocked by a firewall. |
| Logs show different codes than expected | Use the codes from the startup log line shown above. |

### Security note

Your **Access Secret** and app password are sensitive. Keep them only in your Homebridge `config.json`. If you ever share a config for support, redact them — and you can always reset the Access Secret on the Tuya IoT platform.
