# radio.sala.company

A web radio that runs entirely in the browser, live at **https://radio.sala.company** (GitHub Pages). It's the radio counterpart of M3U TV (video.sala.company).

## The radio screen

- **Now playing:** a large Play/Pause button, the station with its country and genre, the **song and artist** when the station sends them (tap the song for the song card), and the real connection status. While connecting or after a failure it says what's happening ("Trying backup link 2 of 3…", why a station couldn't play) with a Retry button.
- **Sleep and volume:** one sleep selector (15 minutes to 3 hours, with a live countdown and **Sleep Off**); at zero the sound fades out and the radio turns off.
- **Presets:** 18 logo-backed slots. Tap to play, long-press (or Shift+Enter) to save the station that's on. Only the slot you picked is highlighted, even if a station is saved twice.
- **Recently played:** the last stations you listened to.
- **Stations** (the antenna button, with a sweeping red scanner light): a Finder-style picker with Collections → Countries → Genres → Stations, all A–Z. Countries and genres with only 1–2 stations are merged into groups of six or more, with names shortened to fit. Collections also holds **Recently played** and **＋ Add list**. Stations on screen are checked quietly; a silver ✓ marks streams verified by a real test or play. **Worldwide** searches all of Radio Browser by name. Picking a station returns to the player; on phones the picker slides over the screen. On phones and folds the columns don't all fit: swipe sideways anywhere on them to move between columns, and choosing a collection, country or genre slides to the next columns by itself. On narrow screens the Stations column fills the space beside Genres, so full station names and their ✓ marks show.
- **Settings (⚙):** skip failed stations, quiet checks, advanced timings; refresh, share or remove the open list; share presets; backup export/import; clear test history; erase everything.
- **Every device:** phones, tablets, foldables (including the iPhone Duo, folded and unfolded) and desktops. The layout keeps clear of notches, Dynamic Islands and side system bars on any edge; landscape phones and narrow outer displays get a vertical side rail; on a folding screen the radio and the station picker each get their own screen, nothing under the hinge. Folding, rotating or resizing never interrupts the audio, and your place in the picker survives a reload. Installable as an app.
- **Keyboard:** Space pause · M mute · N / P next and previous station · Esc closes the menu or picker. Media keys and lock-screen controls work too.

Favorites were folded into presets: on the first visit after the change, saved favorites move into empty preset slots. Read the [design decisions](docs/design/DECISIONS-2026-11-09.md) and [implementation and testing notes](docs/design/IMPLEMENTATION-NOTES.md) for the full history, and [docs/design/conversations](docs/design/conversations/) for the owner conversations behind recent changes. The original pre-redesign snapshot is kept at `backup/pre-redesign-2026-11-09`.

## Station sources

