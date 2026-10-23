# Terms of use — Axis (this fork)

_Last updated: 23 October 2026._

These terms cover the builds published at **https://github.com/AndriusSak/Axis/releases** and the
browser build served from your own machine or network. They do not cover any other deployment of
Axis. By installing or using a build, you accept them; if you do not, don't use the build.

## 1. What this is

Axis is an independent, third-party editor for Fractal Audio hardware. This repository is a **fork of
[sKuhLight/Axis](https://github.com/sKuhLight/Axis)** and is **not affiliated with, authorised,
endorsed or sponsored by Fractal Audio Systems**. Upstream maintains its own project and its own
hosted service at `axisapp.live`; those are separate from this fork and not covered here.

## 2. Licence

The code is **MIT** — see [`../LICENSE`](../LICENSE). You may use, copy, modify, merge, publish,
distribute, sublicense and sell it, provided the copyright and permission notice travel with it.
Nothing in these terms adds restrictions to that licence: where the two disagree about the code, the
licence wins.

## 3. No service, no accounts

This fork operates **no server**. There are no accounts, no sign-in, no cloud sync, no preset
sharing, no payments and no support contract. Nothing you do in a build is sent to this fork's
maintainer — see [`privacy.md`](privacy.md).

## 4. Your device, your presets, your risk

Axis reads and writes your hardware over USB/MIDI. That is inherently risky:

- **Back up your presets before using write features.** Keep your own copies; this fork cannot
  recover anything for you.
- The **FM3** is the proven path (development unit, firmware 13.0 tables). FM9 / Axe-Fx III support
  is partial, and per-block preset-body decode is FM3-only.
- **Export is FM3-proven.** FM9 / III export files decode but have never been loaded onto a unit;
  AM4, VP4, Axe-Fx II and gen-1 targets are not exportable.
- The protocol understanding is unofficial and reverse-engineered. A firmware update can break
  behaviour at any time, including in ways not yet documented.
- Keep one editor connected at a time: the serial port is exclusive.

The known-limitations list in [`../README.md`](../README.md) is part of these terms.

## 5. Builds

Releases are attached to GitHub with a matching `.sha256` per artifact — verify before installing.
Builds are **unsigned and not notarised**: macOS needs `xattr`/`codesign` after each fresh copy, the
Linux AppImage installs nothing, and there is **no updater** (updates mean downloading a new release).
Builds are provided "as is", without any support commitment.

## 6. Donations

The Ko-fi link in [`../README.md`](../README.md) is a **voluntary donation**. It buys no goods, no
service, no priority and no feature; nothing is owed in return, and it does not change these terms.

## 7. No warranty

The builds are provided **"as is", without warranty of any kind**, express or implied, including
merchantability, fitness for a particular purpose and non-infringement. No warranty is given that a
build will work with your firmware, will not corrupt a preset, or will be uninterrupted.

## 8. Liability

To the extent permitted by law, the maintainer and contributors are **not liable** for any damage,
data loss, corrupted presets, lost gigs or other harm arising from the use of or inability to use a
build. Nothing here excludes or limits liability that cannot lawfully be excluded — in particular for
intent, gross negligence, or injury to life, body or health — and nothing here affects mandatory
consumer-protection rights you have where you live. The licence's own disclaimer (§2) applies as
well.

## 9. Third-party marks

"Fractal Audio Systems", "Axe-Fx", "FM3", "FM9", "AX8" and "FX8" are trademarks of Fractal Audio
Systems. They are used here only to identify the hardware this software interoperates with. No
ownership is claimed and no endorsement is implied. Presets, firmware and factory content remain the
property of their respective owners. See [`../DISCLAIMER.md`](../DISCLAIMER.md).

## 10. Changes

The current version of these terms is the file in this repository on the `main` branch. They may be
updated as the project changes; the date at the top moves when they do. If you don't accept a
revision, stop using the build.

## 11. Governing law

This fork is a free, non-commercial distribution, so there is normally no contract to govern. Where a
governing law has to be named, it is the law of **Sweden**, without prejudice to mandatory
consumer-protection provisions of your country of residence.

## 12. Contact

Open an issue at **https://github.com/AndriusSak/Axis/issues**.

---

_Not legal advice. These terms describe how this fork is distributed, not a legal opinion; if you
need certainty for a commercial use, ask a lawyer._
