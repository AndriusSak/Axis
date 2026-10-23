# Axis — legal documents

**These four files are inherited from upstream (`sKuhLight/Axis`, merged at 0.8.2-beta) and describe
upstream's hosted service at `axisapp.live`. They are not the legal basis of this fork, and nothing in
this build reads them** — `src/lib/legal.ts` opens the published pages at `axisapp.live`, which are
upstream's, not these drafts.

They are kept here for lineage and for the checklist below. Treat every statement in them as
"upstream's service", not "this build".

| File | What | Status |
|---|---|---|
| `privacy-policy.md` | Datenschutzerklärung (GDPR Art. 13) for upstream's cloud + diagnostics | upstream draft, placeholders unfilled |
| `imprint.md` | Impressum (§5 DDG) for upstream's operator | upstream draft; the published version at `axisapp.live/imprint` carries the real address |
| `terms.md` | Terms of Service for upstream's app + Axis Cloud | upstream draft; license line corrected to MIT |

## What these documents claim vs what this fork ships

| Document claims | This build (AndriusSak/Axis) |
|---|---|
| **Axis Cloud** accounts and preset sync through Supabase | Not available. No Supabase credentials are shipped, so the web build lands in Direct mode and presets stay in IndexedDB; desktop presets stay local. The account/sync path is inoperable here. |
| **Opt-in telemetry** to Grafana Cloud and **debug-report uploads** to Supabase Storage | Dark. Both need `AXIS_TELEMETRY` / `AXIS_FARO_URL` / `SUPABASE_*` in the bundled ForgeFX `.env`; no such `.env` ships in the releases. Nothing leaves the machine. |
| **Paid supporter tier** and payment processors | Not offered. The README's support link is a Ko-fi donation, not a service tier. |
| Operator **Pascal Peinelt**, `contact@axisapp.live`, German law, §5 DDG Impressum | Correct for upstream's deployment only. This fork is not a commercial service and names no operator. |
| Licensed **"PolyForm Noncommercial"** (terms §2) | Wrong — `LICENSE` and the README are **MIT**, in this repo and upstream. Corrected in `terms.md`. |

## Fill-in checklist (upstream's, all still open)
- [ ] Operator **real name** (or entity + managing director) and a **reachable postal address** (use a c/o address service to avoid publishing a home address — the name still must be real).
- [ ] Contact **email**.
- [ ] **Confirm the Supabase project region** (privacy policy §3) — state EU explicitly if it is; otherwise adjust the transfer wording.
- [ ] The competent **Landesdatenschutzbehörde** (supervisory authority) in privacy policy §8.
- [ ] The **account/data deletion path** (privacy policy §8) — how a user deletes their account and data.
- [ ] Retention numbers for debug reports (§7, currently `[e.g. 90 days]`).
- [ ] Sign/accept the **DPAs (AVV)** with Supabase and Grafana Labs.
- [ ] Before any paid tier: rewrite the payment/withdrawal (Widerruf) sections + full lawyer review of `terms.md`.

## Publishing
Upstream publishes these at **https://axisapp.live/{privacy,imprint,terms}** (GitHub Pages / static
host). The Imprint has to be permanently, publicly available if that service takes registrations or
sends telemetry — an in-app copy alone is not enough. A static page per document is fine.

This fork publishes no such pages and takes no registrations, so it links to upstream's. If this fork
ever becomes a public service, these drafts are not sufficient — they would need rewriting for this
operator first.
