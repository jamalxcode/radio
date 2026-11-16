# 📻 radio.sala.company

**Tens of thousands of radio stations from all over the world, in a browser tab.** No app store, no account, no ads, nothing to install. Open **https://radio.sala.company**, tap the antenna, and you're listening to jazz from Paris, news from Buenos Aires or a campus station you'll never find again.

It's the radio sibling of M3U TV (video.sala.company): the same Finder-style picker, the same stubborn stream tester, a navy-and-brushed-metal look, and all of it plain HTML, CSS and JavaScript with no build step.

---

## The 30-second tour

- **Tap Stations** (the antenna button, the one with the red scanner light sweeping across it like a certain 1980s talking car).
- **Pick your way down:** Collections → Countries → Genres → Stations, all A–Z. Tiny countries and genres with only one or two stations get merged into groups, so the lists stay short.
- **Tap a station.** It plays, and the picker gets out of your way.
- **Like it? Tap ☆ Save to presets.** It drops into the first empty slot of your 18 presets and the button turns into **★ Preset 3** (or wherever it landed). You can also just tap an empty slot.
- **Going to bed?** Set the sleep timer (15 minutes to 3 hours). At zero the sound fades out gently instead of cutting off mid-sentence.

That's it. Everything else is there to make sure the station you tapped actually plays.

## What's on the screen

| Part | What it does |
|---|---|
| **Now playing** | A big Play/Pause button, the station, its country and genre, and the **song and artist** when the station sends them (tap the song for the song card). The status line tells the truth: Connecting…, On air, Buffering, Paused, or *why* something isn't playing. No fake equalizer bars pretending to be signal. |
| **Presets** | 18 slots with station logos. Tap to play. Save with the ☆ button or by tapping an empty slot; long-press (or Shift+Enter) to replace one. Only the slot you picked lights up, even if you saved the same station twice. |
| **Recently played** | Your last 40 stations, in case "what was that one?" strikes. |
| **Stations picker** | The four-column browser, with **Search** (inside the current view) and **Worldwide** (all of Radio Browser by name). A silver ✓ means a stream has *proven* it works, by a test or a real play. |
| **Settings ⚙** | Skip stations that won't play (on by default), quiet checks, timings; refresh, share or remove a list; share presets; backup export and import; clear test history; erase everything. |
| **Keyboard** | Space pause · M mute · N / P next and previous · Esc closes the menu or picker. Media keys, headphone buttons and lock-screen controls work too. |

## Built for the phone in your pocket (and the weird ones too)

Phones, tablets, desktops, and foldables, including the iPhone Duo and the Samsung Galaxy Fold, whose owner found two of the bugs below.

- **Nothing hides behind notches**, Dynamic Islands, side-mounted system bars or the home indicator, on any of the four edges.
- **Landscape phones** get a vertical side rail, with now playing and presets side by side.
- **Folding screens** with two halves get one pane each: the radio on one screen, the picker on the other, and nothing under the hinge.
- **Folding, rotating or resizing never stops the music.** Your place in the picker even survives a page reload.
- **Swipe sideways anywhere on the picker's columns** to move between them. Choosing a country slides you over to the stations by itself, and on narrow screens the Stations column stretches so full names and their ✓ marks fit.
- **Touch targets are at least 44 px**, and inputs won't make iOS zoom in.
- **Installable as an app**, and it still opens with no network (your lists, presets and songs heard are all there; the streams themselves need the internet).

## Where the stations come from

