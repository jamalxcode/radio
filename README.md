# M3U Radio

A web radio that runs entirely in the browser and is hosted on GitHub Pages. It's styled after a 10-band shortwave portable, and it's the radio counterpart of M3U TV (video.sala.company).

## Station sources

| Source | How it loads |
|---|---|
| **Radio Browser** (radio-browser.info), the default | Live API: top voted, most listened, trending, by country, genre, language or name. Only stations that passed Radio Browser's own check are loaded. |
| **junguler/m3u-radio-music-playlists** | Genre M3U files read straight from GitHub (the genre menu comes from the GitHub API). |
| **SomaFM** | Official channel API. |
| **Mirrored lists** | Lists whose servers block browsers (no CORS) are copied into `lists/` once a day by a GitHub Action. Add more in `lists/sources.json`. |
| **Your own** | Any M3U/PLS URL, an uploaded file, or pasted text. `?m3u=<url>` adds a list from a link. |

## Stream testing (same approach as M3U TV)

- Each stream is read only briefly: the first ~320 KB or 3 seconds. At most 2 tests run per server at once, and 6 run in total.
- **Icecast / Shoutcast / MP3 / AAC:** the app reads the real bitrate from the MP3 or AAC frame headers. It then compares how fast the audio arrives with how fast it plays. If it arrives slower than real time, the stream will drop out, so it's marked "Weak".
- **Playlist files** (.pls, .m3u, .asx, .xspf) are followed to the stream they point to.
- **HLS:** the app checks a live segment's download speed against its bitrate.
- **Radio-specific step:** browsers play cross-origin audio without CORS. So when a server refuses CORS, the app doesn't mark it blocked straight away. It checks whether a muted `<audio>` element actually starts.
- Plain-HTTP streams are tried over HTTPS. If that fails, they're marked "Blocked", because browsers refuse plain HTTP audio on an HTTPS page.
- If other streams on a server were unreachable, the rest of that server is skipped. When a station's link fails, its backup links are tested next.
- Real plays are recorded too: start time, failures and dropouts. Your own ratings override the test results.
- Everything is stored in IndexedDB in your browser. Results are re-checked after 6 hours, and lists refresh after 24 hours.

## Controls

| On the radio | What it does |
|---|---|
| BAND knob | Switches between your station lists: FM = 1st, MW = 2nd, SW1–SW8 = the next eight |
| TUNING knob / scale | Turn it to move through stations. Playback tunes in when you stop turning. Click the scale to jump. |
| VOLUME knob | Volume |
| POWER switch | Play / stop (live radio reconnects at the live point) |
| SENS DX / LOCAL | DX shows every station. LOCAL hides stations that are off air or blocked. |
| ◀ SCAN ▶ | Previous / next station |
| MEMORY | Favorite |
| LIGHT | Dial lamp, LCD backlight and effects |
| TUNE LED | Green = playing, amber = tuning or buffering, red = no signal |

The knobs respond to dragging, the scroll wheel, and the arrow keys when focused. Keyboard: ↑↓ move the guide, Enter plays, ←→ previous/next, Space power, F memory.

## Deploy

1. Push these files to a GitHub repository.
2. Go to **Settings → Pages → Deploy from a branch**, pick `main`, then `/ (root)`.
3. Go to **Actions → Mirror station lists → Run workflow** once, to create `lists/index.json`.

There's no build step: it's plain HTML, CSS and JS. hls.js loads from jsDelivr only when an HLS station plays.
