'use strict';
/* =========================================================================
   Now playing: the song or show title, from whichever source the station offers.
     SomaFM            its song API (artist / title / album)
     HLS               ID3 tags inside the stream (hls.js / Safari expose them as metadata cues)
     Icecast/Shoutcast ICY metadata: ask the stream for its StreamTitle (needs the server to allow it)
     Icecast           the server's /status-json.xsl page
     Shoutcast v2      /currentsong
   What works per server is remembered, so a server that blocks all of them isn't asked again for a while.
   ========================================================================= */
const NowPlaying = (() => {
  let run = 0, timer = null, ctl = null;
  const hostMethod = new Map(); // host -> { m: 'icy' | 'icecast' | 'shoutcast' | 'none', at }
  const api = { np: null, history: [], key: '', method: '' };

  const tidy = t => String(t || '').replace(/\0/g, '').replace(/\s+/g, ' ').replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, '').trim();
  // "Artist - Title", or the "Title by Artist - Station on site.com" some stations send.
  function split(text) {
    const by = text.match(/^(.+?)\s+by\s+(.+?)\s+[-–—|]\s+(.+)$/i);
    if (by && /\.(com|net|org|fm|radio|online)\b|\bon\b|radio/i.test(by[3])) return { artist: by[2].trim(), title: by[1].trim(), text: `${by[2].trim()} – ${by[1].trim()}` };
    const m = text.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: text };
  }
  function set(info) {
    if (!session?.started || session.st.key !== api.key) return;
    const artist = tidy(info.artist), title = tidy(info.title);
    let text = tidy(info.text) || [artist, title].filter(Boolean).join(' – ');
    if (!text) return;
    if (text.toLowerCase() === session.st.name.toLowerCase()) return; // some stations just repeat their own name
    const parts = artist || title ? { artist, title } : split(text);
    if (parts.text) text = parts.text;
    if (text === api.np?.text) return;
    if (api.np) api.history = [{ ...api.np }, ...api.history].slice(0, 6);
    api.np = { text, artist: parts.artist, title: parts.title, album: tidy(info.album), art: info.art || '', at: Date.now(), source: info.source };
    Songs.add(api.np, session.st);
    VFD.update();
    renderNow();
    setMediaSession(session.st);
  }

  function decode(bytes) {
    const u8 = Uint8Array.from(bytes);
    let s = new TextDecoder('utf-8').decode(u8);
    if (s.includes('�')) s = new TextDecoder('windows-1252').decode(u8);
    return s;
  }
  // Read the stream just until its first metadata block (icy-metaint bytes of audio, then a length byte, then text).
  async function icyTitle(url) {
    ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(url, { headers: { 'Icy-MetaData': '1' }, signal: ctl.signal, cache: 'no-store' });
      const metaint = +res.headers.get('icy-metaint'); // only readable when the server exposes it
      if (!res.ok) { ctl.abort(); return null; }
      const reader = res.body.getReader();
      if (!metaint) return await icyScan(reader); // header hidden from us: look for the title marker in the bytes
      let skip = metaint, metaLen = -1, meta = [], blocks = 0;
      while (blocks < 4) {
        const { value, done } = await reader.read();
        if (done) break;
        let i = 0;
        while (i < value.length) {
          if (skip > 0) { const n = Math.min(skip, value.length - i); skip -= n; i += n; continue; }
          if (metaLen < 0) {
            metaLen = value[i++] * 16;
            meta = [];
            if (metaLen === 0) { blocks++; skip = metaint; metaLen = -1; } // empty block: title unchanged
            continue;
          }
          const n = Math.min(metaLen - meta.length, value.length - i);
          for (let k = 0; k < n; k++) meta.push(value[i + k]);
          i += n;
          if (meta.length === metaLen) {
            reader.cancel().catch(() => {});
            const m = decode(meta).match(/StreamTitle='(.*?)';/s);
            return m ? m[1] : '';
          }
        }
      }
      reader.cancel().catch(() => {});
      return '';
    } catch {
      return null;
    } finally {
      clearTimeout(t);
    }
  }
  // Some servers send ICY metadata but don't let web pages read the icy-metaint header.
  // The metadata block starts with "StreamTitle='", so find that in the first ~96 KB instead.
  const MARK = [...'StreamTitle=\''].map(c => c.charCodeAt(0));
  async function icyScan(reader) {
    const buf = [];
    let from = 1; // where the next search starts
    try {
      while (buf.length < 96 * 1024) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const b of value) buf.push(b);
        let i = from;
        for (; i + MARK.length < buf.length; i++) {
          if (buf[i] !== 0x53 || !MARK.every((c, k) => buf[i + k] === c)) continue;
          const len = buf[i - 1] * 16; // the length byte right before the block
          if (len && i + len > buf.length) break; // block not complete yet: wait for more bytes
          const m = decode(buf.slice(i, len ? i + len : i + 512)).match(/StreamTitle='(.*?)';/s);
          if (m) return m[1];
        }
        from = Math.max(1, i);
      }
      return null; // no ICY metadata in this stream
    } finally {
      reader.cancel().catch(() => {});
    }
  }
  async function icecastTitle(url) {
    const u = new URL(url);
    const r = await timed(u.origin + '/status-json.xsl', 6000);
    const j = await r.res.json();
    r.abort();
    let src = j?.icestats?.source;
    src = Array.isArray(src) ? src : src ? [src] : [];
    const mount = src.find(x => { try { return new URL(x.listenurl).pathname === u.pathname; } catch { return false; } }) ||
                  (src.length === 1 ? src[0] : null);
    if (!mount) return null;
    return mount.artist ? `${mount.artist} - ${mount.title || ''}` : mount.title || '';
  }
  async function shoutcastTitle(url) {
    const r = await timed(new URL(url).origin + '/currentsong?sid=1', 6000);
    if (!r.res.ok) { r.abort(); return null; }
    const text = (await r.res.text()).trim();
    r.abort();
    return text.length < 300 && !text.includes('<') ? text : null;
  }
  const somaId = url => (url.match(/ice\d*\.somafm\.com\/(\w+)-\d+-\w+/i) || url.match(/somafm\.com\/(\w+?)(?:130|256|64|32)?\.pls/i) || [])[1];

  // One look-up. Returns { info, next } or null when this station has no usable source.
  async function lookup(url) {
    const soma = somaId(url);
    if (soma) {
      const r = await timed(`https://api.somafm.com/songs/${soma}.json`, 8000);
      const s = (await r.res.json())?.songs?.[0];
      r.abort();
      api.method = 'somafm';
      return { info: s ? { artist: s.artist, title: s.title, album: s.album, art: s.albumArt, source: 'SomaFM' } : {}, next: 30000 };
    }
    const host = hostOf(url);
    const known = hostMethod.get(host);
    const order = known && Date.now() - known.at < 30 * 60e3 ? [known.m] : ['icy', 'icecast', 'shoutcast'];
    for (const m of order) {
      if (m === 'none') break;
      let t = null;
      try { t = m === 'icy' ? await icyTitle(url) : m === 'icecast' ? await icecastTitle(url) : await shoutcastTitle(url); } catch { t = null; }
      if (t !== null) {
        hostMethod.set(host, { m, at: Date.now() });
        api.method = m;
        return { info: { text: t, source: { icy: 'stream metadata', icecast: 'Icecast status', shoutcast: 'Shoutcast status' }[m] }, next: 20000 };
      }
    }
    hostMethod.set(host, { m: 'none', at: Date.now() });
    api.method = 'none';
    return null;
  }

  api.start = s => {
    api.stop();
    if (api.key !== s.st.key) { api.key = s.st.key; api.np = null; api.history = []; }
    const my = ++run;
    const url = s.target || effectiveUrl(s.url);
    if (engine === 'hls' || kindOf(url) === 'hls') { api.method = 'hls'; return; } // titles arrive as metadata cues
    const tick = async () => {
      if (my !== run) return;
      let res = null;
      try { res = await lookup(url); } catch { res = { next: 30000 }; }
      if (my !== run) return;
      if (res?.info) set(res.info);
      if (res) timer = setTimeout(tick, res.next);
      else renderNow();
    };
    tick();
  };
  api.stop = () => {
    run++;
    clearTimeout(timer);
    ctl?.abort();
    api.method = '';
  };
  // Song changes reached the station's own metadata track (HLS ID3 tags).
  api.cues = track => {
    if (!track.activeCues) return;
    const f = {};
    for (const cue of track.activeCues) {
      const v = cue.value;
      if (!v?.key) continue;
      const data = typeof v.data === 'string' ? v.data : '';
      const kv = data.match(/title="([^"]*)".*?artist="([^"]*)"/i); // iHeart-style: title="…",artist="…"
      if (kv) { f.TIT2 = kv[1]; f.TPE1 = kv[2]; continue; }
      const st = data.match(/StreamTitle='(.*?)';/s);
      if (st) { f.text = st[1]; continue; }
      if (['TIT2', 'TPE1', 'TALB'].includes(v.key)) f[v.key] = data;
    }
    if (f.text || f.TIT2) set({ text: f.text, artist: f.TPE1, title: f.TIT2, album: f.TALB, source: 'stream tags' });
  };
  api.current = st => (st && api.np && api.key === st.key && session?.started && session.st.key === st.key ? api.np : null);
  return api;
})();
audio.textTracks.addEventListener('addtrack', e => {
  const tr = e.track;
  if (tr.kind !== 'metadata') return;
  tr.mode = 'hidden';
  tr.addEventListener('cuechange', () => NowPlaying.cues(tr));
});

