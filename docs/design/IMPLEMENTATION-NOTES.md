# Adaptive radio — Current implementation and release notes
**Updated:** 2026-11-09  
**Production source:** `main` / GitHub Pages for https://radio.sala.company  
**Latest functional implementation:** PR #9, merge `b5626722608b3933fd982c221181413b7235a078`  
**Historical pre-redesign baseline:** `54979958ec71aa0701abc8c5092c241ce1097abe`  
**Permanent rollback branch:** `backup/pre-redesign-2026-11-09`  
**Decision log:** [DECISIONS-2026-11-09.md](DECISIONS-2026-11-09.md)

## Architecture
- `index.html` loads `modern.css` and `js/modern.js` after the existing site/player dependencies. The original radio engine and UI are preserved.
- `js/modern.js` creates the modern application shell and calls the existing `Radio`, `S`, `Car`, `Sleep`, `NowPlaying`, history, health/test and playback facilities. A `?classic=1` URL skips the new interface.
- `modern.css` owns the modern layout, 3×6 preset grid, silver health styling, four-column Finder browser, foldable/phone drawer rules, and simplified sleep selector.
- The underlying `js/player.js`, `js/nowplaying.js`, `js/car.js`, `js/health.js`, storage and stream sources were not rewritten as part of these UI refinements.
- The `sw.js` offline shell precaches modern assets; `index.html` advances asset-query versions for browser cache invalidation.
- `.github/workflows/pages.yml` builds/deploys on pushes to `main`; merges trigger the workflow, but completion should be checked in GitHub Actions.

## Current controls and behavior
| Area | Shipped behavior |
| --- | --- |
| Player | Large play/pause and actual connection state; no decorative oscilloscope/tuner or Next/Previous buttons in modern UI |
| Open picker | Antenna **Stations** button |
| General menu | Distinct top-left hamburger; opens Home/Favorites/Recent/Settings/Classic |
| Station browser | Collections → Countries → Genres → Stations |
| Sorting | Countries by displayed name, Genres alphabetically, Stations alphabetically (natural and leading-punctuation tolerant); all after relevant filters |
| Station selection | Starts chosen station and returns to main player; large Back to Radio arrow also closes picker |
| On mobile | Overlay station browser and nav drawer use root-class CSS selectors `#modernApp.m-browser-open` and `#modernApp.m-nav-open`; compact spacing aims for 7–8 visible station entries, depending on screen |
| Working status | Verified silver check **inline** with station title, sourced from prior probe/playback; nonworking/unknown status distinct |
| Favorites | Heart; remains independent from preset slots |
| Presets | 18 positions, 3 rows of 6; long press 650 ms to assign; single tap plays; only the chosen slot highlights, even for duplicated station keys |
| Recent | Two-row compact history |
| Sleep | One duration selector with 15,30,45,60,90,120,150,180 minutes and **Sleep Off**; active choice shows running time and fading state |
| Song metadata | Existing title/artist detection updates Media Session; some stations omit metadata; no native Auto/CarPlay integration |

## Issue history and solutions
- #1: initial new shell and adaptive layout.
- #2: reduce mobile picker header/row heights for more visible stations.
- #3: remove second-line verification text, use silver inline status; sort all genres A–Z.
- #4: sort stations A–Z; automatic return to radio after station selection; visible Back to Radio button; collapse desktop picker.
- #5: **Critical responsive CSS fix:** previously wrong descendant selectors prevented the mobile picker and navigation from becoming visible. Correct root selectors.
- #6: convert ring+moon+output sleep control to single selector. Replace three accidentally inserted literal `\n` sequences in `index.html` with real newlines to remove stray text near hamburger on Duo.
- #7: rename zero-value sleep option to **Sleep Off**, wired to existing `Sleep.set(0)`.
- #8: sort countries by their visible country names rather than station counts; normalize natural alphabetical order for station names.
- #9: duplicate presets may share station keys; a selection index is tracked, so only one button gets `.active`. If playback came from outside presets, first matching preset is the fallback.

Relevant PR links are recorded in [the design decision log](DECISIONS-2026-11-09.md).

## Testing evidence vs outstanding verification
**Static/code-level checks completed during the corresponding PRs:**
- Modern JavaScript was syntax-validated; key CSS class selectors, updated HTML script/style links, and desired marker/sort/preset logic were inspected.
- Isolated sorting and duplicate-preset examples were checked in JavaScript, but are not a substitute for a full browser test.
- Main and backup branch integrity were checked after changes.

**Not independently verified:**
- GitHub Pages successful completion for each workflow run and live CDN/service-worker propagation.
- Real iPhone Duo closed/unfolded performance, Android foldable and desktop visual/touch smoke tests.
- Long-press and focus interactions on iOS/Safari; accessibility reader/keyboard navigation.
- Actual playback and reconnection on a broad set of stations, worldwide queries, metadata delivery, fading at timer expiry, cross-session persistence, and offline cache updates.
- Exact 7–8 row capacity at every viewport size.

These were merged with owner authorization to publish and iterate, so they are **production-source commits**, not a claim of tested releases.

## Current files / build rules
- Pure HTML/CSS/JavaScript. Preserve no-framework architecture.
- Modern assets are `js/modern.js` and `modern.css`, linked from `index.html`.
- Current versions after PR #9: `modern.js?v=7` and `modern.css?v=6`; increment as needed for future deploys.
- Existing service worker is registered by `index.html`. Revalidate cache update paths when introducing new dependencies.
- Do not replace the classic engine or erase radio stations, saved favorites, station tests, imported lists, history or user data when doing UI work.

## Rollback and operational guidance
- Before making a new functional change, branch from the then-current `main`, validate, open a PR and merge after review/authorization.
- The backup ref `backup/pre-redesign-2026-11-09` is **immutable by convention**; its SHA is `54979958ec71aa0701abc8c5092c241ce1097abe`.
- Prefer targeted PR reverts over a full pre-redesign rollback to preserve unrelated work.
- To confirm rollout: inspect https://github.com/jamalxcode/radio/actions for the relevant `main` push, then inspect the live URL on the target device and reload/clear stale service worker cache if necessary.
- After any new decision or fix, update the design log and this technical record so they remain synchronized with the actual release.
