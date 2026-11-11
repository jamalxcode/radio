# CLAUDE.md

This file guides Claude Code when working in this repository.

## Overview

radio.sala.company (live at https://radio.sala.company) is a browser internet-radio player, the radio counterpart of video.sala.company. Stations come from Radio Browser (default, live API), SomaFM, junguler's genre M3U lists on GitHub, curated public collections, mirrored lists, or the user's own M3U/PLS. It tests streams in the browser (On air / Weak / Off air / Blocked / New), reconnects dropped streams, shows now-playing song metadata, and has 18 presets, a sleep timer and a Finder-style station picker. Plain HTML/CSS/vanilla JS with no build step and no package.json; hls.js loads from jsDelivr only when an HLS station plays. It is an installable PWA (`manifest.webmanifest`, `sw.js`).

## Commands

No build, test or lint scripts exist. Serve statically to run locally:

```
python3 -m http.server 8000
```

Data scripts (Node 22, run by the deploy workflow; no dependencies):

```
node scripts/mirror-lists.mjs   # copies no-CORS lists from lists/sources.json into lists/<id>.m3u + lists/index.json
node scripts/curated.mjs        # rebuilds lists/curated.json (curated collections catalogue)
```

`?m3u=<url>` adds a list from a link. Past testing (per `docs/design/IMPLEMENTATION-NOTES.md`) was ad hoc headless Chromium/Playwright; no test tooling is checked in.

## Architecture

The scripts in `js/` are classic scripts sharing one global scope, loaded in order by `index.html`:

- `core.js`: storage (IndexedDB `indexedDB.open('m3u-radio', 1)`), helpers, app state `S`.
- `lists.js`: list sources, M3U/PLS parsing, the Add-list dialog.
- `health.js`: status badges and the stream tester (brief sampling, per-server limits, bitrate from frame headers, muted `<audio>` fallback for CORS-blocked servers; results re-checked after 6 h).
- `player.js`: playback, reconnect (up to 3 times, then backup links), pause/mute, Media Session.
- `nowplaying.js`: song titles (SomaFM API, HLS ID3, ICY metadata, Icecast `status-json.xsl`, Shoutcast `/currentsong`) and the songs-heard log.
- `share.js`: share links (data after `#`) for presets and lists.
- `base.js`: playback state, volume, sleep timer, `Presets` store, Radio Browser browsing, settings, backup, keyboard, start-up.
- `modern.js`: the screen UI (now playing, presets, recently played, picker); calls into the globals above.
- `modern.css`: all screen and dialog styles.
- `sw.js`: offline shell. Page network-first (4 s timeout), same-origin app files stale-while-revalidate, hls.js/flag polyfill cache-first; streams, Radio Browser and the relay are never cached.
- `relay/relay.js`: Cloudflare Worker `radio-relay` that passes through audio for plain-HTTP/no-CORS streams (origin-restricted to radio.sala.company and localhost, private hosts blocked, no caching). Deployed separately to Cloudflare, not by Pages. The player always tries direct first; HLS is not relayed.
- `lists/sources.json`: lists to mirror; `lists/curated.json`: committed curated catalogue (fallback when sources are down). `lists/*.m3u` and `lists/index.json` are generated and gitignored.
- `docs/design/`: decision log, implementation notes (read before larger changes), architecture diagram.

All user data (lists, presets, test results, history, songs heard, settings) stays in the browser's IndexedDB.

## Deployment

- `.github/workflows/pages.yml` ("Deploy site") runs on push to `main`, daily at 04:17 UTC, and on dispatch. It runs both data scripts (`continue-on-error`), then uploads the repo root and deploys with GitHub Pages Actions (Pages source must be GitHub Actions). Generated lists only exist in the published site, never in git. Pushing to `main` deploys live.
- Custom domain `radio.sala.company` via `CNAME`; `.nojekyll` present.

## Conventions and gotchas

- On each release bump the `?v=` query on changed assets in `index.html` (currently `modern.css?v=32`, `js/*.js?v=30`, `js/modern.js?v=33`) and `CACHE` in `sw.js` (currently `radio-shell-v14`). New app files must also be added to `SHELL` in `sw.js` and to the script list in load order.
- Keep the GoatCounter snippet at the end of `index.html` intact (endpoint `https://salacompany.goatcounter.com/count`, skipped on localhost, path prefixed with `location.host`).
- Don't erase stations, presets, test results, imported lists, history or other user data during UI work; migrations should be one-time and additive (favorites -> presets is the precedent).
- No framework, no build step; keep the global-script architecture.
- Mobile/foldables matter: the picker and nav drawer overlay on phones via `#modernApp.m-browser-open` / `#modernApp.m-nav-open`; landscape phones / short wide screens get a vertical side rail (`m-rail`); folding screens with two viewport segments get one pane per screen (`m-dual-h` / `m-dual-v`, set by `layout()` in `js/modern.js`); everything sits inside `env(safe-area-inset-*)` on all four sides; touch controls are ≥ 44 px. Check phone (~390px), landscape, fold and desktop; the implementation notes describe emulating safe areas and hinges.
- Picker columns (`.m-column`) use `overscroll-behavior: auto contain`, never plain `contain`: `contain` also stops sideways swipes from reaching the `.m-columns` row, and on phones/folds the stations column becomes unreachable (fixed 2026-11-11, confirmed on a Galaxy Fold). The slide after a tap (`scrollColumns`) sets `holder._goal` so a redraw mid-slide doesn't stop it. Headless Chromium can't scroll with synthesized touch gestures; test sideways scrolling with `page.mouse.wheel(dx, 0)`.
- Rollback branch `backup/pre-redesign-2026-11-09` is immutable by convention (per the implementation notes); update `docs/design/` notes after significant changes.
