# radio.sala.company — Current design decisions and discussion record
**Updated:** 2026-11-09  
**Status:** IMPLEMENTED AND MERGED TO `main` (the GitHub Pages production source). Actual rollout completion and real-device verification are separate checks.  
**Live URL:** https://radio.sala.company  
**Repository:** https://github.com/jamalxcode/radio  
**Source of truth:** `main` at the latest merged commit, plus this decision record.  
**Pre-redesign rollback:** `backup/pre-redesign-2026-11-09` at `54979958ec71aa0701abc8c5092c241ce1097abe`.  
**Original proposal branch:** `docs/radio-redesign-decisions-2026-11-09`.  
**First implementation:** `feature/adaptive-radio-redesign`, merged by PR #1.

## 1. Goals established in the design discussions
A premium, recognizable, realistically inspired *radio* interface, while retaining the underlying browser radio station catalogue, favorite lists, import functions, tests and playback technology. The agreed visual direction was the first sliding multi-pane concept, refined into navy, brushed-metal, high-contrast skeuomorphism. The central radio is primary. A narrow cover screen shows one main pane and sliding overlays; desktop/unfolded widths have room for multiple panes. No extra build system: plain HTML, CSS and JavaScript.

The agreed constraints are:
- A large top Play/Pause control. Remove the prior Next/Previous buttons, decorative tuning dial and oscilloscope from the *modern* central UI. Connection-health text must represent actual player status, not a fabricated animation.
- Open the station picker with an **antenna/radio-tower Stations button**, not a hamburger icon. The separate top-left **hamburger** opens the general navigation drawer (Home, Favorites, Recent, Settings, Classic Radio). The antenna picker and hamburger drawer are distinct.
- Finder-style browser columns: **Collections → Countries → Genres → Stations**, preserving all existing sources, lists and search operations. Category browsing does not interrupt audio.
- Verified-working streams receive metallic **silver** treatment rooted in a successful real probe or playback evidence. Untested, checking, weak, unavailable and blocked states must be distinguishable without relying exclusively on color.
- A separate Favorites heart, **18 presets in three rows of six**, actual station logos when possible, 650 ms long press to save/replace a preset and a compact two-row Recently Played area. Preserve storage and original audio engine.
- Cover-screen and unfolded/desktop responsive layout, readable labels, touch targets, focus indication and reduced-motion preferences.

## 2. Later decisions, now incorporated into current behavior
These follow-up decisions supersede older descriptions or visual mockups:
1. **More visible rows on mobile.** Compact the picker heading, search, shortcuts, tabs and station entries to fit approximately **7–8 station choices** on common phone cover-screen heights rather than five. The actual number varies with viewport dimensions.
2. **Inline silver verification.** A verified stream's metallic-silver check appears on the **same line as the station name**, not as a second line. Full explanation remains in the label/tooltip; silver border/tint and icon remain.
3. **Alphabetical Genres.** A–Z rather than ranking by number of stations; no former 160-item limit.
4. **Alphabetical Countries.** A–Z by **displayed country name**, not count. The All countries entry remains an explicit option.
5. **Alphabetical Stations.** A–Z after collection/country/genre/search filtering, using locale-aware natural sorting and ignoring leading punctuation/whitespace. Numeric names sort naturally. The station list currently displays its first 350 matches; narrow the filters to find entries beyond those.
6. **Easy return to listening.** Selecting a station starts it and **closes the station picker**, returning to the main radio. A large **← Back to Radio** button in the picker header closes without selecting. On desktop, the browser pane also collapses when dismissed.
7. **Mobile drawer repair.** The open-state CSS classes are applied to `#modernApp` itself; the mobile station picker and hamburger drawer selectors must target that root element, not descendants. Their backdrop likewise tracks those root states.
8. **Sleep timer simplified.** Keep real timer and fade logic, but **remove the crescent, shrinking ring, separate countdown output and duplicate “Off”**. Use a single prominent sleep-duration selector. While active, its selected option shows the live remaining countdown (or fading state); it includes an explicit **Sleep Off** option which calls `Sleep.set(0)`. Other options: 15, 30, 45, 60, 90, 120, 150 and 180 minutes.
9. **No stray newline text.** There were three literal `\n` character sequences in `index.html`, one visible above the hamburger on the Duo; all three were replaced with actual HTML line breaks.
10. **Single preset highlight.** Even if the same station occupies multiple preset slots, **only the exact last selected preset** should be highlighted. If the current station was chosen outside the preset grid, fall back to the first matching slot. All other buttons retain normal colors.
11. **Song title and artist.** Existing stream metadata detection and browser Media Session support are sufficient for now. No deeper/native Android Auto or Apple CarPlay work requested. Metadata depends on what stations expose, and lock-screen/browser support does **not** guarantee dashboard integration.

