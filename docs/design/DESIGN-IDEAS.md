# Design ideas (not built yet)

Ideas for improving the experience that the owner hasn't chosen yet. Most come from the UX critique of 2026-11-16 ([conversation record](conversations/2026-11-16-ux-critique-presets-dead-stations.md)). When one is built, move it into [DECISIONS-2026-11-09.md](DECISIONS-2026-11-09.md) and remove it here.

**Updated:** 2026-11-16

## Already built from the critique
- ~~3. Saving a preset hidden behind a long-press~~: ☆ Save to presets button and tap-an-empty-slot (2026-11-16).
- ~~4. A dead station is a dead end~~: skip by default with Stay, plain-words reasons (2026-11-16).

## High value
1. **Show the stations when the picker opens, on every size.** The four columns are about 720 px wide but the picker pane is at most 560 px, so on desktop the Stations column is cut off at the right edge, and on phones the picker opens with no stations visible.
   - Desktop: the Stations column always fully visible; the narrow columns shrink or collapse first.
   - Phones: one column at a time (Countries › Genres › Stations with a back arrow, like a phone's settings), or open straight onto a station list with country/genre chips above it.
2. **A home screen for listening, not setup.** A first visit shows a sleep selector, 18 empty preset tiles and an empty Recently played box, and nothing to play without opening the picker.
   - With no presets: a row of popular stations to tap and play.
   - A smaller empty preset area (one row and a hint) until the first one is saved.
   - Hide Recently played until it has entries.

## Smaller
3. Picker footer: the legend (✓ Verified working, × Unavailable) looks like buttons, and "Check visible" is jargon. Rename to "Test these stations", or drop it since checks already run by themselves.
4. The sleep selector takes the prime spot under the station while showing "Sleep Off". Make it a small 🌙 control that opens when tapped.
5. The desktop header repeats the brand ("radio.sala.company" beside "SALA RADIO"). Use the space for the playing station or a search box.
6. Genres are lowercase ("classical", "jazz") beside capitalised countries; capitalise them.
7. A list's raw name shows as-is (a file name like "zz"); suggest a friendly name when it's added.
8. The play button looks tappable before any station is chosen. Dim it, or make it play the last or a suggested station.
9. Make worldwide search easier to reach: most people expect to type a name and find the station anywhere, but searching inside the current filters is the default.
10. Auto-skip follows the picker's list even when the station came from a preset; skipping to the next preset may fit better there.
11. Tapping an empty slot can save a station that's already another preset (duplicates are allowed); consider pointing to the existing preset instead.

## Earlier ideas still open
- On-device checks not yet done: iPhone Duo folded/unfolded, long-press and focus on iOS Safari, screen readers, background playback, sleep expiry, offline updates (see IMPLEMENTATION-NOTES "Not independently verified").
