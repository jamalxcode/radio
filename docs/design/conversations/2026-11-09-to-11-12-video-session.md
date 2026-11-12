# 2026-11-09 to 2026-11-12 — Requests from the video.sala.company session

Requests that touched this repo during a Claude Code session that mostly worked on [video.sala.company](https://github.com/jamalxcode/video) (its full record is in that repo's `docs/conversations/`). Design decisions are in [DECISIONS-2026-11-09.md](../DECISIONS-2026-11-09.md) §3a; technical and testing notes in [IMPLEMENTATION-NOTES.md](../IMPLEMENTATION-NOTES.md).

## 2026-11-09: radio as the model for video
- **Owner (on the video repo):** look at the new layout and station picker on radio.sala.company and do the same for video.sala.company, keeping the video screen.
- **Claude:** read this repo's design record and `js/modern.js` / `modern.css` and rebuilt video's screen in the same style. No changes here.

## 2026-11-11: every device
- **Owner:** ten requirements for video.sala.company (iPhone Duo folded and unfolded and every other device; its vertical Dynamic Island, side system UI and asymmetric safe areas; side navigation on the outer display; controls clear of edges and the fold; state and playback kept through folding; dialogs and keyboards visible; touch, mouse, keyboard, accessibility; Safari, Chrome, Android, installed apps), then: apply the same to radio.sala.company.
- **Claude:** ported the device layer here (`9b19055`): safe areas on all four sides; a vertical side rail for landscape phones and narrow outer displays (now playing and presets side by side); one pane per screen on folds, nothing under the hinge, picker restored to your choice on folding back; CSS-only layouts so the audio never stops; picker state kept for the session; dialogs and toasts above the keyboard; 44 px touch targets; manifest moved to the navy theme with a maskable icon; iOS meta. Tested on eight emulated devices (CDP safe-area and hinge emulation) and through fold/rotate transitions while a local test station played.

## 2026-11-11: station picker on the Fold
- **Owner:** on a Samsung Galaxy Fold the station picker couldn't be swiped sideways to the stations, so names and ✓ marks stayed cut off.
- Fixed in this repo by another Claude session (`304c860`, docs `130e7db`); its own record is [2026-11-11-fold-station-picker.md](2026-11-11-fold-station-picker.md). Owner confirmed it on the Fold.
- **Owner:** check that video works or needs the same fix. → video had both problems; the same fix was applied there.

## 2026-11-12: records
- **Owner:** update GitHub with the latest code, design decisions and the conversation. → code was already on `main`; this file added (and video's decision and conversation records updated).
