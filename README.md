# radio.sala.company

A web radio that runs entirely in the browser, live at **https://radio.sala.company** (GitHub Pages). It's styled after a 10-band shortwave portable, and it's the radio counterpart of M3U TV (video.sala.company).

## Station sources

| Source | How it loads |
|---|---|
| **Radio Browser** (radio-browser.info), the default | Live API: top voted, most listened, trending, by country, genre, language or name. Only stations that passed Radio Browser's own check are loaded. |
| **junguler/m3u-radio-music-playlists** | Genre M3U files read straight from GitHub (the genre menu comes from the GitHub API). |
| **SomaFM** | Official channel API. |
| **Mirrored lists** | Lists whose servers block browsers (no CORS) are copied into the published site by the deploy workflow once a day. Add more in `lists/sources.json`. |
| **Your own** | Any M3U/PLS URL, an uploaded file, or pasted text. `?m3u=<url>` adds a list from a link. |

## Finding stations

- **Search box scope:** *This view* filters what's shown, *All my lists* merges every list you have, and *Radio Browser* searches all of it by name.
- **Chips:** Near me (from your browser's region), Trending, News, Talk, Jazz, Classical and others browse Radio Browser directly.
- **Save as list:** puts browse results on the next free band.
- **Filters:** country, genre, language (when the list says which languages its stations broadcast in; Radio Browser lists do), on air only, and sort.
- **Flags:** each station name starts with the flag of the country it broadcasts from (a flags-only font fills in on Windows, which has no flag emoji).

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
- **Pause / live:** pause keeps your place, a little behind the broadcast, and **● LIVE** jumps back to the live point. After a pause longer than a minute, resuming reconnects at the live point.
- **Song and show titles:** read from the SomaFM API, HLS ID3 tags, ICY stream metadata, Icecast `status-json.xsl` and Shoutcast `/currentsong`.
  - They show on the dial, in the phone mini-player and on the lock screen.
  - **♪ Songs** keeps a history of everything you heard, with YouTube, Spotify and Apple Music search links.

## Controls

| On the radio | What it does |
|---|---|
| Band strip / BAND knob | Your station lists: FM = 1st, MW = 2nd, SW1–SW8 = the next eight |
| TUNING knob / scale | Moves through the stations; tunes in when you stop. Click the scale to jump. |
| ⏮ ⏸ ⏹ ⏭ under the dial | Previous · pause / play · stop · next |
| 🔊 · ● LIVE · ☆ | Mute · back to live · favorite |
| VOLUME knob | Volume |
| POWER switch | Play / stop |
| SENS DX / LOCAL | DX shows every station. LOCAL hides stations that are off air or blocked. |
| ⏾ Sleep (with the play controls) | 30 minutes to 3 hours in 30-minute steps, with a live countdown; at zero the sound fades out and the radio turns off |
| MEMORY · LIGHT | Favorite · dial lamp and effects |
| TUNE light | Green = playing, amber = tuning, buffering or paused, red = no signal |

- **Knobs:** tap the left or right half to step, drag them round, scroll on them, or use the arrow keys when focused.
- **Keyboard:** ↑↓ move the guide · Enter plays · ←→ previous/next · Space pause · M mute · F favorite.
- **Works offline:** a small service worker (`sw.js`) keeps the app's own files in the browser, so the site opens instantly and still opens with no network, showing your lists, favorites and songs heard (streams need network). The page is fetched fresh whenever the network answers within 4 seconds, so updates arrive normally.
- **Lists** are managed at the top of the station guide (pick, +, ⟳, 🗑); the header keeps brand, iPod look, songs, help and settings. The dial shows STATUS · SIGNAL · FORMAT · ON AIR · TIME; the link in use and the buffer are in the station details.
- **Song on every screen:** the title a station sends shows on the shortwave dial, the car LCD, the phone bar and the iPod's Now Playing, sliding sideways when it's too long. Tap it for the song card: title, artist, album, YouTube / Spotify / Apple Music links, Copy, and what played before it on that station.
- **Relay:** when a stream can't be played directly by the browser (plain-HTTP on this HTTPS page, or a server without CORS headers), the tester and the player try it once more through `radio-relay`, a Cloudflare Worker (`relay/relay.js`, deployed at radio-relay.jamal-akuna-matata.workers.dev) that passes the audio through unchanged and adds the headers. Direct always goes first; the dial's LINK cell says RELAY when it's in use. HLS streams aren't relayed.
- **iPod look (the ◉ button, or Settings → Look):** a black click-wheel player that fills the screen. Turn the wheel to move the highlight (or the volume on Now Playing), press the centre to pick, MENU goes back (hold it for the main menu), ⏮ ⏭ change station, ▶❚❚ plays or pauses; tapping a row on the screen works too. Menus: Now Playing, Stations, Lists, Favorites, Recent, Search, Songs heard, Sleep, Settings. On a folded phone the iPod is the whole screen and Search opens the station picker; open the fold (or use a tablet or desktop) and the station guide becomes the left page with the iPod on the right, hinge in the middle.
- **Small phones (under 600 px, e.g. a folded Galaxy Z Fold):** the radio becomes a 1950s push-button car radio. A chrome dial shows station names under a red needle (tap one, or swipe), an LCD shows the station, song and sleep countdown, and five piano keys are presets (tap an empty key to store the station that's on, hold a key to replace it). Below: previous · play/pause · next · SLEEP · mute · favorite, then VOL · STATIONS · TUNE. STATIONS opens a full-screen picker with search, chips, filters and the list; picking a station takes you back to the radio.
- **Phones and small tablets (600–820 px):** the station guide fills the screen with a mini-player at the bottom (with sleep timer). Tap or swipe up the mini-player to open the radio.

## Code

Plain HTML, CSS and JS, with no build step. The scripts in `js/` share one global scope and load in order:

| File | What's in it |
|---|---|
| `core.js` | Storage, helpers, app state |
| `lists.js` | List sources, parsing, the Add-list dialog |
| `health.js` | Status badges and the stream tester |
| `guide.js` | Station guide, filters, search and browsing |
| `radio.js` | Dial, knobs, display, sleep timer, phone mini-player |
| `player.js` | Playback, reconnecting, pause / mute / live, lock-screen controls |
| `nowplaying.js` | Song titles and the songs-heard log |
| `car.js` | Small phones: the push-button car radio and the station picker |
| `ipod.js` | The iPod look: click wheel, menus, Now Playing; two-page layout on wide screens |
| `app.js` | Station details, favorites, backup, settings, wiring, start-up |

hls.js loads from jsDelivr only when an HLS station plays.

## Deploy

`.github/workflows/pages.yml` publishes the site on every push to `main` and once a day. The daily run also refreshes the mirrored lists. In the repo's **Settings → Pages**, the source must be **GitHub Actions**. The custom domain comes from the `CNAME` file and the Pages settings.
