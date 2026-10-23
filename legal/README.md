# Axis — legal documents (this fork)

Two documents, both true for **this fork's builds** (`AndriusSak/Axis`: desktop releases + the local
browser build). They are short on purpose — this fork runs no service, takes no accounts, sells
nothing and collects nothing, so there is very little to document.

| File | What it covers |
|---|---|
| [`terms.md`](terms.md) | Terms of use for the builds published on Releases: licence, device-write risk, unsigned builds, donations, warranty, third-party marks, governing law. |
| [`privacy.md`](privacy.md) | What happens to your data: nothing leaves your machine. No account, no analytics, no configured telemetry. |

Also relevant, at the repo root: [`LICENSE`](../LICENSE) (MIT — the actual licence),
[`DISCLAIMER.md`](../DISCLAIMER.md) (trademarks, no warranty, use at your own risk) and
[`README.md`](../README.md) (install, platform support, known limitations).

## What was removed and why

Inherited from upstream (`sKuhLight/Axis`) and rewritten here for the fork:

- **`imprint.md` → deleted.** A German Impressum (§5 DDG) is required of whoever *operates* a
  commercial digital service. This fork operates no service, takes no registrations, sends no
  telemetry and takes no payments, and its maintainer is not the German operator named in the old
  draft. Upstream's own Imprint stays live at https://axisapp.live/imprint for their deployment.
- **`privacy-policy.md` → `privacy.md`.** The old text described Axis Cloud accounts (Supabase),
  opt-in diagnostics (Grafana Faro) and debug-report uploads. Those paths exist in the code but carry
  no credentials in these builds, so they cannot transmit; the policy now says exactly that instead
  of describing a service this fork doesn't run.
- **`terms.md`.** The old licence line said "PolyForm Noncommercial" while `LICENSE` is MIT — in this
  repo and upstream. Rewritten; account, cloud-sync, payment and German-consumer clauses dropped
  because none of them apply.

If this fork ever becomes a public service (accounts, telemetry, payments), these documents are not
enough — the upstream drafts in git history (`git show 5cb6328:legal/`) are the better starting point,
and a lawyer should see them before anything goes live.