## 3. Current UI behavior (modern mode)
- **Central radio:** station logo/name, live connection status and an explicit play/pause control; favorites; single sleep selector; 18 saved preset slots; two-row recent stations.
- **Browser:** Collections, Countries, Genres and Stations; searchable, browsable worldwide and by discovery shortcuts. The first 350 matching stations render to limit excessive DOM work.
- **Browser entry:** tap antenna **Stations**. **Exit:** select a station, tap Back to Radio, or close the overlay. General navigation uses a separate hamburger.
- **Verified indicator:** compact inline check on station title line with silver treatment; accessibility label/tooltip expands the meaning.
- **Presets:** one selected highlight maximum. Long press (650 ms) overwrites a slot with the current station; keyboard Shift+Enter is supported as a save alternative.
- **Sleep:** one dropdown showing duration, or running countdown, with **Sleep Off** to cancel.
- **Existing player + data:** underlying engine, lists, stream tests and playback state, favorites, recent history and saved presets remain reused. Classic fallback: `?classic=1`.

## 4. Implementation and deployment log
| PR | Decision implemented |
| --- | --- |
| [#1](https://github.com/jamalxcode/radio/pull/1) | Initial adaptive modern radio, responsive shell and new assets; merged into production |
| [#2](https://github.com/jamalxcode/radio/pull/2) | Compact mobile picker to show more station choices |
| [#3](https://github.com/jamalxcode/radio/pull/3) | Inline metallic verified check and alphabetical genres |
| [#4](https://github.com/jamalxcode/radio/pull/4) | Alphabetical stations, selection closes picker, prominent back arrow |
| [#5](https://github.com/jamalxcode/radio/pull/5) | Repair mobile station picker and hamburger drawer opening |
| [#6](https://github.com/jamalxcode/radio/pull/6) | Simplified single-control sleep timer; remove literal \n leakage |
| [#7](https://github.com/jamalxcode/radio/pull/7) | Explicit Sleep Off selection |
| [#8](https://github.com/jamalxcode/radio/pull/8) | Alphabetical countries and stronger station-name sorting |
| [#9](https://github.com/jamalxcode/radio/pull/9) | Only one highlighted preset slot |
| [#11](https://github.com/jamalxcode/radio/pull/11) | Debug pass: owner asked to fix bugs while keeping the interface as it is (details in the implementation notes) |
| [#13](https://github.com/jamalxcode/radio/pull/13) | Automatic quiet station checks in the modern picker (owner noticed stations stayed "?") |
| [#14](https://github.com/jamalxcode/radio/pull/14) | No classic radio flash on load (owner request: remove the old interface showing on refresh) |

**Latest functional release before this documentation update:** merge commit `b5626722608b3933fd982c221181413b7235a078` (PR #9). Keep this commit as the baseline for investigating changes introduced after these discussions.

## 5. Known limitations and checks still needed
- Static JavaScript syntax, expected source structure and selected test logic were checked in the course of implementation. **There is no claim that the full UI has been browser/device-tested** on the actual iPhone Duo, Samsung Fold, desktop Safari or all stream types.
- GitHub Pages is configured to deploy on pushes to `main`, but merge success alone is not proof a particular deployment run completed. Check GitHub Actions and the live URL after changes.
- Browser cache / service-worker cache may delay visible changes; `modern.js` and `modern.css` query-version increments were applied as fixes shipped.
- Metadata may be unavailable from some stations because of missing ICY/HLS data or server CORS; no guarantee of Android Auto / CarPlay dashboard text without native integration, which the owner declined.
- The modern UI can return to original presentation through `?classic=1`; do not alter its data storage without an explicit migration plan.
- Possible future tests: on-device touch and long-press, one-highlight behavior for duplicate presets, search and international sorting, stream status and reconnect, background playback, sleep expiry, accessibility, actual narrow-screen row count, offline cache and persistence.
- The raster design concepts were generated in the design conversation. **They are not committed in this repo**. `docs/design/architecture.svg` is the checked-in diagram; early filenames in the older decision record referred to conversation assets, not versioned repository files.

## 6. Preservation and rollback
The preserved pre-redesign branch `backup/pre-redesign-2026-11-09` points to `54979958ec71aa0701abc8c5092c241ce1097abe` and must not be overwritten. Reverting a particular fix should usually revert its PR merge instead of resetting the entire application. Full rollback can restore the saved pre-redesign tree with an explicit reviewed GitHub commit; **never delete personal radio data or force-reset unrelated work**.

## 7. Updating this document
Treat this file as the **current design-decision record**, and `docs/design/IMPLEMENTATION-NOTES.md` as the technical release/verification record. For each subsequent owner request: record the changed decision, implementation PR/commit and relevant testing notes here or in a dated addendum. The site and code are authoritative for shipped behavior; illustrations describe intent, not proof of production appearance.