| Source | How it gets here |
|---|---|
| **Radio Browser** (radio-browser.info), the default | Live API: top voted, most listened, trending, or by country, genre, language or name. Only stations that passed Radio Browser's own check. Your first visit loads its top stations once. |
| **SomaFM** | Their official channel API, song titles included. |
| **junguler/m3u-radio-music-playlists** | Genre M3U files read straight from GitHub. |
| **Curated collections** | [IPRD](https://github.com/iprd-org/iprd) (24,000 stations in 225 countries, with logos), [radio-playlists](https://github.com/dderry2/radio-playlists) (by genre, plus a worldwide top 500), [recommended-radio-streams](https://github.com/deroverda/recommended-radio-streams) (hand-picked underground electronic, jazz, ambient, campus radio) and [internet-radio-streams](https://github.com/mikepierce/internet-radio-streams) (small themed playlists). Refreshed daily by `scripts/curated.mjs`, with a committed copy for when a source is down. |
| **Mirrored lists** | Lists on servers that block browsers get copied into the published site once a day. Add more in `lists/sources.json`. |
| **Your own** | Any M3U/PLS link, file or pasted text. A `?m3u=<url>` link offers to add a list (it asks first, so nobody can sneak one in). |

Countries show their flags; on Windows, which has no flag emoji, a small flags-only font fills in.

## The stream tester: suspicious by design

Internet radio is a graveyard of dead links. So before you waste a tap, the radio quietly checks the stations on your screen:

- It **reads each stream for a moment** (about 320 KB or 3 seconds), never more than 2 at once per server and 6 in total, so nobody's server gets hammered.
- It **reads the real bitrate** from MP3 and AAC frame headers. If audio arrives slower than it plays, the stream will stutter, so it's marked **Weak**.
- It **follows playlist files** (.pls, .m3u, .asx, .xspf) to the actual stream, and checks HLS segments against their bitrate.
- **Servers that block web pages** get a second chance: a muted `<audio>` element checks whether sound actually starts.
- **Plain-HTTP streams** are tried over HTTPS, then through the relay, and only marked **Blocked** if all of that fails.
- **Real plays count more than tests**: start time, failures and dropouts are recorded, and your own rating beats them all.

One vocabulary everywhere: **On air · Weak · Off air · Blocked · New**. In the picker: ✓ verified, ! weak, × unavailable, ? not checked yet. Results are re-checked after 6 hours and stay in your browser only.

## When a station won't play

Some stations will still let you down. The radio's job is to make that painless:

1. **Backup links first.** Many stations have several; the best is tried first and the rest take over if it fails.
2. **Dropped mid-song?** It reconnects quietly, up to 3 times, before reaching for backups.
3. **Still nothing?** The screen says why in plain words ("This station is off air, or uses a format this browser can't play") and **moves on to the next working station after 3 seconds**. Changed your mind? Tap **Stay** during those 3 seconds.
4. **Five dead stations in a row?** It stops and suggests checking your connection, because at that point it's probably the Wi-Fi, not the world's radio stations.

And for streams a browser simply refuses to play (plain HTTP on this HTTPS page, or servers without the right headers), there's **`radio-relay`**, a tiny Cloudflare Worker (`relay/relay.js`) that passes the audio through untouched. Direct always goes first; the relay only works for this site, blocks private addresses and stores nothing. HLS streams aren't relayed.

## Songs, sharing and other niceties

- **Song titles** come from wherever the station offers them: the SomaFM API, HLS ID3 tags, ICY stream metadata, Icecast `status-json.xsl` or Shoutcast `/currentsong`. They show under the station name and on your lock screen.
- **The song card** (tap the song) has title, artist, album, YouTube / Spotify / Apple Music links, Copy, and what played before it. **All songs heard** keeps the full history.
- **Pause** keeps your place a little behind live; after a minute or more, Play jumps back to the live broadcast.
- **Share links** carry your presets or a list after the `#` in the address, so nothing passes through a server. Big lists share their source instead of their contents.
- **Your data is yours.** Lists, presets, tests, history, songs heard and settings live in your browser's storage and nowhere else. Backups are a file you export.

## Recent adventures

- **Nov 16: the case of the jumping station names.** On the Fold, names in the picker kept twitching right and back. The culprit: broken station logos. Each failed logo was hidden, the name slid left, then the picker redrew (it does that every time a check finishes), the broken logo got another try, and the name slid right again. Several times a second. Now a broken logo is remembered and swapped for the antenna icon, in a slot that never changes size.
- **Nov 16: presets you can actually find.** Saving used to need a long-press nobody discovered. Now there's a ☆ Save to presets button, and tapping an empty slot works.
- **Nov 16: no more dead ends.** A station that won't play now gets a plain-English reason and an automatic skip to the next one, with a Stay button for the stubborn.
- **Nov 11: the Fold couldn't swipe sideways.** A single CSS line (`overscroll-behavior: contain`) meant to stop the page bouncing also stopped sideways swipes from reaching the picker's columns, so the Stations column sat out of reach. One word changed (`auto contain`) and the stations came back, confirmed on the real Fold.
- **Nov 11: every device.** Safe areas on all four edges, a side rail for landscape phones, one pane per screen on foldables, and the music never stops when you fold.

The full story, with every decision and test, is in the design records below.

## Under the hood

Plain HTML, CSS and JavaScript. No framework, no bundler, no `node_modules`. The scripts in `js/` share one global scope and load in order:

| File | What's in it |
|---|---|
| `core.js` | Storage, helpers, app state |
| `lists.js` | List sources, M3U/PLS parsing, the Add-list dialog |
| `health.js` | Status badges and the stream tester |
| `player.js` | Playback, reconnecting, skipping, pause / mute, lock-screen controls |
| `nowplaying.js` | Song titles and the songs-heard log |
| `share.js` | Share links for presets and lists |
| `base.js` | Volume, sleep timer, presets, Radio Browser browsing, settings, backup, keyboard, start-up |
| `modern.js` | The radio screen: now playing, presets, recently played, station picker |

`modern.css` styles everything; `sw.js` is the offline shell; hls.js loads from jsDelivr only when an HLS station plays.

**Run it locally:**

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. That's the whole build process.

**Deploy:** every push to `main` goes live through GitHub Pages Actions (`.github/workflows/pages.yml`), and a daily run refreshes the mirrored and curated lists. In **Settings → Pages** the source must be **GitHub Actions**; the custom domain comes from `CNAME`.

## Design records

Everything that was decided, built, broken and fixed is written down in `docs/design/`:

- [Design decisions](docs/design/DECISIONS-2026-11-09.md): the goals, every owner decision since the redesign, and the release log.
- [Implementation and testing notes](docs/design/IMPLEMENTATION-NOTES.md): how each change was built and tested, asset versions, rollback.
- [Business rules](docs/design/BUSINESS-RULES.md): what the radio does, as numbered rules.
- [Interface rules](docs/design/INTERFACE-RULES.md): how the screen must behave on every device. Check changes against it.
- [Lessons learned](docs/design/LESSONS-LEARNED.md): bugs that taught something, and testing tips.
- [Design ideas](docs/design/DESIGN-IDEAS.md): what's next, most important first (showing stations the moment the picker opens is at the top).
- [Conversations](docs/design/conversations/): the owner conversations behind recent changes:
  - [Nov 9–12, from the video.sala.company session](docs/design/conversations/2026-11-09-to-11-12-video-session.md): radio as the model for video, and the every-device layer.
  - [Nov 11, the station picker on the Galaxy Fold](docs/design/conversations/2026-11-11-fold-station-picker.md).
  - [Nov 16, a UX critique, easier presets, skipping dead stations, and the jumping names](docs/design/conversations/2026-11-16-ux-critique-presets-dead-stations.md).

Favorites, by the way, were folded into presets: the first visit after the change moved any saved favorites into empty preset slots. The pre-redesign version of the whole site is preserved on the `backup/pre-redesign-2026-11-09` branch, just in case.
