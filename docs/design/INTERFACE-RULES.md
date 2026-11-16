# Interface rules

How the radio screen must look and behave on every device. Check a change against these before pushing. Product rules are in [BUSINESS-RULES.md](BUSINESS-RULES.md); the reasons behind them are in [DECISIONS-2026-11-09.md](DECISIONS-2026-11-09.md) and [LESSONS-LEARNED.md](LESSONS-LEARNED.md).

**Updated:** 2026-11-16

## Layout and devices
1. **Check every change at phone (~390 px), Fold inner screen (~480–600 px), landscape phone, a two-segment fold, and desktop.** The owner uses a Samsung Galaxy Fold; the Fold has been where bugs showed.
2. Everything sits inside `env(safe-area-inset-*)` on **all four sides** (notches, side islands and system bars, home indicator); the background still fills the screen.
3. No sideways scrolling of the page itself. The only horizontal scroller is the picker's row of columns.
4. Below 1050 px the picker and the menu slide over the screen (`#modernApp.m-browser-open` / `m-nav-open`, a backdrop behind, the screen behind made `inert`). Short wide screens (landscape, ≤ 560 px tall) get a vertical **side rail** (`m-rail`). Two viewport segments get **one pane per screen** with nothing under the hinge (`m-dual-h` / `m-dual-v`).
5. Folding, rotating or resizing never interrupts audio (CSS-only layout changes). The picker's collection, filters, search and scroll survive a reload in the same session.
6. Dialogs and toasts stay inside the safe area and above the on-screen keyboard (`--kb` from `visualViewport`).

## Touch and input
7. On touch screens every control is **at least 44 px**; inputs use 16 px text (stops iOS zooming).
8. No double-tap delay (`touch-action: manipulation` on buttons).
9. Important actions must be **visible taps**. Long-press is only a shortcut (replace a preset), never the only way to do something.
10. Keyboard: Space pause, M mute, N / P next/previous, Esc closes the menu then the picker; Shift+Enter replaces a preset. Media keys and lock-screen controls work.

## Station picker
11. **The Stations column must always be reachable and readable.** On narrow screens it fills the space beside Genres (228–380 px); choosing a collection, country or genre slides to the next columns, and a redraw mid-slide must not stop the slide (`holder._goal`).
12. A sideways swipe that starts **anywhere** on the columns scrolls them. Picker columns use `overscroll-behavior: auto contain`, never plain `contain`.
13. **Nothing in a row may change size between redraws.** The picker redraws on every check result, so anything that loads, fails or toggles must keep its box: the logo slot is fixed (32 px, 27 px on narrow screens) and a failed logo becomes the antenna icon (remembered in `badLogos`), never `display:none`.
14. Station names stay on one line with an ellipsis; the full name is in the tooltip. Status symbols sit right after the name; their meaning is in `aria-label`/`title`, not only in colour.
15. Picking a station plays it and returns to the radio (except on a two-pane fold, where the picker stays). **← Back to Radio** closes without choosing.

## Words and states
16. **Plain words, no jargon or technical errors on screen.** Say what happened and what to do ("This station is off air, or uses a format this browser can't play. Trying the next station…"). Technical reasons go to the test history.
17. Status shows the **real** player state (Ready, Connecting…, Connected · On air, Buffering, Paused, Can't play this station); never a decorative animation pretending to be signal.
18. Every failure offers a way forward: Stay / Retry, the next station, or a hint (check your connection).
19. Toasts confirm actions that change saved things ("Saved X to preset 3", "Skipped X").

## Visual style
20. Navy, brushed-metal, high-contrast theme; the verified mark is metallic silver on the same line as the name.
21. Readable contrast on the dark background; focus outlines visible; `prefers-reduced-motion` turns animations off (the Stations button's scanner light becomes a static glow).
22. The `?v=` query on changed assets in `index.html` and `CACHE` in `sw.js` are bumped on every release, or phones keep showing the old screen.
