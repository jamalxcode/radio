# Adaptive radio redesign — implementation notes

Branch: `feature/adaptive-radio-redesign`  
Baseline: `54979958ec71aa0701abc8c5092c241ce1097abe`  
Rollback: `backup/pre-redesign-2026-11-09`

## What changed
- `js/modern.js`: new UI shell wired to the existing global browser radio engine, IndexedDB data, station status model and sleep timer. No new framework or build dependencies.
- `modern.css`: responsive layout and high-contrast visuals for narrow covers, unfolded displays and desktop.
- `index.html`: loads the new layer after the original JavaScript.
- `sw.js`: precaches new assets with a bumped offline cache version.

## Intentional non-changes
Original HTML player, `style.css`, `js/player.js`, `js/health.js`, `js/car.js`, `js/guide.js`, settings and list storage are preserved. The legacy presentation remains available with `?classic=1`. No existing user data is deleted. Old five car-radio presets map to the first five slots of the new eighteen-slot collection, with the same `presets` IndexedDB key.

## Functionality
1. Large Play/Pause control at the top of the new player; no next/previous, tuner strip or oscilloscope.
2. Real connection state is derived from existing `Radio.state`; retry is offered on no signal.
3. Silver Verified indicator requires a successful probe or recorded playback, not simply an untested listing. Failed, weak, blocked and pending are distinguished in text and symbols.
4. Station picker is launched from an antenna/radio-tower SVG, with sliding right-side browser (cover screens: overlay) and Finder-inspired columns (collections/countries/genres/stations).
5. Extra quick discovery for Trending, News, Jazz, Classical and local country, plus worldwide name search.
6. Presets: three rows of six, station logos and fallback names, single tap plays and 650-ms long press assigns/replaces; Shift+Enter is a keyboard alternative.
7. Recently Played: compact two-row strip, backed by original browser-local recent history.
8. Sleep ring tracks the original countdown and fade-out logic.
9. Favorites remain separate from presets.
10. Classic mode fallback via query parameter `?classic=1`.

## Tests performed
- New JavaScript passes JavaScript compilation/syntax validation.
- HTML references both new assets after existing scripts.
- Service worker cache includes both new assets.
- Main and saved backup branch were left unchanged.

## Still to test before merging
- Real browser smoke test: playback, station switching, stream failures, automatic reconnect and relay, sleep fade-out, logos.
- Browser responsiveness on folded Duo and Fold 8, unfolded devices, tablet and desktop.
- Safari/iOS touch long-press suppression, click behavior and focus handling.
- Radio Browser worldwide searches and list refreshes.
- Pre-existing five-slot preset migration, backup/export/import, favorites and history persistence.
- Screen reader behavior and color contrast in actual rendering.
- Offline update and service worker refresh.
- Review fallback `?classic=1` from same branch.

**This is development-branch work, not a deployment or a claim of device-tested release readiness.**
