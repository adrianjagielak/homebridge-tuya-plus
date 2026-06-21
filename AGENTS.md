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

## Git & PR workflow

- Develop on the branch you've been assigned; never push to `main` directly.
- `main` is protected and merges via squash; each commit there is auto-published
  to npm under the `dev` tag, so keep `main` releasable.
- Match the existing commit style: a concise, imperative subject (the PR number
  is appended automatically on merge, e.g. `... (#62)`).

</content>
</invoke>
