# Business rules

What radio.sala.company does, as rules. Keep this in sync with the code: when a rule changes, change it here in the same commit. Interface rules (how things look and behave on screen) are in [INTERFACE-RULES.md](INTERFACE-RULES.md); why each rule exists is in [DECISIONS-2026-11-09.md](DECISIONS-2026-11-09.md).

**Updated:** 2026-11-16

## Product and data
1. A free web radio that runs entirely in the browser. No accounts, no server-side user data.
2. **All user data stays in the browser** (IndexedDB `m3u-radio`): lists, presets, stream-test results, recently played, songs heard, settings. Backups are a file the person exports and imports.
3. **Never erase user data during UI or feature work.** Migrations are one-time, additive, and flagged in `S.ui` (precedents: favorites → presets `favsToPresets`; auto-skip on `autoSkipDefault`).
4. Plain HTML/CSS/JS, no build step, no framework. hls.js loads from jsDelivr (with an integrity hash) only when an HLS station plays.

## Station sources
5. **Radio Browser** is the default source (live API, only stations that passed its own check). On a first visit its top stations load **once**; if the person removes that list it stays removed (`S.ui.seeded`).
6. Other sources: SomaFM (official API), junguler's genre M3U lists on GitHub, curated public collections (`lists/curated.json`, refreshed daily, committed copy as fallback), mirrored lists for servers that block browsers (copied daily into the published site, never into git), and the person's own M3U/PLS (URL, file or pasted text).
7. A `?m3u=<url>` link adds a list **only after the person confirms** it (a link must not add a list silently).
8. Saved lists refresh after 24 hours.

## Stream testing
9. One set of status words everywhere: **On air · Weak · Off air · Blocked · New**. In the picker: ✓ verified, ! weak, × unavailable/blocked, ? not checked, ◌ checking.
10. **Verified (silver ✓) needs real evidence**: a successful probe or a real play, never an assumption.
11. Tests read a stream only briefly (about 320 KB or 3 s), at most 2 at once per server and 6 in total. A stream arriving slower than real time is **Weak**.
12. Servers that block web pages (CORS) aren't written off: a muted `<audio>` check decides. Plain-HTTP streams are tried over HTTPS, then through the relay, else **Blocked**.
13. Results are kept per stream URL and re-checked after 6 hours. Real plays (start time, failures, dropouts) are recorded; the person's own rating overrides tests.
14. Stations on screen in the picker are checked quietly (Settings → quiet checks, on by default); "Check visible" queues up to 25 more.

## Playback
15. A station's links are tried best first; a link that fails moves to the next (backup) link.
16. A stream that drops mid-listen is reconnected quietly **3 times** (after 1, 3, 6 s) before backup links are tried.
17. The relay (`radio-relay` Cloudflare Worker) is tried once for streams the browser can't play directly (plain HTTP, no CORS). **Direct always goes first.** HLS isn't relayed. The relay accepts only radio.sala.company and localhost, blocks private hosts, caches nothing.
18. **A station that won't play is skipped by default** (Settings can turn it off): the reason is shown in plain words, a 3-second **Stay** option keeps the station, a toast names the skipped station, and skipping stops after **5 stations in a row** fail. Skipping follows the picker's current station list and skips stations already known to be bad.
19. Pause keeps your place a little behind live; after a pause longer than a minute, resuming reconnects at the live point.
20. Song titles come from the SomaFM API, HLS ID3, ICY metadata, Icecast `status-json.xsl` and Shoutcast `/currentsong`; every song heard is kept in **All songs heard**.

## Presets, recent, sleep
21. **18 presets** (3 rows of 6). Saving: the **☆ Save to presets** button (first empty slot) or a tap on an empty slot; replacing: long-press 650 ms or Shift+Enter. A station may sit in more than one slot; only the slot last chosen is highlighted.
22. Favorites no longer exist; old favorites moved once into empty preset slots, and old backups and share links do the same.
23. Recently played keeps the last 40 stations.
24. Sleep timer: Off, 15, 30, 45, 60, 90 minutes, 2, 2½, 3 hours; at zero the sound fades out and the radio stops.

## Picker content
25. Collections → Countries → Genres → Stations, each **A–Z** (countries by displayed name; stations with natural sort, ignoring leading punctuation).
26. Countries and genres with only 1–2 stations are merged, A–Z, into groups of 6 or more; names are shortened to fit one line (countries fall back to 2-letter codes).
27. At most **350** stations render at once; narrow by country, genre or search for more.
28. Search filters the current view (name, country, genre); **Worldwide** searches all of Radio Browser by name.
29. Opening a different list resets the picker's filters and search to that list.

## Sharing, offline, deploy
30. Share links carry their data after `#`, so nothing is sent to a server; opening one offers to add the stations as a list. Big lists share their source instead of their contents.
31. Works offline: the service worker keeps the app shell; streams, Radio Browser and the relay are never cached.
32. Every push to `main` deploys live (GitHub Pages Actions), and a daily run refreshes mirrored and curated lists. **The owner wants changes pushed straight to `main`**, so test before pushing.
33. Keep the GoatCounter snippet intact (skipped on localhost, path prefixed with the host).
