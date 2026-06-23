# Tuya Cloud Setup

This plugin is **LAN-first** — every Tuya device is controlled locally whenever it can be. Adding your Tuya Cloud credentials turns the cloud into a **transparent fallback for every device**: each accessory tries the LAN first, and only falls back to the cloud when the device can't be reached locally. It's **opt-in** (nothing happens unless you add credentials) and **local stays the preferred path**.

It helps in two situations:

> **Devices that are never on the LAN.** Some devices, most notably some battery-powered **"sleepy"** ones, never keep the local port open and never answer LAN discovery, so the local protocol can't reach them. (Tuya's own developer docs state LAN control is unavailable in low-power mode.)

> **Devices that occasionally drop off the LAN.** If a normally-local device sometimes shows "No Response" in HomeKit, the cloud fallback quietly covers those moments.

---

## 1. Create a Tuya Cloud project

1. Sign up / log in at **[iot.tuya.com](https://iot.tuya.com/)** (the Tuya IoT Development Platform).
2. **Cloud → Development → Create Cloud Project.**
   * **Development Method:** choose **Smart Home**.
   * **Data Center:** pick the region your **Tuya Smart / Smart Life app account** is in (App → *Me → Settings → Account and Security → Region*). This matters — cross-region API calls are rejected.
3. After it's created, open the project — the **Overview** tab shows your **Access ID / Client ID** and **Access Secret / Client Secret**. You'll need both.

## 2. Authorize the required API services

There are two types of projects: `Custom` and `Smart Home`. The difference between them is:

* The `Custom` project pulls devices from the project's assets.
* The `Smart Home` project pulls devices from the user's home in the Tuya app.

If you are a personal user and are unsure which one to choose, please use the Smart Home project.

In the project, go to **Service API → Go to Authorize** and make sure these are subscribed (all free):

* Authorization Token Management
* Device Status Notification
* IoT Core
* IoT Video Live Stream (for cameras)
* Industry Project Client Service (for the `Custom` project)
* IR Control Hub Open Service (for IR devices)
* Smart Home Scene Linkage (for scenes)
* Smart Lock Open Service (for Lock devices)

> **⚠️Remember to extend the API trial period every 6 months here: [Tuya IoT Platform > Cloud > Cloud Services > IoT Core](https://iot.tuya.com/cloud/products/detail?abilityId=1442730014117204014&id=p1668587814138nv4h3n&abilityAuth=0&tab=1) (the first-time subscription only gives you 1 month).**

## 3. Link your app account (so the project can see your devices)

Still in the project: **Devices → Link App Account → Add App Account**, then in the **Tuya Smart / Smart Life** app go to **Me → ⊞ (scan icon, top-right)** and scan the QR code. Your irrigation timer should now appear under **Devices → All Devices**.

## 4. Configure the plugin

Add a **top-level `cloud` block** with your credentials:

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
      // ...
    ]
}
```

### Security note

Your **Access Secret** and app password are sensitive. Keep them only in your Homebridge `config.json`. If you ever share a config for support, redact them.

## Troubleshooting

### A device reads fine over the cloud but won't accept commands (`command or value not support`, code `2008` / `2003`)

The plugin controls devices through Tuya's current **`iot-03`** device API (`POST /v1.0/iot-03/devices/{id}/commands`), the same one tinytuya and the official Tuya Homebridge plugin use. Tuya's older `/v1.0/devices/*` endpoints answer `2003` (*function not support*) or `2008` for devices they don't fully model — using `iot-03` avoids that for the vast majority of devices.

If a write still fails with `2008`/`2003` on `iot-03`, the data-point is genuinely not cloud-controllable for that device: its Tuya product defines the DP as **report-only** (it shows up in status but can't be commanded), even though the device acts on it over the LAN. That can only be changed by the device's manufacturer in the Tuya cloud — there's no cloud workaround. Such devices still work normally over the **LAN**; only the cloud fallback can't drive them.

The undocumented `debug.logCloudHttp` switch logs the full (credential-redacted) request/response for every cloud call if you want to see exactly what was sent and how the cloud replied.
