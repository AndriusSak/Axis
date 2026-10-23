# Privacy — Axis (this fork)

_Last updated: 23 October 2026._

**Short version: nothing you do in these builds is sent to this fork's maintainer.** There is no
account, no analytics service, no telemetry collector and no server operated by this fork. Your
presets, your device traffic and your settings stay on your machine.

## 1. What this covers

- the desktop builds attached to **https://github.com/AndriusSak/Axis/releases**;
- the browser build served from your own machine or network (`VITE_AXIS_REMOTE=1 npm run build`).

It does **not** cover upstream's hosted deployment at **axisapp.live** — that is upstream's service
and upstream's
[privacy policy](https://axisapp.live/privacy) applies there — nor **GitHub**, which processes the
download itself under the
[GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-privacy-statement).

## 2. What stays on your device

- **Preset library** — IndexedDB in the browser build, local storage in the desktop app. Preset and
  cab files you import or export never leave the machine.
- **Device traffic** — Web Serial (FM3 over USB) or Web MIDI goes straight from your browser/app to
  your unit. No proxy, no relay, no logging service.
- **Preferences** — UI settings, the diagnostics consent flag, and an anonymous instance ID (a random
  UUID generated locally). All in `localStorage`.
- **Logs** — local debug logs, written where the app runs.

Deleting this data is entirely under your control: clear the site's storage (browser) or delete the
app's data folder / the app itself (desktop). Uninstalling removes the app; it does not touch your
presets, which are yours to keep.

## 3. Diagnostics and debug reports: present in the code, not active in these builds

The app inherits two optional reporting paths from upstream:

- **live diagnostics** (Grafana Faro RUM), which would need `AXIS_TELEMETRY=1` and an
  `AXIS_FARO_URL` in the bundled ForgeFX server's `.env`;
- **"Send debug report"** uploads to a Supabase Storage bucket, which would need `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`.

**These builds ship neither.** No `.env` with those values is packaged, so the app itself reports
"Live diagnostics aren't enabled in this build" and "Report upload isn't configured in this build",
and nothing is transmitted. There is no consent prompt because there is nothing to consent to.

If you compile your own collector into a build and point it at a server, you become the controller of
whatever it sends — that is your processing, not this fork's.

## 4. No accounts, no cloud sync

Account creation, cloud preset sync and remote control all require Supabase credentials. None are
shipped, so the browser build runs in **Direct mode** and the desktop app keeps presets locally. There
is no sign-up to complete and no password to give anyone.

## 5. Browser storage and permissions

The browser build uses `localStorage` (preferences, consent flag, instance ID), IndexedDB (preset
library) and a service-worker cache (app assets). It sets **no tracking or advertising cookies**, and
because these are functional-only, no cookie banner is needed. There are **no third-party embeds** —
no fonts, analytics or CDNs fetched at runtime.

Web Serial / Web MIDI access is granted by your browser per origin and can be revoked in the browser's
site settings at any time. The app cannot touch a device you have not granted access to.

## 6. If you clone, build or self-host

Building requires `npm install`, which fetches packages from the npm registry (npm's own logs apply).
Self-hosting the browser build serves it to whoever you expose it to — that is your deployment, your
logs, your responsibility.

## 7. Your rights

Because this fork holds **no personal data about you**, there is nothing to access, rectify, port or
erase on this side. For anything you want deleted, delete it locally (§2) — it exists nowhere else.
Privacy questions about these builds: open an issue at
**https://github.com/AndriusSak/Axis/issues**. For upstream's hosted service, use upstream's channel.

## 8. Children

Axis is not directed at children under 16 and collects nothing from anyone, of any age.

## 9. Changes

The current version of this policy is the file in this repository on the `main` branch; the date at
the top moves when it changes. If a future version adds any data collection, it will say so here
before it ships, and it will be opt-in.

---

_Not legal advice._
