# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, etc.) working in this
repository. Human contributors may find it useful too.

## What this project is

`homebridge-tuya-plus` is a community-maintained [Homebridge](https://homebridge.io)
plugin that exposes Tuya smart-home devices to Apple HomeKit. It is
**LAN-first**: virtually every device is controlled locally over Tuya's LAN
protocol (faster, more private, works without internet). A small, strictly
opt-in **Tuya Cloud** path exists only for hardware that genuinely cannot be
reached on the LAN (e.g. battery-powered "sleepy" irrigation timers).

It is published to npm and installed by end users into their Homebridge setups,
many of whom already have devices paired with HomeKit. **Treat it as production
software with a large existing install base.**

## Tech stack & layout

- **Node.js, CommonJS** (`require`/`module.exports`). No TypeScript, no build
  step — the source that ships is the source in the repo.
- Target runtimes: Node `^20.18 || ^22.10 || ^24`, Homebridge `^1.8 || ^2.0`
  (see `engines` in `package.json`). Keep changes compatible with both
  Homebridge 1.x and 2.x.

```
index.js          Platform entry point. Registers the TuyaLan platform,
                  maps config "type" -> accessory class (CLASS_DEF), runs
                  discovery, and creates/reuses cached HomeKit accessories.
lib/
  BaseAccessory.js  Shared base class for all accessories (state helpers,
                    unit/color conversions, getCategory()).
  *Accessory.js     One class per device type (lights, fans, garage doors,
                    irrigation, AC, blinds, ...). Each extends BaseAccessory.
  TuyaAccessory.js  The LAN protocol implementation (framing, encryption,
                    discovery, reconnection) for protocol versions 3.1-3.5+.
  TuyaDiscovery.js  UDP broadcast discovery of devices on the LAN.
  TuyaCloud*.js     Opt-in Tuya Cloud client (OpenAPI + MQTT realtime).
bin/              Standalone CLI helpers (tuya-lan*, key discovery/decode).
test/             Jest unit tests; shared HAP mocks in test/support/mocks.js.
scripts/          Maintenance scripts (e.g. PR-tag cleanup).
wiki/             User-facing docs (device setup, cloud setup, mappings).
config.schema.json  Drives the Homebridge Config UI X settings form.
```

## Commands

```bash
npm ci          # install (CI uses this; lockfile is committed)
npm test        # Jest unit tests — keep these green
npm run lint    # ESLint (flat config in eslint.config.mjs)
```

CI runs `npm test` and `npm run lint` on every pull request to `main`. Run both
locally before you consider a change done.

## How an accessory works

When adding or changing a device type, follow the existing pattern:

1. Create `lib/<Name>Accessory.js` extending `BaseAccessory`.
2. Implement `static getCategory(Categories)` returning a real HAP category
   constant (don't leave the `OTHER` fallback unless truly generic).
3. Build HomeKit services/characteristics in `_registerCharacteristics(dps)`,
   which runs once the device reports its first state.
4. Read/write device data points (DPs) via the `BaseAccessory` helpers
   (`getState`/`setState`/`setMultiState` and their `*Async` variants) rather
   than poking `this.device` directly.
5. Register the type in `CLASS_DEF` in `index.js`.
6. Add the device's config options to `config.schema.json` so they appear in the
   Homebridge UI.
7. Add Jest tests using `makeInstance(...)` from `test/support/mocks.js`.

## Conventions

- **Match the surrounding code.** Mirror the existing file's naming, spacing,
  quoting (single quotes), and structure. Don't introduce a new style.
- **Write code that reads clearly without comments.** Prefer descriptive names
  and straightforward control flow over cleverness.
- **Comment the "why", not the "what".** Existing comments explain non-obvious
  protocol quirks, HomeKit/Homebridge gotchas, and decisions that protect
  backwards compatibility (often citing an issue/PR number). Add comments of
  that kind where they save the next reader real time; skip narration of obvious
  code.
- **Tests where they make sense.** Pure logic (state mapping, value
  conversions, protocol encode/decode, config coercion) should have Jest tests.
  The HAP layer is mocked — don't reach for real hardware or the network in
  tests.
- ESLint currently disables a few rules (`no-unused-vars`, `no-empty`,
  `no-prototype-builtins`) as tech debt; don't rely on or expand that. Keep new
  code clean.

## Logging

Users run this in Homebridge and read these logs; a chatty plugin is a real
complaint. The bar for a non-debug line is high.

- **`debug` is the default.** Anything routine, per-message, per-state-change,
  per-connect, or protocol-level (odd/raw/malformed frames, reconnects, socket
  recycling, DP dumps, "X changed: …") goes to `this.log.debug`. If it can fire
  more than a handful of times in normal operation, it's `debug`.
- **`info`/`warn`/`error` are for what the user must see or act on**, and the
  level must match real severity — a harmless condition (e.g. a cloud-fallback
  failure while the device is reachable over the LAN) is not a `warn`/`error`.
  Prefer one actionable line over a vague one; name the device.
- **Never spam.** A condition that recurs on a timer or hot path must be
  deduplicated (surface once, then drop repeats to `debug` until it changes) and
  its retry backed off — see `TuyaCloudDevice._onConnectFailure` and the
  discovery port-in-use guard for the pattern.
- **Use the Homebridge logger** (`this.log` / `this.log.debug|info|warn|error`),
  never `console.*`, in plugin/runtime code. (The standalone `bin/` CLIs are the
  exception: their `console.*` is intentional user-facing output.)
- **Logging must never throw and must never leak secrets** — don't dump a whole
  config/props object (it carries the device's local `key`); log the id/name.

## Backwards compatibility (read before changing behavior)

This is the most important rule in this repo. Users have working setups and
devices already paired in HomeKit; a careless change can break them silently.

- **Config is a public API.** Don't rename, repurpose, or remove existing config
  keys (platform- or device-level). Add new options as optional with safe
  defaults, and keep `config.schema.json` in sync. Be lenient in what you
  accept (see `_coerceBoolean` / `coerceBoolean`).
- **Keep cloud strictly opt-in.** LAN remains the default path. Cloud code runs
  only when a device sets `cloud: true` (or a `cloud` object) and credentials
  are present. `mqtt` is an optional dependency — don't make it mandatory.
- **Preserve protocol support.** The plugin speaks Tuya LAN 3.1-3.5 and is
  forward-compatible with newer versions; don't drop versions or break version
  routing.
- When a change must alter behavior, make it opt-in.

## Debug config block

The platform reads an **undocumented** top-level `debug` object from the config
(see `_debugConfig()` in `index.js`). It holds dev/test-only switches and is
deliberately **kept out of `config.schema.json`** so it never appears in the
Homebridge UI. Treat it as the one place such switches belong; add new ones as
optional, off-by-default flags read through `_debugConfig()` and coerced with
`coerceBoolean`.

- `debug.forceCloudFallback` — pretend LAN discovery fails for every device, so
  the whole platform runs over the Tuya Cloud fallback. Lets the cloud path be
  exercised end-to-end without taking devices off the LAN (needs a configured
  `cloud` block to be useful).
- `debug.logCloudHttp` — trace every Tuya Cloud HTTP request/response (method,
  path, headers, body, status, response) at `debug`, with all credentials
  (token, signature, password, access key/id, uid) redacted. Use it to see
  exactly what a failing `POST …/commands` sent and how the cloud replied (e.g.
  the `code`/`value` behind a `2008`). Verbose and per-request — keep it off in
  normal operation, and remember Homebridge debug logging must be on to see it.

## Git & PR workflow

- Develop on the branch you've been assigned; never push to `main` directly.
- `main` is protected and merges via squash; each commit there is auto-published
  to npm under the `dev` tag, so keep `main` releasable.
- Match the existing commit style: a concise, imperative subject (the PR number
  is appended automatically on merge, e.g. `... (#62)`).

</content>
</invoke>