/* =========================================================================
   Songs heard: every title a station sent while you listened, kept in this browser,
   with links to look it up on YouTube, Spotify and Apple Music.
   ========================================================================= */
const Songs = (() => {
  const MAX = 500;
  let list = [];
  // Station IDs, ads and URLs aren't songs worth keeping.
  const junk = t => /https?:|www\.|\.com\b|^(ad|advert|commercial|station id|jingle)\b/i.test(t) || t.length < 3;
  const api = {
    async load() { list = (await DB.get('kv', 'songs')) || []; },
    all: () => list,
    add(np, st) {
      if (junk(np.text) || list[0]?.text === np.text) return;
      list.unshift({ at: np.at, text: np.text, artist: np.artist, title: np.title, album: np.album, station: st.name, key: st.key });
      if (list.length > MAX) list.length = MAX;
      DB.put('kv', list, 'songs');
    },
    clear() { list = []; DB.put('kv', list, 'songs'); },
    merge(more) {
      const seen = new Set(list.map(x => x.at + x.text));
      list = [...list, ...more.filter(x => !seen.has(x.at + x.text))].sort((a, b) => b.at - a.at).slice(0, MAX);
      DB.put('kv', list, 'songs');
    },
  };
  return api;
})();
function renderSongs() {
  const q = $('#songsSearch').value.toLowerCase().trim();
  const rows = Songs.all().filter(s => !q || `${s.text} ${s.station}`.toLowerCase().includes(q));
  const find = s => encodeURIComponent(s.artist && s.title ? `${s.artist} ${s.title}` : s.text);
  let day = '';
  $('#songsList').innerHTML = rows.length ? rows.map(s => {
    const d = new Date(s.at).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const head = d !== day ? `<div class="song-day">${esc((day = d))}</div>` : '';
    return `${head}<div class="song">
      <span class="song-time">${esc(hhmm(s.at))}</span>
      <span class="song-text">${s.artist && s.title ? `<b>${esc(s.title)}</b> <span class="muted">by</span> ${esc(s.artist)}` : `<b>${esc(s.text)}</b>`}<small>${esc(s.station)}</small></span>
      <span class="song-links">
        <a href="https://www.youtube.com/results?search_query=${find(s)}" target="_blank" rel="noopener" title="Find on YouTube">YouTube</a>
        <a href="https://open.spotify.com/search/${find(s)}" target="_blank" rel="noopener" title="Find on Spotify">Spotify</a>
        <a href="https://music.apple.com/search?term=${find(s)}" target="_blank" rel="noopener" title="Find on Apple Music">Apple</a>
      </span></div>`;
  }).join('') : `<div class="empty">${q ? 'No songs match.' : 'No songs yet. Titles appear here while you listen to stations that send them.'}</div>`;
}
