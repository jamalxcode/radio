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
- #11 (debug pass, no visual change): the classic first-visit help no longer opens over the modern UI; the classic keyboard handler no longer acts underneath it (arrows/Enter/Home/End/PageUp/PageDown stopped silently changing station or playing a hidden row, and page scrolling works); Escape closes the drawer, then the picker (overlay mode); while an overlay is open on narrow screens the screen behind it is `inert`; search also matches country names and genres; the play button shows Pause while tuning/buffering (a press pauses then); the sleep countdown rounds up (15 min shows 15:00, not 14:00) and the selector follows a timer started from classic/iPod; the picker only redraws on real engine changes (previously every 5 s while idle); toasts use modern wording and styling and sit above overlays.
- #13 (no visual change): the station picker now runs the same quiet automatic checks as the classic guide (Settings → auto-test) for the station rows actually on screen, after each draw and while scrolling (vertical or across the columns). Previously the classic trigger watched the hidden classic list, so modern-picker stations stayed "?" unless "Check visible" was pressed. Already-checked and queued stations are skipped, so redraws don't re-test. Browser-tested: 15 on-screen rows of a 150-station list checked within 4 s, nothing off screen, no repeat on reopen.
- #14 (no visual change): `body.modern-ui` is now set by a tiny inline script right after `<body>` instead of by `modern.js` at the end, so the classic transistor radio (and, on a first visit, its help dialog) no longer flashes while the scripts load (owner saw it on iPhone Duo Safari on refresh). The classic markup stays in the page, hidden, because the player, settings dialogs and `?classic=1` use it; the hidden classic list no longer runs its own auto-tests in modern mode.
- #15 (owner request): in the Countries and Genres columns, entries with only 1–2 stations are merged, A–Z, with the next small entries until the group holds at least 6 stations (a short leftover at the end joins the previous group); bigger entries are unchanged. A merged row filters to all its members (keys joined with `|`). Its names stay on one line: each name is shortened a step at a time (down to 3 letters); countries then switch to their unique 2-letter codes (AL·AD·AO) rather than ambiguous stubs, and genres end with … if still too long. Full names are in the tooltip and aria-label. Tested: 34 countries → 14 rows, no taller rows, a merged row selects exactly its stations.

Relevant PR links are recorded in [the design decision log](DECISIONS-2026-11-09.md).

## Testing evidence vs outstanding verification
**Static/code-level checks completed during the corresponding PRs:**
- Modern JavaScript was syntax-validated; key CSS class selectors, updated HTML script/style links, and desired marker/sort/preset logic were inspected.
- Isolated sorting and duplicate-preset examples were checked in JavaScript, but are not a substitute for a full browser test.
- Main and backup branch integrity were checked after changes.

**Browser-tested for #11 (headless Chromium via Playwright, phone 390×844, fold 1100×800, desktop 1440×900, network to outside services blocked):** first visit, picker columns and A–Z order, search (incl. "united kingdom"), Escape on picker and drawer, arrow keys on the main screen, play/pause glyph while tuning, favorite toast, preset long-press save and single highlight, nav Favorites view, idle redraw count (0 in 11 s), inert background, sleep label/selector, Sleep Off; no console errors. Before/after screenshots matched apart from the toast.

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
- Current versions after PR #15: `modern.js?v=11`, `js/health.js?v=28`, `modern.css?v=8`, `js/app.js?v=28`, service-worker cache `radio-shell-v10`; increment as needed for future deploys.
- Existing service worker is registered by `index.html`. Revalidate cache update paths when introducing new dependencies.
- Do not replace the classic engine or erase radio stations, saved favorites, station tests, imported lists, history or user data when doing UI work.

## Rollback and operational guidance
- Before making a new functional change, branch from the then-current `main`, validate, open a PR and merge after review/authorization.
- The backup ref `backup/pre-redesign-2026-11-09` is **immutable by convention**; its SHA is `54979958ec71aa0701abc8c5092c241ce1097abe`.
- Prefer targeted PR reverts over a full pre-redesign rollback to preserve unrelated work.
- To confirm rollout: inspect https://github.com/jamalxcode/radio/actions for the relevant `main` push, then inspect the live URL on the target device and reload/clear stale service worker cache if necessary.
- After any new decision or fix, update the design log and this technical record so they remain synchronized with the actual release.
