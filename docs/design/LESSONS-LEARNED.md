# Lessons learned

Things that went wrong or were hard to find, and what to do differently. Add to this when a bug teaches something.

**Updated:** 2026-11-16

## Mobile and foldables
- **`overscroll-behavior: contain` blocks both directions.** Set on the picker's vertically scrolling columns, it also stopped sideways swipes from reaching the horizontally scrolling row, so on the Fold the Stations column (names, ✓ marks) couldn't be reached. Use `overscroll-behavior: auto contain` (only vertical). 2026-11-11.
- **A redraw during a smooth scroll stops it.** `drawBrowser()` saved and restored `scrollLeft` mid-animation, freezing the slide part way. Keep the scroll target (`holder._goal`) and re-apply it after a redraw. 2026-11-11.
- **Anything that changes size in a frequently redrawn list makes it jump.** A failed logo was hidden with `display:none`; the picker rebuilds its rows on every check result, so each rebuild recreated the broken image (name pushed right) until it failed again (name back left), several times a second. Remember failures and keep a fixed-size slot. 2026-11-16.
- **Test on the owner's device size.** The Fold's inner screen in portrait is roughly 480–600 CSS px wide: narrow enough to need the phone layout, wide enough to look like it should fit. Both Fold bugs were invisible at 390 px and at desktop width.
- **The same layout bug can sit in sibling sites.** video.sala.company shares this UI and had both picker problems; when fixing one, check the other.

## Testing
- **Headless Chromium can't scroll with synthesized touch.** `Input.synthesizeScrollGesture` and `Input.dispatchTouchEvent` scrolled nothing, even on a plain test page. `page.mouse.wheel(dx, 0)` follows the same scroll-chaining rules; use it for sideways scrolling.
- **Measure the bug before fixing it.** Recording each name's position relative to its row during checks turned "jerky" into numbers (9 ↔ 43 px across 13 redraws) and proved the fix (43 px, no movement). Measure relative to the row, not the page, or the picker's own slide-in pollutes the numbers.
- **A screenshot can catch a slide mid-way.** An early screenshot looked wrong because it was taken during the smooth scroll; wait or measure before judging.
- **The sandbox can't reach Radio Browser or the live site.** Test with a local M3U served next to the app (`?m3u=http://localhost:PORT/list.m3u`, accept the `confirm()` in Playwright). Unplayable stream URLs (e.g. `http://127.0.0.1:9/…`) are a quick way to test failure paths.
- **A minimal page isolates CSS behaviour fast.** A three-element test page proved the `overscroll-behavior` cause before touching the app.

## Process
- **The owner wants changes pushed straight to `main`.** Branches and pull requests were "branch nonsense"; every push deploys, so test first. A stop hook complained about "unpushed" commits only because the local branch had no upstream set (`git push -u` fixed it).
- **Bump asset versions and the service-worker cache on every release**, or installed apps and phones keep the old files.
- **Keep the design docs current in the same change.** Stale lines (Favorites, Classic menu, `car.js`, "latest release PR #9") lingered for days after #16 and had to be cleaned up later.
- **A critique should be checked against the real screen**, at several sizes, before suggesting changes. It found a desktop cut-off nobody had reported.
