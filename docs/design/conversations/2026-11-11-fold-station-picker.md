# 2026-11-11 — Station picker on the Samsung Galaxy Fold

Record of the owner's conversation with Claude Code that produced commits `304c860` (fix) and `130e7db` (docs). Decisions are in [DECISIONS-2026-11-09.md](../DECISIONS-2026-11-09.md) §3a and §4; technical details in [IMPLEMENTATION-NOTES.md](../IMPLEMENTATION-NOTES.md) #18.

## Report
The owner sent a screenshot of radio.sala.company on a Samsung Galaxy Fold (inner screen, portrait, picker open) and wrote: *"I cannot scroll to the right and see the check mark or even the full name of the station, fix it."* The screenshot showed the columns stuck slightly past Collections, with the Stations column cut off after a few letters ("La 100", "La Popu…", "Metro 9…") and its ✓ / × marks off screen.

## Investigation
- Reproduced in headless Chromium at ~476 px wide (the Fold's CSS width, estimated from the screenshot): a sideways scroll over the columns didn't move the `.m-columns` row at all.
- A minimal test page showed the cause: an inner scroller with `overscroll-behavior: contain` swallows sideways scrolling even though it only scrolls up/down (outer row: 0 px), while `overscroll-behavior: auto contain` lets it through (140 px). Every `.m-column` had `contain`, so any swipe that started on a column's list never reached the row.
- Second cause, visible in the screenshot's ~57 px position: choosing a country starts a smooth slide (`scrollColumns`), but the picker redraws while stations load or checks finish, and `drawBrowser()` restored the mid-slide `scrollLeft`, stopping the slide part way.
- Pitfall: synthesized touch gestures (`Input.synthesizeScrollGesture`, `Input.dispatchTouchEvent`) didn't scroll anything in headless Chromium, even a plain page; `page.mouse.wheel(dx, 0)` follows the same scroll-chaining rules and was used instead. Radio Browser was unreachable from the sandbox, so a local 120-station M3U was loaded with `?m3u=`.

## Fix (`304c860`)
1. `.m-column { overscroll-behavior: auto contain }`: up/down overscroll still contained, sideways swipes reach the row.
2. `scrollColumns()` stores its target in `holder._goal` for 1.5 s; `drawBrowser()` re-applies it after a redraw instead of the mid-slide position.
3. On screens ≤ 1049 px the Stations column fills what Genres leaves: `clamp(228px, 100cqw − genres column, 380px)` with `container-type: inline-size` on `.m-columns`, so after choosing a country Genres + full names + status marks fill the screen.
4. Asset versions `modern.css?v=32`, `js/modern.js?v=33`, cache `radio-shell-v14`.

Tested at 390, 476 and 700 px: sideways wheel over a column reaches the end of the row (before: 0 px); after a country tap the Stations column is fully on screen with no truncated names.

## Follow-ups in the conversation
- Owner: "merge it to main". Fast-forwarded `main` to `304c860`; Deploy site run #76 succeeded in ~30 s.
- Owner asked for a 10-line summary of problem and fix (the two causes and three changes above).
- Owner: **"it works now on the fold"** — first real-device confirmation recorded in the design docs.
- Owner asked to update all documentation: README (picker behaviour on phones/folds), CLAUDE.md (the `overscroll-behavior` rule and the testing pitfall), design decisions and implementation notes (`130e7db`).
- Owner asked to put the latest code, design decisions and this conversation on GitHub: this file.
