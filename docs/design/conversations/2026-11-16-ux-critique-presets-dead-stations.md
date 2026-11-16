# 2026-11-16 — UX critique, then easier presets and stations that won't play

Owner conversation with Claude Code (the same session as [2026-11-11-fold-station-picker.md](2026-11-11-fold-station-picker.md)). Decisions: [DECISIONS-2026-11-09.md](../DECISIONS-2026-11-09.md) §3b; technical notes: [IMPLEMENTATION-NOTES.md](../IMPLEMENTATION-NOTES.md) #19.

## The critique
**Owner:** "critique radio.sala.company, how can the user experience be made better?"

Claude ran the latest `main` locally in headless Chromium at phone (390 px), Fold (600 px) and desktop (1440 px) sizes with a 150-station local list (Radio Browser is unreachable from the sandbox, and the test streams couldn't play, so song titles weren't judged). Findings, most important first:
1. **The stations are hidden when the picker opens, on every size.** The four columns are about 720 px wide and the picker pane at most 560 px, so on desktop the Stations column is cut off at the right edge, and on phones the picker opens on Collections/Countries/Genres with no stations visible. Suggested: always show the Stations column in full on desktop; one column at a time on phones (or open on a station list with filter chips).
2. **The home screen favours setup over listening.** A first visit shows "Pick a station", a sleep selector, 18 empty "+ Save" tiles and an empty Recently played box. Suggested: a few popular stations to tap when there are no presets; a smaller empty preset area; hide Recently played until it has entries.
3. **Saving a preset is hidden behind a long-press.** Tapping an empty tile only showed a toast saying to long-press. Suggested: tap an empty tile to save; a visible save button by the station name; keep long-press for replacing.
4. **A dead station is a dead end.** "Couldn't play this station: Browser couldn't play it…" plus Retry, which rarely helps. Suggested: skip to the next station by default with a way to stay, × in the picker, plain wording.
- Smaller points: the picker's footer legend looks like buttons and "Check visible" is jargon; the sleep selector holds the prime spot; the desktop header repeats the brand; genres are lowercase; raw list names (e.g. a file name) show as-is; the play button looks active before a station is chosen; worldwide search should be easier to reach.
- Suggested order: 1, then 3, then 2.

## What the owner chose
**Owner:** "do 3 4"

### 3. Easier presets
- **☆ Save to presets** under the playing station's name saves it to the first empty slot (the slot flashes); it then reads **★ Preset N**. Tapping it again points to that preset; with all 18 full it says to long-press one to replace it.
- Tapping an empty slot while a station is on saves it there; with nothing on, a toast says to play a station first.
- Long-press / Shift+Enter still replaces a saved preset. Hint: "Tap an empty slot to save · long-press to replace".

### 4. Stations that won't play
- Skipping to the next working station is now on by default (settings saved earlier were switched on once; Settings can turn it off).
- The reason is in plain words, e.g. "This station is off air, or uses a format this browser can't play. Trying the next station…"; the title is "Can't play this station" (not "Connection lost").
- For 3 seconds the button reads **Stay** (stay on this station, then **Retry**); after the skip a toast names the station skipped.
- After 5 stations in a row fail, skipping stops with a hint to check the connection.

Tested in Chromium on a phone-sized screen with 12 unplayable local stations: every step above behaved as described, with no page errors. Pushed to the `claude/beautiful-pascal-6ha09c` branch; merging to `main` (which deploys live) was left for the owner to approve.
