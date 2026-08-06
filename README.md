# Dr. Bucky Greenlove's Funding Search Toolkit

A funding discovery and proposal development workbench for faculty, staff, and students at
Virginia State University — and anyone else who finds it useful.

**Live:** https://bucky-greenlove-funding-toolkit.netlify.app

Built by Dr. James Curtis Fraser (Dr. Bucky Greenlove), Virginia State University.

## What's here

| Page | What it does |
|---|---|
| `index.html` | Live Grants.gov search + a curated, link-checked directory of 208 recurring programs from 110 funders |
| `calendar.html` | Deadline calendar with urgency flags and a subscribable `.ics` feed |
| `funders.html` | Funder profiles, plus the registrations that must be done weeks ahead |
| `awards.html` | What actually got funded — live from NIH RePORTER and NSF Award Search |
| `budget.html` | Budget calculator with VSU's rates, MTDC exclusions, and the summer-salary caps |
| `proposal.html` | Timeline generator and the real review criteria for NIH, NSF, IES, NIFA, DOE, DOD, and federal NOFOs |
| `boilerplate.html` | Reusable proposal language — facilities, institutional description, DMP, letters of commitment |
| `panel.html` | 21 prompts for simulated review panels, plus an adaptive rating card |
| `playbook.html` | How to search well, read a NOFO, and handle limited submissions |
| `vsu.html` | Every VSU office, the identifiers sheet, and the working-backwards timeline |

## Architecture

Static HTML, CSS, and vanilla JS — no build step, no framework, no dependencies.
Three Netlify Functions proxy the live APIs:

- `netlify/functions/grants-search.mjs` — Grants.gov Search2 (no key required)
- `netlify/functions/awards.mjs` — NIH RePORTER + NSF Award Search, normalized to one shape
- `netlify/functions/calendar.mjs` — generates the live `.ics` deadline feed

Data lives in `data/programs.json` (208 programs) and `data/panels.json` (21 prompts).

## Working on it

```bash
# serve locally
python3 -m http.server 8899
# → http://localhost:8899
# (the serverless functions won't run locally; the live search falls back gracefully)
```

**After changing CSS or JS**, always run:

```bash
python3 scripts/version-assets.py
```

This stamps a content hash onto the asset URLs. Skip it and browsers keep serving the old
stylesheet — the assets are cached for a year on purpose, and the hash is what busts it.

**Before deploying**, always run:

```bash
python3 scripts/build-source-bundle.py
```

This regenerates `_source/bundle.json`, a complete copy of the source published alongside the
site. The monthly maintenance job restores from it, so if it goes stale, automated upkeep
breaks.

## Deploying

Deployment goes through the Netlify MCP `deploy-site` operation, which returns a short-lived
command. Site ID: `8a7c2094-9089-4187-8f30-e00b1888c474`.

If that call returns a 502, wait 60–120 seconds and retry — the endpoint is intermittently
flaky. If the returned command 401s, request a fresh one; the token expires quickly.

## Maintenance

A scheduled task runs on the 1st of each month at 7:00 ET. It restores from the bundle,
re-checks all 208 links, re-verifies deadlines falling within 90 days, applies only changes it
verified against the funder's own page, rebuilds, deploys, and reports.

## Two standing caveats

1. **The F&A rate.** VSU's published rate agreement (44% on-campus / 20% off-campus MTDC)
   shows an effective period ending 06/30/2025. The budget calculator warns about this. Get the
   current signed agreement from OSRP.
2. **Deadlines are estimates.** Most programs publish a cycle ("first Tuesday in March"), not a
   date. The site parses those into a next likely occurrence for planning. Every entry links to
   the funder, and the funder is always right.

## Accessibility

All ten pages pass WCAG 2.1 AA for contrast, heading order, form labelling, and link safety,
verified with an automated audit against the rendered DOM.