| Source | How it loads |
|---|---|
| **Radio Browser** (radio-browser.info), the default | Live API: top voted, most listened, trending, by country, genre, language or name. Only stations that passed Radio Browser's own check are loaded. |
| **junguler/m3u-radio-music-playlists** | Genre M3U files read straight from GitHub (the genre menu comes from the GitHub API). |
| **SomaFM** | Official channel API. |
| **Mirrored lists** | Lists whose servers block browsers (no CORS) are copied into the published site by the deploy workflow once a day. Add more in `lists/sources.json`. |
| **Curated collections** | [IPRD](https://github.com/iprd-org/iprd) (24,000 stations in 225 countries, by country and broadcaster, with logos), [radio-playlists](https://github.com/dderry2/radio-playlists) (Radio Browser by genre, rebuilt weekly, plus a worldwide top 500), [recommended-radio-streams](https://github.com/deroverda/recommended-radio-streams) (hand-picked underground electronic, jazz, ambient, campus radio) and [internet-radio-streams](https://github.com/mikepierce/internet-radio-streams) (small themed playlists). The catalogue (`lists/curated.json`) is refreshed daily by `scripts/curated.mjs`; the committed copy stands in when a source is down. |
| **Your own** | Any M3U/PLS URL, an uploaded file, or pasted text. `?m3u=<url>` adds a list from a link. |

## Finding stations

- **Picker search** filters the stations in view by name, country or genre; **Worldwide** (or Enter) searches all of Radio Browser by name. Results show as a collection of their own.
- **Flags:** countries show their flag (a flags-only font fills in on Windows, which has no flag emoji).

## Stream testing (same approach as M3U TV)

- **Sampling:** each stream is read only briefly, the first ~320 KB or 3 seconds. At most 2 tests run per server at once, and 6 in total.
- **Icecast / Shoutcast / MP3 / AAC:** the real bitrate comes from the frame headers. If audio arrives slower than real time, the stream will drop out, so it's marked **Weak**.
- **Playlist files** (.pls, .m3u, .asx, .xspf) are followed to the stream they point to.
- **HLS:** a live segment's download speed is checked against its bitrate.
- **Servers that block web pages (CORS):** they aren't written off. A muted `<audio>` element checks whether audio actually starts, which also catches CDNs that cut off plain reads.
- **Plain-HTTP streams:** these are tried over HTTPS, and marked **Blocked** if that fails.
- **Skipping and backups:** dead servers are skipped. When a link fails, the station's backup links are tested next.
- **Real plays and ratings:** start time, failures and dropouts from real plays are recorded. Your own ratings override test results.
- **One set of status words everywhere:** On air · Weak · Off air · Blocked · New.
- **Where results live:** IndexedDB, in your browser only. Results are re-checked after 6 hours, and lists refresh after 24 hours.

## Playback

- **Backup links:** a station's links are tried best first.
- **Drops:** a stream that drops mid-listen is reconnected quietly up to 3 times, and only then are backup links tried.
- **Pause:** pause keeps your place, a little behind the broadcast. After a pause longer than a minute, resuming reconnects at the live point.
- **Song and show titles:** read from the SomaFM API, HLS ID3 tags, ICY stream metadata, Icecast `status-json.xsl` and Shoutcast `/currentsong`.
  - They show under the station name and on the lock screen. Tap the song for the song card: title, artist, album, YouTube / Spotify / Apple Music links, Copy, and what played before it.
  - **All songs heard** (from the song card) keeps a history of everything you heard.
- **Relay:** when a stream can't be played directly by the browser (plain-HTTP on this HTTPS page, or a server without CORS headers), the tester and the player try it once more through `radio-relay`, a Cloudflare Worker (`relay/relay.js`, deployed at radio-relay.jamal-akuna-matata.workers.dev) that passes the audio through unchanged and adds the headers. Direct always goes first. HLS streams aren't relayed.

## More

- **Share links:** Settings → Share presets / Share this list makes a link (after the `#`, so nothing is sent to any server) that carries your preset stations, or a list, to another phone or person; opening it offers to add them as a list. Big lists share their source instead of their contents.
- **Works offline:** a small service worker (`sw.js`) keeps the app's own files in the browser, so the site opens instantly and still opens with no network, showing your lists, presets and songs heard (streams need network). The page is fetched fresh whenever the network answers within 4 seconds, so updates arrive normally.

## Code

Plain HTML, CSS and JS, with no build step. The scripts in `js/` share one global scope and load in order:

| File | What's in it |
|---|---|
| `core.js` | Storage, helpers, app state |
| `lists.js` | List sources, parsing, the Add-list dialog |
| `health.js` | Status badges and the stream tester |
| `player.js` | Playback, reconnecting, pause / mute, lock-screen controls |
| `nowplaying.js` | Song titles and the songs-heard log |
| `share.js` | Share links for presets and lists |
| `base.js` | Playback state, volume, sleep timer, presets, Radio Browser browsing, settings, backup, keyboard, start-up |
| `modern.js` | The radio screen: now playing, presets, recently played, station picker |

`modern.css` styles the screen and its dialogs. hls.js loads from jsDelivr only when an HLS station plays.

## Deploy

`.github/workflows/pages.yml` publishes the site on every push to `main` and once a day. The daily run also refreshes the mirrored lists. In the repo's **Settings → Pages**, the source must be **GitHub Actions**. The custom domain comes from the `CNAME` file and the Pages settings.
