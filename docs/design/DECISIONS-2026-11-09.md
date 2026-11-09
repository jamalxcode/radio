# radio.sala.company — Redesign decision record
Date: 2026-11-09  
Status: **Design documented, not implemented**  
Original code: `main` at `54979958ec71aa0701abc8c5092c241ce1097abe`  
Rollback: `backup/pre-redesign-2026-11-09`  
Documentation-only branch: `docs/radio-redesign-decisions-2026-11-09`

## Context and conversation summary
The owner requested a more intuitive, mobile-first interface while retaining the large worldwide radio catalogue, stream health checks (notably the silver treatment for verified working stations), and the sleep timer. Five visual directions were explored. The owner preferred the first multi-pane concept and then iteratively requested the refinements below. These are decisions captured from the design conversation, not deployed features.

## Agreed overall layout
- **Sliding multipane, adaptive:** central real radio/player is primary, with slide-in/out side panels. On desktop/unfolded screens the navigation and station browser can coexist with the player; on narrow folded cover screens the station browser overlays/slides in.
- **Finder-style column browser:** hierarchical drill-down through collections/countries/genres/stations. Preserve column context, navigation history, search and the original broad selection of stations. Selecting browse categories does not interrupt audio.
- **Station picker icon:** radio antenna / radio tower symbol, specifically **not** the three-line hamburger. Tapping opens or closes the station browser. Settings remain distinct.
- **Central player:** primary **Play/Pause** control at the **top**; eliminate Previous/Next buttons because their implied ordering is ambiguous. **Remove decorative sliding tuning dial** and **remove oscilloscope** altogether. No fake or decorative playback visualization.
- **Connection health:** elevate a clear actual playback/network state (connecting, playing, buffering/reconnecting, failed, retry), with text and icon; it is more important than an oscilloscope. Station tester health and current playback connection health must be distinguished.
- **Availability palette:** preserve standout **metallic silver highlights for verified working stations**. Other health states (unchecked/checking/weak/failed/blocked) must not be mistaken for verified stations. Do not rely on color alone: use accessible text, icon and contrast. Brown/amber may be used for unavailable as long as distinguishable for color-blind users. Respect original five status classes (On air, Weak, Off air, Blocked, New) where applicable.
- **Favorites:** keep a separate Favorite action (heart preferred to star for clarity). Favorites are distinct from fixed presets; should support easy revisit and a saved station collection.
- **Preset buttons:** **3 rows** of buttons, **18 total as represented in the agreed concept (3×6)**; show actual station logos as button faces when present, a readable fallback name/number when absent; single tap plays assigned station, **long press assigns/replaces** with current station. Guard against accidental long press and give confirmation.
- **Recently Played:** two **compact rows** under central radio with station logos where available, efficient use of small screens. Automatically record and revisit stations, separately from favorites or song history; preserve chronological ordering and deduplicate sensibly.
- **Sleep timer:** retain functionality and fade-out; display an **actual graphical countdown** (e.g., shrinking ring and remaining time) while active and allow quick editing/cancellation.
- **Foldable responsive:** prioritize both closed narrow front screen and unfolded widescreen for foldable phones (including owner's Duo and Samsung Fold 8 target). Narrow view gets radio + compact recent + presets + accessible stations launcher; wide view uses resizable/sliding side panes where feasible. Do not assume exact hardware pixel dimensions; test widths and hinge-safe areas.
- **Color-blind-friendly:** text/icon + color for all statuses, visible focus, adequate contrast, large touch targets and label clarity.

## Existing repo facilities to preserve
This is a plain HTML/CSS/JS GitHub Pages site. Existing implementations already include Radio Browser, curated lists, browser stream testing, local IndexedDB health results, favorites, recent/song history, a sleep timer, reconnection/fallback playback, phone car-radio controls and an iPod look. Redesign must retain those capabilities or intentionally migrate them without losing data. The silver verification treatment must be rooted in actual tests, never inferred from artwork.

## Not approved / expressly removed
- No previous / next station buttons in the redesigned central player.
- No nonfunctional sliding tuning dial.
- No oscilloscope or simulated sound waveform.
- No hamburger menu as station picker.
- Do not equate an untested station with working.
- Do not replace silver verified visual state with color-only indicators.

## Visual design references
The conversation produced a sequence of concept PNGs; the selected direction is the **first sliding multipane concept**, refined in subsequent mockups:
1. `a_polished_ui_concept_board_mockup_image_on_a_da.png` — early approved direction: central radio with sliding sections and Finder-style browser.
2. `a_highly_detailed_polished_dark_brushed_premium.png` — three-row logo preset grid and compact recent area.
3. `a_detailed_modern_radio_web_app_ui_dark_navy_blue.png` — tuning dial removed, two-row Recently Played.
4. `a_realistic_high_detail_ui_mockup_of_a_modern_sma.png` — closed foldable cover-screen treatment.
5. `a_highly_detailed_modern_dark_radio.sala.compan.png` — latest connection-centric visual (check decisions above where any rendered artifact conflicts).

These raster mockups are concept illustrations, **not accurate screenshots of the deployed site**. The accompanying PNG files are retained in a downloadable design-assets archive in the design conversation, not embedded by this documentation-only commit. This repo also includes a text-based layout diagram: `docs/design/architecture.svg`.

## Acceptance checklist (for subsequent implementation, not done here)
- [ ] Main/backup untouched until review; changes in feature branch; test before deployment.
- [ ] Radio station browser opens from antenna icon and correctly drills through columns.
- [ ] Browse operations do not cut audio; picking a station is explicit.
- [ ] Single Play/Pause at top; no previous/next, dial or oscilloscope.
- [ ] Verified-working entries visibly silver *and* labeled/iconed; failed/unknown distinguishable.
- [ ] Real-time connection health reports buffering/retry/error accurately.
- [ ] 18 logo-based presets in 3 rows on designs where space permits; long-press save/replace; proper folded-phone adaptation.
- [ ] Compact Recently Played in two rows, persistence and quick replay.
- [ ] Sleep countdown graphic is synchronized to actual timer, including fade/cancel.
- [ ] Usable with touch/keyboard/screen readers and color-vision differences.
- [ ] Mobile folded / unfolded / desktop responsive testing.
- [ ] Existing saved favorites, statuses, lists and other features unaffected.

## Safety and deployment
`main` auto-deploys to the live GitHub Pages website when pushed. Keep redesign out of `main` until reviewed. A rollback reference was created before this document: `backup/pre-redesign-2026-11-09` at `54979958ec71aa0701abc8c5092c241ce1097abe`.
