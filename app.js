'use strict';

/* =========================================================================
   Storage — IndexedDB, so everything stays in this browser only.
   Stores: kv (settings, ui, list index, list contents),
           health (per-stream test + play history, keyed by stream URL),
           favs (favorite stations, keyed by station key)
   ========================================================================= */
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('m3u-radio', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('kv');
      db.createObjectStore('health', { keyPath: 'url' });
      db.createObjectStore('favs', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  async function run(store, mode, fn) {
    try {
      const db = await open();
      return await new Promise((res, rej) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => res(req && req.result);
        t.onerror = t.onabort = () => rej(t.error);
      });
    } catch (e) {
      console.warn('Storage error', e);
      return undefined;
    }
  }
  return {
    get: (s, k) => run(s, 'readonly', st => st.get(k)),
    put: (s, v, k) => run(s, 'readwrite', st => (k === undefined ? st.put(v) : st.put(v, k))),
    del: (s, k) => run(s, 'readwrite', st => st.delete(k)),
    all: s => run(s, 'readonly', st => st.getAll()),
    clear: s => run(s, 'readwrite', st => st.clear()),
  };
})();

/* =========================================================================
   Helpers
   ========================================================================= */
const $ = s => document.querySelector(s);
const PAGE_HTTPS = location.protocol === 'https:';
// Browsers refuse plain-http media on an https page, so try the https version instead.
const isMixed = url => PAGE_HTTPS && /^http:/i.test(url);
const effectiveUrl = url => (isMixed(url) ? url.replace(/^http:/i, 'https:') : url);
const hostOf = url => { try { return new URL(effectiveUrl(url)).host; } catch { return ''; } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtS = ms => (ms / 1000).toFixed(1) + 's';
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
}

/* fetch with a timeout; returns { res, abort } */
async function timed(url, ms, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new DOMException('Timed out', 'TimeoutError')), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal, cache: 'no-store' });
    return { res, abort: () => { clearTimeout(timer); ctl.abort(); } };
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}
const isTimeout = e => e && (e.name === 'TimeoutError' || e.name === 'AbortError');

/* hls.js loads on demand: most radio is plain Icecast/Shoutcast, which the browser plays itself. */
const LIBS = { hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js' };
const libLoads = {};
function loadLib(name) {
  return libLoads[name] || (libLoads[name] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = LIBS[name];
    s.async = true;
    s.onload = res;
    s.onerror = () => { delete libLoads[name]; s.remove(); rej(new Error('Couldn’t load the HLS player library')); };
    document.head.appendChild(s);
  }));
}
const warmed = new Set();
function preconnect(url) {
  let origin;
  try { origin = new URL(effectiveUrl(url)).origin; } catch { return; }
  if (warmed.has(origin) || warmed.size > 60) return;
  warmed.add(origin);
  const l = document.createElement('link');
  l.rel = 'preconnect';
  l.href = origin;
  l.crossOrigin = 'anonymous';
  document.head.appendChild(l);
}

/* =========================================================================
   State
   ========================================================================= */
const DEFAULT_SETTINGS = { slowStartSec: 5, timeoutSec: 12, autoSkip: false, autoTest: true, concurrency: 6, fx: true };
const RB_QUERY = {
  top: 'stations/search?order=votes&reverse=true&hidebroken=true&limit=3000',
  clicks: 'stations/search?order=clickcount&reverse=true&hidebroken=true&limit=3000',
  trending: 'stations/search?order=clicktrend&reverse=true&hidebroken=true&limit=1000',
  country: v => `stations/search?countrycode=${encodeURIComponent(v)}&order=votes&reverse=true&hidebroken=true&limit=10000`,
  tag: v => `stations/search?tag=${encodeURIComponent(v)}&order=votes&reverse=true&hidebroken=true&limit=5000`,
  language: v => `stations/search?language=${encodeURIComponent(v)}&order=votes&reverse=true&hidebroken=true&limit=5000`,
  name: v => `stations/search?name=${encodeURIComponent(v)}&order=votes&reverse=true&hidebroken=true&limit=2000`,
};
// Loaded automatically for first-time visitors.
const DEFAULT_LIST = { kind: 'rb', name: 'Radio Browser · Top voted', query: RB_QUERY.top };
const JG_REPO = 'junguler/m3u-radio-music-playlists';
const JG_RAW = `https://raw.githubusercontent.com/${JG_REPO}/main/`;
const SOMA_URL = 'https://api.somafm.com/channels.json';
const REFRESH_AFTER = 24 * 3600e3;   // re-download saved lists older than this
const FRESH_FOR = 6 * 3600e3;        // test/play results newer than this aren't re-tested
const S = {
  lists: [],            // [{ id, name, kind: rb|m3u|soma, query?, url?, genre?, count, addedAt, updatedAt }]
  stations: [],         // { key, name, logo, group, country, sources: [{ url, name, br, codec, hls, uuid }] }
  byKey: new Map(),
  byUrl: new Map(),
  numByKey: new Map(),
  filtered: [],
  health: new Map(),    // stream URL -> health record
  hosts: new Map(),     // server host -> { ok, blocked, dead } from recent tests
  favs: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  ui: { currentId: null, search: '', group: '', country: '', status: 'all', sort: '', lastKey: '', volume: 0.8 },
  recent: [],
  cursor: -1,
  lit: new Map(),
  current: null,
  loading: '',
};
const saveUi = () => DB.put('kv', { ...S.ui }, 'ui');

/* =========================================================================
   Station lists: Radio Browser JSON, M3U/PLS text, SomaFM JSON — all turned
   into the same entries, then duplicates merged into one station with backups.
   ========================================================================= */
function titleComma(s) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') q = !q;
    else if (s[i] === ',' && !q) return i;
  }
  return s.length;
}
const isStreamUrl = u => /^(https?|icy):\/\//i.test(u);
function parseM3U(text, defGroup = '') {
  const out = [];
  let cur = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const c = titleComma(line);
      const attrs = {};
      line.slice(0, c).replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k.toLowerCase()] = v; });
      cur = {
        name: line.slice(c + 1).trim() || attrs['tvg-name'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        country: (attrs['tvg-country'] || '').toLowerCase().slice(0, 2),
      };
    } else if (/^#EXTGRP:/i.test(line)) {
      if (cur && !cur.group) cur.group = line.slice(8).trim();
    } else if (!line.startsWith('#')) {
      const url = line.split('|')[0].trim().replace(/^icy:/i, 'http:');
      if (!isStreamUrl(url)) { cur = null; continue; }
      out.push({ name: cur?.name || url.split('/').pop() || 'Unnamed', logo: cur?.logo || '',
                 group: (cur?.group || defGroup || 'Ungrouped').replace(/_/g, ' '), country: cur?.country || '', url });
      cur = null;
    }
  }
  return out;
}
function parsePLS(text, defGroup = '') {
  const files = {}, titles = {};
  for (const m of text.matchAll(/^\s*(File|Title)(\d+)\s*=\s*(.+)$/gim)) (m[1].toLowerCase() === 'file' ? files : titles)[m[2]] = m[3].trim();
  return Object.keys(files).filter(n => isStreamUrl(files[n]))
    .map(n => ({ name: titles[n] || files[n], logo: '', group: defGroup || 'Ungrouped', country: '', url: files[n] }));
}
const parseText = (text, defGroup) => (/^\s*\[playlist\]/i.test(text) ? parsePLS(text, defGroup) : parseM3U(text, defGroup));

// Radio Browser station -> entry. Its tags become the station's groups.
function rbEntry(s) {
  const tags = (s.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(t => t && t.length < 30).slice(0, 4);
  return { name: (s.name || '').trim() || 'Unnamed', logo: s.favicon || '', group: tags.join(';') || 'untagged',
           country: (s.countrycode || '').toLowerCase(), url: s.url_resolved || s.url, br: s.bitrate || 0,
           codec: s.codec && s.codec !== 'UNKNOWN' ? s.codec : '', hls: !!s.hls, uuid: s.stationuuid, rbOk: s.lastcheckok };
}
function somaEntries(json) {
  const out = [];
  for (const c of json.channels || []) {
    for (const p of c.playlists || []) {
      out.push({ name: c.title, logo: c.xlimage || c.largeimage || c.image || '', group: (c.genre || '').split('|').join(';'),
                 country: 'us', url: p.url, codec: (p.format || '').toUpperCase(), br: p.quality === 'highest' ? 0 : 0 });
    }
  }
  return out;
}

const cleanName = n => n.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const stationKey = e => 'n:' + cleanName(e.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + '|' + (e.country || '');
function mergeStations(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!e.url) continue;
    const key = stationKey(e);
    let st = map.get(key);
    if (!st) {
      st = { key, name: cleanName(e.name) || e.name, logo: e.logo, group: e.group, country: e.country, sources: [] };
      map.set(key, st);
    } else {
      if (!st.logo) st.logo = e.logo;
      const groups = new Set(groupsOf(st));
      for (const g of e.group.split(';')) if (g.trim()) groups.add(g.trim());
      st.group = [...groups].slice(0, 6).join(';');
    }
    if (!st.sources.some(s => s.url === e.url)) {
      const src = { url: e.url, name: e.name };
      for (const k of ['br', 'codec', 'hls', 'uuid', 'rbOk']) if (e[k]) src[k] = e[k];
      st.sources.push(src);
    }
  }
  return [...map.values()];
}

/* Radio Browser: a community-run API with several mirrors; pick one at random, fall back to the others. */
const RB = { servers: null, base: '' };
async function rbServers() {
  if (RB.servers) return RB.servers;
  let names = [];
  try {
    const r = await timed('https://all.api.radio-browser.info/json/servers', 5000);
    names = (await r.res.json()).map(s => s.name);
  } catch { /* use the fallback list */ }
  names = [...new Set(names)].sort(() => Math.random() - 0.5);
  if (!names.length) names = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
  return (RB.servers = names.map(n => 'https://' + n));
}
async function rbFetch(path) {
  for (const base of await rbServers()) {
    try {
      const r = await fetch(`${base}/json/${path}`, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      RB.base = base;
      return await r.json();
    } catch { /* try the next mirror */ }
  }
  throw new Error('Radio Browser isn’t reachable right now. Try again in a minute.');
}

async function fetchText(url) {
  try {
    const r = await fetch(effectiveUrl(url), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) {
    throw new Error(`Couldn’t download the list (${e.message}). The server may block browsers (CORS): download the file and upload it instead.`);
  }
}
async function loadEntries(list) {
  if (list.kind === 'rb') return (await rbFetch(list.query)).map(rbEntry);
  if (list.kind === 'soma') return somaEntries(JSON.parse(await fetchText(SOMA_URL)));
  return parseText(await fetchText(list.url), list.genre);
}

/* =========================================================================
   Health: what we know about each stream, and the badge it gets
   ========================================================================= */
function H(url) {
  let h = S.health.get(url);
  if (!h) {
    h = { url, plays: 0, ok: 0, slow: 0, fails: 0, stalls: 0, avgStartMs: 0, lastStartMs: 0,
          lastResult: '', lastNote: '', lastPlay: 0, probe: null, rating: '', kind: '' };
    S.health.set(url, h);
  }
  return h;
}
function saveH(h) {
  DB.put('health', h);
  scheduleRender();
  if (S.current && S.current.sources.some(s => s.url === h.url)) renderNow();
}
const mk = (cls, label, tip) => ({ cls, label, tip });
const RANK = { good: 0, warn: 1, untested: 2, blocked: 3, bad: 4 };

function fromHistory(h) {
  const tip = `You played it ${h.plays}×: ${h.fails} failed, ${h.stalls} with dropouts`;
  if (h.lastResult === 'fail') return mk('bad', 'Failed', `Failed last time (${h.lastNote || 'error'}). ${tip}`);
  if (h.plays >= 3 && h.fails / h.plays >= 0.5) return mk('bad', 'Unreliable', tip);
  if (h.lastResult === 'stall') return mk('warn', 'Drops out', `Kept dropping out last time. ${tip}`);
  if (h.lastResult === 'slow') return mk('warn', 'Slow start', `Took ${fmtS(h.lastStartMs)} to start. ${tip}`);
  return mk('good', 'Played', `Started in ${fmtS(h.lastStartMs)}. ${tip}`);
}
function fromProbe(p) {
  const tip = `${p.note ? p.note + '. ' : ''}Tested ${ago(p.at)}`;
  switch (p.status) {
    case 'ok': return mk('good', 'On air', tip);
    case 'slow': return mk('warn', 'Weak', tip);
    case 'dead': return mk('bad', 'Off air', tip);
    case 'blocked': return mk('blocked', 'Blocked', tip);
  }
  return mk('untested', '', tip);
}
function sourceStatus(src) {
  const h = S.health.get(src.url);
  if (h?.rating === 'good') return mk('good', 'Clear ★', 'You rated this clear');
  if (h?.rating === 'buffers') return mk('warn', 'Drops ★', 'You rated this as dropping out');
  if (h?.rating === 'broken') return mk('bad', 'Broken ★', 'You rated this broken');
  const hist = h?.lastPlay ? fromHistory(h) : null;
  const pr = h?.probe ? fromProbe(h.probe) : null;
  if (hist && pr) return h.lastPlay >= h.probe.at ? hist : pr; // newest evidence wins
  if (hist || pr) return hist || pr;
  if (isMixed(src.url)) return mk('untested', 'HTTP', 'Plain-HTTP stream: browsers may block it on this HTTPS page');
  return mk('untested', '', 'Not tested yet');
}
function orderedSources(st) {
  return st.sources
    .map((s, i) => ({ s, r: RANK[sourceStatus(s).cls] + (isMixed(s.url) ? 0.5 : 0), i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.s);
}
function stationStatus(st) {
  if (st.sources.length === 1) return sourceStatus(st.sources[0]);
  let best = null, working = 0;
  for (const s of st.sources) {
    const ss = sourceStatus(s);
    if (RANK[ss.cls] <= 1) working++;
    if (!best || RANK[ss.cls] < RANK[best.cls]) best = ss;
  }
  return { ...best, tip: `${best.tip} · ${st.sources.length} links${working ? `, ${working} working` : ''}` };
}
const isBadCls = cls => cls === 'bad' || cls === 'blocked';
const lastSeen = src => { const h = S.health.get(src.url); return Math.max(h?.probe?.at || 0, h?.lastPlay || 0); };
const isFresh = src => !!S.health.get(src.url)?.rating || lastSeen(src) > Date.now() - FRESH_FOR;
const hasFreshWorking = st => st.sources.some(s => isFresh(s) && RANK[sourceStatus(s).cls] <= 1);
// Best known format: what the test measured, else what the list says.
function formatOf(src) {
  const p = S.health.get(src.url)?.probe;
  const codec = p?.codec || src.codec || '';
  const kbps = p?.kbps || src.br || 0;
  return [codec, kbps ? kbps + 'k' : ''].filter(Boolean).join(' ');
}

/* =========================================================================
   Stream tester — same approach as M3U TV: read only the start of the stream,
   at most 2 tests per server at once, skip servers already known to be down.
   Radio twist: the <audio> element plays cross-origin streams without CORS, so a
   CORS refusal isn't the end — we check whether audio actually starts instead.
   ========================================================================= */
async function readFirst(res, maxBytes, maxMs) {
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0, done = false;
  const t0 = performance.now();
  try {
    while (bytes < maxBytes && performance.now() - t0 < maxMs) {
      // A live stream that sends little data can block a read for long: stop at the time limit and judge what arrived.
      let timer;
      const r = await Promise.race([reader.read(), new Promise(res => { timer = setTimeout(() => res(null), maxMs - (performance.now() - t0)); })]);
      clearTimeout(timer);
      if (!r) break;
      if (r.done) { done = true; break; }
      chunks.push(r.value);
      bytes += r.value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(bytes);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return { data: all, ms: performance.now() - t0, done };
}

/* Look at the first bytes: which codec, and its real bitrate (MP3 and AAC headers carry it). */
const MP3_BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_SR = [44100, 48000, 32000];
const AAC_SR = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function sniffAudio(d) {
  let i = 0;
  if (d[0] === 0x49 && d[1] === 0x44 && d[2] === 0x33 && d.length > 10) i = 10 + ((d[6] << 21) | (d[7] << 14) | (d[8] << 7) | d[9]); // skip ID3 tag
  const ascii = String.fromCharCode(...d.slice(i, i + 4));
  if (ascii === 'OggS') return { codec: /OpusHead/.test(String.fromCharCode(...d.slice(i, i + 64))) ? 'OPUS' : 'OGG', mime: 'audio/ogg' };
  if (ascii === 'fLaC') return { codec: 'FLAC', mime: 'audio/flac' };
  const end = Math.min(d.length - 8, i + 16384);
  for (; i < end; i++) {
    if (d[i] !== 0xff) continue;
    const b1 = d[i + 1];
    if ((b1 & 0xf6) === 0xf0) { // AAC in ADTS frames: average the frame sizes
      const sr = AAC_SR[(d[i + 2] >> 2) & 0xf];
      let j = i, frames = 0, bytes = 0;
      while (j + 7 < d.length && d[j] === 0xff && (d[j + 1] & 0xf6) === 0xf0 && frames < 200) {
        const len = ((d[j + 3] & 3) << 11) | (d[j + 4] << 3) | (d[j + 5] >> 5);
        if (len < 7) break;
        bytes += len; frames++; j += len;
      }
      if (frames >= 3 && sr) return { codec: 'AAC', mime: 'audio/aac', bps: Math.round((bytes / frames) * 8 * sr / 1024) };
    } else if ((b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 3) === 1) { // MPEG layer III (MP3)
      const ver = (b1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
      if (ver === 1) continue;
      let j = i, frames = 0, sum = 0;
      while (j + 4 < d.length && d[j] === 0xff && (d[j + 1] & 0xe0) === 0xe0 && frames < 60) {
        const kb = MP3_BR[ver === 3 ? 1 : 2][d[j + 2] >> 4];
        const sr = MP3_SR[(d[j + 2] >> 2) & 3] / (ver === 3 ? 1 : ver === 2 ? 2 : 4);
        if (!kb || !sr) break;
        const len = Math.floor((ver === 3 ? 144 : 72) * kb * 1000 / sr) + ((d[j + 2] >> 1) & 1);
        sum += kb; frames++; j += len;
      }
      if (frames >= 3) return { codec: 'MP3', mime: 'audio/mpeg', bps: Math.round(sum / frames) * 1000 };
    }
  }
  return {};
}
const canPlay = mime => !mime || !!document.createElement('audio').canPlayType(mime);

/* Playlist files (.pls, .m3u, .asx, .xspf) that only point at the real stream. */
function firstStreamIn(text, base) {
  const m = text.match(/^\s*File\d+\s*=\s*(\S+)/im) || text.match(/<ref\s+href\s*=\s*"([^"]+)"/i) ||
            text.match(/<location>\s*([^<\s]+)\s*<\/location>/i) ||
            text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && /^(https?:\/\/|\/|[\w.-]+\/)/i.test(l)).map(l => [l, l])[0];
  if (!m) return '';
  try { return new URL(m[1].replace(/^icy:/i, 'http:'), base).href; } catch { return ''; }
}
const looksLikePlaylistText = (ct, head) =>
  /mpegurl|scpls|x-ms-asf|xspf|text\//.test(ct) || /^(#EXTM3U|\[playlist\]|<asx|<\?xml|<playlist|https?:\/\/)/i.test(head);

/* Real playback check without CORS: does an <audio> element manage to start? (muted, never heard) */
let audioSlots = 0;
const audioWaiters = [];
async function audioProbe(url, ms = 10000) {
  if (audioSlots >= 2) await new Promise(r => audioWaiters.push(r));
  audioSlots++;
  const a = new Audio();
  a.muted = true;
  a.preload = 'auto';
  const t0 = performance.now();
  try {
    return await new Promise(res => {
      const timer = setTimeout(() => res({ ok: false, timeout: true, note: `No audio within ${ms / 1000}s` }), ms);
      a.oncanplay = () => { clearTimeout(timer); res({ ok: true, ms: Math.round(performance.now() - t0) }); };
      a.onerror = () => {
        clearTimeout(timer);
        const code = a.error?.code;
        res({ ok: false, note: code === 3 ? 'Audio can’t be decoded' : code === 4 ? 'Offline, or a format this browser can’t play' : 'Network error' });
      };
      a.src = url;
      a.load();
    });
  } finally {
    a.removeAttribute('src');
    a.load();
    audioSlots--;
    audioWaiters.shift()?.();
  }
}

async function probe(url, depth = 0) {
  const target = effectiveUrl(url);
  const base = { at: Date.now() };
  const t0 = performance.now();
  let r;
  try {
    r = await timed(target, 8000);
  } catch (e) {
    if (isTimeout(e)) return { ...base, status: 'dead', scope: 'host', note: 'No response within 8s' };
    // Network error or CORS: radio still plays without CORS, so try for real.
    const a = await audioProbe(target);
    if (a.ok) {
      return { ...base, kind: 'native', status: a.ms > S.settings.slowStartSec * 1000 ? 'slow' : 'ok', ms: a.ms,
               note: `Audio starts in ${fmtS(a.ms)} (server hides details from web pages, so speed wasn’t measured)` };
    }
    if (target !== url) return { ...base, status: 'blocked', scope: 'host', note: 'HTTP-only stream: browsers block it on an HTTPS page' };
    return { ...base, status: 'dead', scope: a.timeout ? 'host' : undefined, note: a.note };
  }
  base.ms = Math.round(performance.now() - t0);
  try {
    if (!r.res.ok) { r.abort(); return { ...base, status: 'dead', note: `Server error (HTTP ${r.res.status})` }; }
    const ct = (r.res.headers.get('content-type') || '').toLowerCase();
    const finalUrl = r.res.url || target;
    const first = await readFirst(r.res, 320 * 1024, 3000);
    r.abort();
    const head = new TextDecoder().decode(first.data.slice(0, 64)).replace(/^﻿/, '').trimStart();
    if (looksLikePlaylistText(ct, head)) {
      const text = new TextDecoder().decode(first.data);
      if (head.startsWith('#EXTM3U') && text.includes('#EXT-X-')) return { kind: 'hls', ...(await probeHls(text, finalUrl, base)) };
      if (/^<!doctype html|^<html/i.test(head)) return { ...base, status: 'dead', note: 'Returns a web page, not audio' };
      const next = firstStreamIn(text, finalUrl);
      if (!next) return { ...base, status: 'dead', note: 'Playlist file lists no streams' };
      if (depth >= 2) return { ...base, status: 'dead', note: 'Too many nested playlist files' };
      const p = await probe(next, depth + 1);
      return { ...p, resolved: p.resolved || next, note: `Via playlist file. ${p.note || ''}`.trim() };
    }
    const au = sniffAudio(first.data);
    const mime = au.mime || (ct.startsWith('audio/') ? ct.split(';')[0] : '');
    const fmt = au.codec || (mime ? mime.replace(/^audio\/(x-)?/, '').toUpperCase() : '');
    if (mime && !canPlay(mime)) return { ...base, kind: 'native', codec: fmt, status: 'blocked', note: `This browser can’t play ${fmt || mime}` };
    if (first.done && first.data.length < 64 * 1024) {
      // Some big CDNs (e.g. StreamTheWorld) cut off plain reads after a short burst but play fine in <audio>.
      const a = await audioProbe(target);
      if (a.ok) return { ...base, kind: 'native', codec: au.codec || fmt, kbps: au.bps ? Math.round(au.bps / 1000) : 0,
                         status: a.ms > S.settings.slowStartSec * 1000 ? 'slow' : 'ok', note: `Audio starts in ${fmtS(a.ms)} (${fmt || 'audio'}${au.bps ? ' ' + Math.round(au.bps / 1000) + ' kbit/s' : ''})` };
      return { ...base, status: 'dead', note: `Server closed the stream after ${Math.round(first.data.length / 1024)} KB` };
    }
    if (first.data.length < 4096) return { ...base, status: 'slow', note: `Responds in ${base.ms} ms but sends almost no audio` };
    // How fast it arrives vs. how fast it plays. Most servers send a burst first, which is a good sign.
    const src = S.byUrl.get(url)?.sources?.find(s => s.url === url);
    const contentBps = au.bps || (src?.br ? src.br * 1000 : 0) || 128000;
    const guessed = !au.bps && !src?.br;
    const dlBps = (first.data.length * 8) / (Math.max(first.ms, 30) / 1000);
    const ratio = dlBps / contentBps;
    const kbps = Math.round(contentBps / 1000);
    const what = `${fmt || 'Audio'}${guessed ? '' : ` ${kbps} kbit/s`}`;
    let status = 'ok';
    let note = `Responds in ${base.ms} ms · ${what} · arrives ${ratio.toFixed(1)}× faster than it plays`;
    if (ratio < 0.85) { status = 'slow'; note = `${what} arrives slower than it plays (${ratio.toFixed(1)}×), so it will drop out`; }
    else if (base.ms > 5000) status = 'slow';
    return { ...base, kind: 'native', codec: au.codec || fmt, kbps: guessed ? 0 : kbps, status, ratio: +ratio.toFixed(1), note };
  } catch (e) {
    r.abort();
    if (isTimeout(e)) return { ...base, status: 'slow', note: 'Responded, then stalled' };
    return { ...base, status: 'dead', note: String(e.message || e) };
  }
}

async function probeHls(text, baseUrl, base) {
  let lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let bandwidth = 0;
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) {
    let uri = null, best = Infinity;
    lines.forEach((l, i) => {
      if (!l.startsWith('#EXT-X-STREAM-INF')) return;
      const bw = +(l.match(/[:,]BANDWIDTH=(\d+)/) || [])[1] || Infinity;
      const u = lines.slice(i + 1).find(x => !x.startsWith('#'));
      if (u && (uri === null || bw < best)) { uri = u; best = bw; }
    });
    if (!uri) return { ...base, status: 'dead', note: 'Playlist lists no streams' };
    bandwidth = Number.isFinite(best) ? best : 0;
    const vurl = new URL(uri, baseUrl).href;
    const r = await timed(vurl, 8000);
    if (!r.res.ok) { r.abort(); return { ...base, status: 'dead', note: `Stream playlist missing (HTTP ${r.res.status})` }; }
    text = await r.res.text();
    r.abort();
    baseUrl = r.res.url || vurl;
    lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  const segs = [];
  let pend = null;
  for (const l of lines) {
    if (l.startsWith('#EXTINF:')) pend = parseFloat(l.slice(8)) || 0;
    else if (!l.startsWith('#') && pend !== null) { segs.push({ d: pend, u: l }); pend = null; }
  }
  if (!segs.length) return { ...base, status: 'dead', note: 'Stream has no audio segments' };
  const live = !lines.some(l => l.startsWith('#EXT-X-ENDLIST'));
  const seg = live ? segs[Math.max(0, segs.length - 2)] : segs[0];
  let r;
  try {
    r = await timed(new URL(seg.u, baseUrl).href, 10000);
  } catch (e) {
    if (isTimeout(e)) return { ...base, status: 'slow', note: 'Audio segments respond too slowly' };
    return { ...base, status: 'blocked', note: 'Audio segments are blocked for web players (CORS)' };
  }
  let part;
  try {
    if (!r.res.ok) { r.abort(); return { ...base, status: 'dead', note: `Audio segments missing (HTTP ${r.res.status})` }; }
    part = await readFirst(r.res, 512 * 1024, 4000);
    r.abort();
  } catch {
    r.abort();
    return { ...base, status: 'slow', note: 'Audio segment download stalled' };
  }
  const len = +r.res.headers.get('content-length') || (part.done ? part.data.length : 0);
  const contentBps = len && seg.d ? (len * 8) / seg.d : bandwidth;
  const dlBps = (part.data.length * 8) / (Math.max(part.ms, 30) / 1000);
  const ratio = contentBps ? dlBps / contentBps : 0;
  const kbps = contentBps ? Math.round(contentBps / 1000) : 0;
  let status = 'ok';
  let note = ratio ? `Responds in ${base.ms} ms · HLS ${kbps} kbit/s · arrives ${ratio.toFixed(1)}× faster than it plays`
                   : `Responds in ${base.ms} ms · HLS`;
  if (ratio && ratio < 1) { status = 'slow'; note = `Audio arrives slower than it plays (${ratio.toFixed(1)}×), so it will drop out`; }
  else if (base.ms > 5000) status = 'slow';
  return { ...base, status, codec: 'HLS', kbps, ratio: +ratio.toFixed(1), note };
}

function noteHost(url, p) {
  const host = hostOf(url);
  const hs = S.hosts.get(host) || { ok: 0, blocked: 0, dead: 0 };
  if (p.status === 'ok' || p.status === 'slow') hs.ok++;
  else if (p.scope === 'host') hs[p.status === 'blocked' ? 'blocked' : 'dead']++;
  S.hosts.set(host, hs);
}
// If other streams on the same server were all blocked/unreachable, don't bother testing this one.
function inferFromHost(url) {
  const hs = S.hosts.get(hostOf(url));
  if (!hs || hs.ok) return null;
  const at = Date.now();
  if (hs.blocked >= 2) return { at, status: 'blocked', inferred: true, note: 'Not tested: other stations on this server are blocked in browsers' };
  if (hs.dead >= 2) return { at, status: 'dead', inferred: true, note: 'Not tested: this server didn’t respond for other stations' };
  return null;
}
const nextTestable = st => orderedSources(st).find(s => !isFresh(s) && !T.queued.has(s.url));

const PER_HOST = 2;
const T = { queue: [], queued: new Set(), force: new Set(), hostActive: new Map(), activeUrls: new Set(), active: 0, done: 0, total: 0, manual: false };
function queueTests(urls, { manual = false, force = false, front = false } = {}) {
  if (manual) { T.queue = []; T.queued.clear(); T.done = 0; T.total = T.active; T.manual = true; }
  const add = [];
  for (const u of urls) {
    if (T.queued.has(u)) continue;
    T.queued.add(u);
    if (force) T.force.add(u);
    add.push(u);
    T.total++;
  }
  if (front) T.queue.unshift(...add); else T.queue.push(...add);
  pump();
  updateTestUi();
}
function stopTests() {
  for (const u of T.queue) T.queued.delete(u);
  T.total -= T.queue.length;
  T.queue = [];
  T.manual = false;
  updateTestUi();
}
function pickNext() {
  const lim = Math.min(T.queue.length, 300);
  for (let i = 0; i < lim; i++) {
    if ((T.hostActive.get(hostOf(T.queue[i])) || 0) < PER_HOST) return T.queue.splice(i, 1)[0];
  }
  return null;
}
function finishTest(url) {
  T.done++;
  T.queued.delete(url);
  T.force.delete(url);
  if (!T.active && !T.queue.length) { T.manual = false; T.done = T.total = 0; }
  updateTestUi();
}
function recordProbe(url, p) {
  const h = H(url);
  if (p.kind) h.kind = p.kind;
  h.probe = p;
  if (p.status === 'ok') lightUp(S.byUrl.get(url));
  saveH(h);
  if (!p.inferred) noteHost(url, p);
  // This link is bad: test the station's next backup link right away.
  if (isBadCls(fromProbe(p).cls)) {
    const st = S.byUrl.get(url);
    const next = st && !hasFreshWorking(st) && nextTestable(st);
    if (next) queueTests([next.url], { front: true });
  }
}
function pump() {
  while (T.active < S.settings.concurrency && T.queue.length) {
    const url = pickNext();
    if (!url) break;
    const inferred = !T.force.has(url) && inferFromHost(url);
    if (inferred) { recordProbe(url, inferred); finishTest(url); continue; }
    const host = hostOf(url);
    T.active++;
    T.activeUrls.add(url);
    T.hostActive.set(host, (T.hostActive.get(host) || 0) + 1);
    scheduleRender();
    probe(url)
      .catch(e => ({ at: Date.now(), status: 'dead', note: String(e.message || e) }))
      .then(p => recordProbe(url, p))
      .finally(() => {
        T.active--;
        T.activeUrls.delete(url);
        T.hostActive.set(host, T.hostActive.get(host) - 1);
        finishTest(url);
        pump();
      });
  }
}
function updateTestUi() {
  const busy = T.active > 0 || T.queue.length > 0;
  $('#testBtn').textContent = T.manual && busy ? 'Stop testing' : 'Test stations';
  $('#testProgress').textContent = busy ? `Checking ${T.done}/${T.total}…` : '';
  $('#scanBar').classList.toggle('on', busy);
  scheduleRender();
}
function lightUp(st) { if (st?.key) S.lit.set(st.key, Date.now()); }
function testState(st) {
  if (st.sources.some(s => T.activeUrls.has(s.url))) return 'checking';
  if (st.sources.some(s => T.queued.has(s.url))) return 'queued';
  return '';
}
function testUrlsFor(stations) {
  const urls = [];
  for (const st of stations) {
    if (hasFreshWorking(st)) continue;
    const s = nextTestable(st);
    if (s) urls.push(s.url);
  }
  return urls;
}
function autoTestVisible() {
  if (!S.settings.autoTest) return;
  const list = $('#list');
  const start = Math.floor(list.scrollTop / ROW);
  const end = Math.min(S.filtered.length, Math.ceil((list.scrollTop + listHeight()) / ROW));
  const urls = testUrlsFor(S.filtered.slice(start, end));
  if (urls.length) queueTests(urls);
}

/* =========================================================================
   Station guide (virtualized — handles lists with tens of thousands of entries)
   ========================================================================= */
const ROW = 70;
const listHeight = () => $('#list').clientHeight || window.innerHeight || 800;
let renderPending = false;
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  const go = () => { if (renderPending) { renderPending = false; renderList(); } };
  requestAnimationFrame(go);
  setTimeout(go, 100); // rAF doesn't fire in background tabs
}
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
function countryName(cc) {
  const iso = cc === 'uk' ? 'GB' : cc.toUpperCase();
  try { return regionNames?.of(iso) || iso; } catch { return iso; }
}
const countryFlag = cc => (/^[a-z]{2}$/.test(cc || '') ? [...(cc === 'uk' ? 'gb' : cc).toUpperCase()].map(c => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0))).join('') : '');
const BARS = { good: '▮▮▮▮', warn: '▮▮▯▯', bad: '▯▯▯▯', blocked: '✕', untested: '····' };
const badgeHtml = (st, fallback = '') =>
  `<span class="badge ${st.cls}" aria-label="${esc(st.label || fallback || 'Untested')}"><i aria-hidden="true">${BARS[st.cls] || ''}</i>${esc(st.label || fallback)}</span>`;
const stNum = st => S.numByKey.get(st.key) ?? '★';
const groupsOf = st => (st.group || '').split(';').map(g => g.trim()).filter(Boolean);
const groupLabel = st => groupsOf(st).join(', ');
const bestBr = st => Math.max(0, ...st.sources.map(s => S.health.get(s.url)?.probe?.kbps || s.br || 0));

function renderList() {
  const list = $('#list');
  const inner = $('#listInner');
  const n = S.filtered.length;
  list.setAttribute('aria-activedescendant', S.cursor >= 0 && S.cursor < n ? 'ch-' + S.cursor : '');
  if (!n) {
    inner.style.height = 'auto';
    inner.innerHTML = S.loading
      ? `<div class="empty"><div class="spinner"></div>${esc(S.loading)}</div>`
      : !S.lists.length
        ? '<div class="empty">No station list yet.<br><button class="primary" data-act="add">+ Add a list</button></div>'
        : S.ui.status === 'fav' && !S.favs.size
          ? '<div class="empty">No favorites yet.<br>Tap ☆ next to a station to save it here.</div>'
          : S.ui.status === 'recent' && !S.recent.length
            ? '<div class="empty">Nothing played yet.<br>Stations you play show up here.</div>'
            : '<div class="empty">No stations match.</div>';
    return;
  }
  inner.style.height = n * ROW + 'px';
  const start = Math.max(0, Math.floor(list.scrollTop / ROW) - 6);
  const end = Math.min(n, Math.ceil((list.scrollTop + listHeight()) / ROW) + 6);
  let html = '';
  for (let i = start; i < end; i++) {
    const st = S.filtered[i];
    const ss = stationStatus(st);
    const fav = S.favs.has(st.key);
    const active = S.current && S.current.key === st.key;
    const fmt = formatOf(orderedSources(st)[0]);
    const meta = [countryFlag(st.country), groupLabel(st), fmt, st.sources.length > 1 ? `${st.sources.length} links` : ''].filter(Boolean).join(' · ');
    const good = ss.cls === 'good';
    const litAgo = good ? Date.now() - (S.lit.get(st.key) || 0) : Infinity;
    const lit = litAgo < 1200 ? ' lit' : '';
    const ts = testState(st);
    const badge = ts === 'checking'
      ? '<span class="badge checking"><i class="mini-spin" aria-hidden="true"></i>Checking…</span>'
      : ts === 'queued' && ss.cls === 'untested'
        ? '<span class="badge queued"><i aria-hidden="true">···</i>Queued</span>'
        : badgeHtml(ss);
    html += `<div class="ch${active ? ' active' : ''}${i === S.cursor ? ' cursor' : ''}${isBadCls(ss.cls) ? ' dead' : RANK[ss.cls] <= 1 ? ' ok' : ''}${ts ? ' ' + ts : ''}${lit}" id="ch-${i}" role="option" aria-selected="${i === S.cursor}" data-i="${i}" style="top:${i * ROW}px" title="${esc(st.name + ' — ' + ss.tip)}">
      <span class="ch-num">${stNum(st)}</span>
      <div class="ch-body">
        <div class="logo">${st.logo ? `<img src="${esc(st.logo)}" loading="lazy" referrerpolicy="no-referrer" alt="" onerror="this.remove()">` : '♪'}</div>
        <div class="info">
          <div class="name">${esc(st.name)}</div>
          <div class="meta">${badge}<span class="grp">${esc(meta)}</span></div>
        </div>
        <button class="star${fav ? ' on' : ''}" data-star="${i}" tabindex="-1" title="${fav ? 'Remove from' : 'Add to'} favorites" aria-label="${fav ? 'Remove from' : 'Add to'} favorites">${fav ? '★' : '☆'}</button>
      </div>
    </div>`;
  }
  inner.innerHTML = html;
}
function passFilter(cls, f) {
  if (f === 'good') return cls === 'good';
  if (f === 'hideBad') return !isBadCls(cls);
  if (f === 'untested') return cls === 'untested';
  return true;
}
function sourceStations() {
  if (S.ui.status === 'fav') return [...S.favs.values()].map(f => S.byKey.get(f.key) || f).sort((a, b) => a.name.localeCompare(b.name));
  if (S.ui.status === 'recent') return S.recent.map(r => S.byKey.get(r.key) || r);
  return S.stations;
}
function rebuildGroups() {
  const src = sourceStations();
  const counts = new Map();
  const countries = new Map();
  for (const c of src) {
    for (const g of groupsOf(c)) counts.set(g, (counts.get(g) || 0) + 1);
    if (c.country) countries.set(c.country, (countries.get(c.country) || 0) + 1);
  }
  // Radio Browser has thousands of tags: offer the 200 most common, alphabetically.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([g]) => g).sort((a, b) => a.localeCompare(b));
  if (!groups.includes(S.ui.group)) S.ui.group = '';
  const gsel = $('#groupFilter');
  gsel.classList.toggle('hidden', groups.length < 2);
  gsel.innerHTML = `<option value="">Genre: all</option>` +
    groups.map(g => `<option value="${esc(g)}"${g === S.ui.group ? ' selected' : ''}>${esc(g)} (${counts.get(g)})</option>`).join('');
  const ccs = [...countries.keys()].map(cc => [cc, countryName(cc)]).sort((a, b) => a[1].localeCompare(b[1]));
  if (!countries.has(S.ui.country)) S.ui.country = '';
  const sel = $('#countryFilter');
  sel.classList.toggle('hidden', ccs.length < 2);
  sel.innerHTML = `<option value="">Country: all</option>` +
    ccs.map(([cc, name]) => `<option value="${cc}"${cc === S.ui.country ? ' selected' : ''}>${countryFlag(cc)} ${esc(name)} (${countries.get(cc)})</option>`).join('');
}
let scrollIdle, searchTimer, hoverTimer;
function applyFilters(keepScroll = false) {
  const q = S.ui.search.toLowerCase().trim();
  const g = S.ui.group, cc = S.ui.country, f = S.ui.status;
  const needStatus = ['good', 'hideBad', 'untested'].includes(f) || S.ui.sort === 'best';
  const rows = [];
  for (const st of sourceStations()) {
    if (q && !st.name.toLowerCase().includes(q) && !(st.group || '').toLowerCase().includes(q)) continue;
    if (g && !groupsOf(st).includes(g)) continue;
    if (cc && st.country !== cc) continue;
    const cls = needStatus ? stationStatus(st).cls : '';
    if (!passFilter(cls, f)) continue;
    rows.push({ st, r: RANK[cls] ?? 0 });
  }
  if (S.ui.sort === 'best') rows.sort((a, b) => a.r - b.r);
  else if (S.ui.sort === 'name') rows.sort((a, b) => a.st.name.localeCompare(b.st.name));
  else if (S.ui.sort === 'br') rows.sort((a, b) => bestBr(b.st) - bestBr(a.st));
  S.filtered = rows.map(x => x.st);
  S.cursor = S.current ? S.filtered.findIndex(c => c.key === S.current.key) : -1;
  const total = sourceStations().length;
  $('#count').textContent = S.filtered.length === total ? `${total} stations` : `${S.filtered.length} of ${total}`;
  if (!keepScroll) $('#list').scrollTop = 0;
  renderList();
  Radio.needle();
  clearTimeout(scrollIdle);
  scrollIdle = setTimeout(autoTestVisible, 400);
}
function scrollToIndex(i) {
  if (i < 0) return;
  const list = $('#list');
  const y = i * ROW;
  if (y < list.scrollTop || y + ROW > list.scrollTop + listHeight()) list.scrollTop = y - listHeight() / 2 + ROW / 2;
}
function scrollToCurrent() { if (S.current) scrollToIndex(S.filtered.findIndex(c => c.key === S.current.key)); }
function moveCursor(to) {
  const n = S.filtered.length;
  if (!n) return;
  S.cursor = Math.max(0, Math.min(n - 1, to));
  scrollToIndex(S.cursor);
  scheduleRender();
  preconnect(orderedSources(S.filtered[S.cursor])[0].url);
}
const cursorStart = () => (S.cursor >= 0 ? S.cursor : S.current ? Math.max(0, S.filtered.findIndex(c => c.key === S.current.key)) : -1);
const pageRows = () => Math.max(1, Math.floor(listHeight() / ROW) - 1);

/* =========================================================================
   Playback: the browser plays Icecast/Shoutcast/MP3/AAC itself, hls.js handles
   HLS. A station's links are tried best-first; if one fails or hangs, the next
   one takes over. Every attempt is measured and remembered.
   ========================================================================= */
const audio = $('#audio');
let hls = null, engine = '', nativeFail = null;
let playToken = 0, session = null, startTimer = null;

/* The radio itself: 10-band scale, needle, LEDs, knobs. How its controls map to the app:
   BAND = your station lists (FM = first list, MW = second, SW1–SW8 = the next eight),
   TUNING = move through the stations, POWER = play/stop, SENS DX/LOCAL = all / hide broken,
   MEMORY = favorite, LIGHT = dial lamp + effects. */
const BANDS = [
  ['FM', '', ['76', '80', '84', '88', '92', '96', '100', '104', '108'], 'MHz'],
  ['MW', '', ['530', '600', '700', '800', '1000', '1200', '1400', '1600'], 'kHz'],
  ['SW1', '49m', ['5.95', '6.05', '6.15', '6.20'], 'MHz'],
  ['SW2', '41m', ['7.10', '7.20', '7.30'], 'MHz'],
  ['SW3', '31m', ['9.50', '9.70', '9.90'], 'MHz'],
  ['SW4', '25m', ['11.65', '11.85', '12.05'], 'MHz'],
  ['SW5', '22m', ['13.60', '13.70', '13.80'], 'MHz'],
  ['SW6', '19m', ['15.10', '15.35', '15.60'], 'MHz'],
  ['SW7', '16m', ['17.55', '17.70', '17.90'], 'MHz'],
  ['SW8', '13m', ['21.45', '21.65', '21.85'], 'MHz'],
];
const bandLabel = i => (i < BANDS.length ? BANDS[i][0] : 'EXT' + (i - BANDS.length + 1));
const Radio = (() => {
  const needleEl = $('#needle');
  const ON = ['live', 'buffering', 'tuning', 'nosignal'];
  const api = {
    state: 'standby', // standby | tuning | live | buffering | nosignal | stopped
    setState(s) {
      api.state = s;
      const on = ON.includes(s) && !!session;
      document.body.classList.toggle('onair', s === 'live' || s === 'buffering');
      document.body.classList.toggle('playing', s === 'live');
      $('#playBtn').classList.toggle('on', on);
      $('#playBtn').setAttribute('aria-pressed', on);
      $('#powerLed').classList.toggle('on', on);
      $('#tuneLed').className = 'led ' + ({ live: 'good', buffering: 'warn', tuning: 'warn', nosignal: 'bad' }[s] || '');
      VFD.update();
    },
    // The tuning scale is the guide as it's shown now: numbered 1…n, the needle at the current station.
    needle(i = S.current ? S.filtered.findIndex(c => c.key === S.current.key) : -1) {
      const n = S.filtered.length;
      const frac = i < 0 || n < 2 ? (i < 0 ? 0 : 0.5) : i / (n - 1);
      needleEl.style.setProperty('--f', frac);
      needleEl.classList.toggle('hidden', i < 0);
      if (n !== scaleN) {
        scaleN = n;
        const marks = n < 2 ? [] : [...new Set([0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => Math.round(1 + k * (n - 1) / 8)))];
        $('#tuneNums').innerHTML = marks.map(m => `<i style="left:calc(var(--sl) + (100% - var(--sl) - var(--sr)) * ${(m - 1) / (n - 1)})">${m}</i>`).join('');
      }
    },
    // Band strip: one button per list (FM = first, MW = second, SW1–SW8 = the next eight).
    bands(active = S.lists.findIndex(p => p.id === S.ui.currentId)) {
      $('#bands').innerHTML = BANDS.map(([b, m], i) =>
        `<button type="button" class="band-btn${i === active ? ' active' : ''}" data-band="${i}"${i >= S.lists.length ? ' disabled' : ''} aria-pressed="${i === active}" title="${esc(S.lists[i]?.name || 'No list on this band yet: add one with + List')}">${b}${m ? `<em>${m}</em>` : ''}</button>`).join('');
      $('#bandName').textContent = active < 0 ? '—' : `${bandLabel(active)} · ${S.lists[active].name.replace(/^Radio Browser · |^junguler · /, '')}`;
      $('#bandKnob').style.setProperty('--rot', `${-135 + Math.min(active < 0 ? 0 : active, 9) * 30}deg`);
      $('#bandKnob').setAttribute('aria-valuetext', active < 0 ? 'none' : `${bandLabel(active)}: ${S.lists[active].name}`);
    },
    volume(v) {
      $('#volKnob').style.setProperty('--rot', `${-135 + v * 270}deg`);
      $('#volKnob').setAttribute('aria-valuenow', Math.round(v * 100));
      $('#volVal').textContent = Math.round(v * 100);
    },
    refreshFx() {
      document.body.classList.toggle('fx', S.settings.fx);
      $('#lightBtn').classList.toggle('on', S.settings.fx);
      $('#lightBtn').setAttribute('aria-pressed', S.settings.fx);
    },
    syncDx() {
      const local = S.ui.status === 'hideBad';
      $('#dxBtn').classList.toggle('on', local);
      $('#dxBtn').setAttribute('aria-pressed', local);
    },
  };
  return api;
})();

/* A rotary knob: drag around it, scroll on it, or use the arrow keys when it has focus. */
function knob(el, degPerStep, onSteps, onTap) {
  let last = null, acc = 0, moved = false;
  const angle = e => {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); last = angle(e); acc = 0; moved = false; e.preventDefault(); el.focus({ preventScroll: true }); });
  el.addEventListener('pointermove', e => {
    if (last === null) return;
    const a = angle(e);
    let d = a - last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    last = a;
    acc += d;
    if (Math.abs(acc) > 4) moved = true;
    while (Math.abs(acc) >= degPerStep) { const s = Math.sign(acc); acc -= s * degPerStep; onSteps(s); }
  });
  el.addEventListener('pointerup', () => { if (last !== null && !moved && onTap) onTap(); last = null; });
  el.addEventListener('pointercancel', () => { last = null; });
  el.addEventListener('wheel', e => { e.preventDefault(); onSteps(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  el.addEventListener('keydown', e => {
    const s = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (s) { e.preventDefault(); e.stopPropagation(); onSteps(s); }
    else if ((e.key === 'Enter' || e.key === ' ') && onTap) { e.preventDefault(); e.stopPropagation(); onTap(); }
  });
}
let tuneTimer, bandTimer, tuneRot = 0, bandPending = -1, scaleN = -1;
// TUNING: the needle and the guide highlight move at once; the radio tunes in when you stop turning.
function turnTuning(s) {
  const n = S.filtered.length;
  if (!n) return;
  tuneRot += s * 18;
  $('#tuneKnob').style.setProperty('--rot', tuneRot + 'deg');
  const c = cursorStart();
  moveCursor(c < 0 ? 0 : (c + s + n) % n);
  Radio.needle(S.cursor);
  clearTimeout(tuneTimer);
  tuneTimer = setTimeout(() => {
    const st = S.filtered[S.cursor];
    if (!st) return;
    if (session) playStation(st);
    else { S.current = st; S.ui.lastKey = st.key; saveUi(); renderNow(); scheduleRender(); } // power off: just set the dial
  }, 650);
}
// BAND: flip through your lists; it loads once you stop turning.
function turnBand(s) {
  const n = S.lists.length;
  if (!n) return openAddDialog();
  const cur = bandPending >= 0 ? bandPending : Math.max(0, S.lists.findIndex(p => p.id === S.ui.currentId));
  bandPending = (cur + s + n) % n;
  Radio.bands(bandPending);
  clearTimeout(bandTimer);
  bandTimer = setTimeout(() => { const id = S.lists[bandPending]?.id; bandPending = -1; if (id && id !== S.ui.currentId) selectList(id); }, 350);
}
function setVolume(v) {
  audio.volume = Math.min(1, Math.max(0, Math.round(v * 50) / 50));
  Radio.volume(audio.volume);
}

const VFD = (() => {
  const el = id => document.getElementById(id);
  const box = $('#vfd');
  const STATE = {
    standby: ['STANDBY', ''], stopped: ['STOPPED', ''], tuning: ['TUNING…', 'lvl-warn'], live: ['● ON AIR', 'lvl-good'],
    buffering: ['BUFFERING', 'lvl-warn'], nosignal: ['NO SIGNAL', 'lvl-bad'],
  };
  const two = n => String(n).padStart(2, '0');
  function since(ms) {
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
    return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
  }
  function bufferedAhead() {
    const t = audio.currentTime;
    for (let i = 0; i < audio.buffered.length; i++) {
      if (audio.buffered.start(i) <= t + 0.5 && audio.buffered.end(i) >= t) return audio.buffered.end(i) - t;
    }
    return 0;
  }
  function set(id, text, cls = '') {
    const n = el(id);
    if (n.textContent !== text) n.textContent = text;
    n.className = cls;
  }
  function update() {
    const st = S.current;
    const s = session && st && session.st.key === st.key ? session : null;
    const [stateText, stateCls] = STATE[Radio.state] || STATE.standby;
    box.classList.toggle('standby', !st);
    const num = st ? stNum(st) : '---';
    set('vfdNum', typeof num === 'number' ? String(num).padStart(3, '0') : num); // ★ = not in this list (favorite / recent)
    set('vfdName', st ? st.name.toUpperCase() : 'PICK A STATION');
    set('vfdMeta', st ? [countryFlag(st.country) + ' ' + (st.country ? countryName(st.country) : ''), groupLabel(st)].map(x => x.trim()).filter(Boolean).join(' · ')
                      : 'Turn TUNING or pick a station from the guide', 'dial-meta');
    const logo = el('vfdLogo');
    if (st?.logo !== logo.dataset.src) {
      logo.dataset.src = st?.logo || '';
      logo.classList.toggle('hidden', !st?.logo);
      if (st?.logo) { logo.onerror = () => logo.classList.add('hidden'); logo.src = st.logo; }
    }
    set('vfdState', stateText, stateCls);
    if (st) {
      const ss = stationStatus(st);
      set('vfdSig', `${BARS[ss.cls]} ${(ss.label || 'UNTESTED').toUpperCase()}`, 'lvl-' + ss.cls);
    } else set('vfdSig', '····');
    let fmt = '—';
    if (st) {
      const src = s ? s.order[s.idx] : orderedSources(st)[0];
      const lvl = hls?.levels?.[hls.currentLevel];
      fmt = (lvl?.bitrate ? `HLS ${Math.round(lvl.bitrate / 1000)}k` : formatOf(src)) || '—';
    }
    set('vfdFmt', fmt.toUpperCase());
    // Buffer meter: 15 seconds full scale.
    if (s?.started) {
      const sec = bufferedAhead();
      const full = Math.min(6, Math.round(sec / 2.5));
      set('vfdBuf', `${'▮'.repeat(full)}${'▯'.repeat(6 - full)} ${Math.round(sec)}s`, sec < 2 ? 'lvl-bad' : sec < 5 ? 'lvl-warn' : 'lvl-good');
    } else set('vfdBuf', '▯'.repeat(6));
    set('vfdTime', s?.liveAt && Radio.state !== 'stopped' ? since(Date.now() - s.liveAt) : '--:--');
    const kind = { hls: 'HLS', native: 'DIRECT' }[engine] || '';
    set('vfdSrc', s ? `${s.idx + 1}/${s.order.length}${kind ? ' · ' + kind : ''}` : st ? `${st.sources.length} LINK${st.sources.length > 1 ? 'S' : ''}` : '—');
    set('vfdClock', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase());
  }
  setInterval(() => { if (!document.hidden) update(); }, 1000);
  return { update };
})();

function teardown() {
  if (hls) { hls.destroy(); hls = null; }
  nativeFail = null;
  engine = '';
  audio.removeAttribute('src');
  audio.load();
}
function kindOf(url) {
  const p = url.split(/[?#]/)[0].toLowerCase();
  if (p.endsWith('.m3u8')) return 'hls';
  if (/\.(pls|m3u|asx|xspf)$/.test(p)) return 'playlist';
  return '';
}
// A playlist file that points at the stream: read it (when the server allows) to get the real URL.
async function resolvePlaylist(url) {
  try {
    const r = await timed(url, 8000);
    const text = await r.res.text();
    r.abort();
    if (text.includes('#EXT-X-')) return { url, kind: 'hls' };
    const next = firstStreamIn(text, r.res.url || url);
    return next ? { url: next, kind: kindOf(next) === 'hls' ? 'hls' : 'native' } : null;
  } catch {
    return null;
  }
}
function hlsMessage(d) {
  const code = d.response?.code;
  if (d.details === 'manifestLoadError') return code ? `Server returned HTTP ${code}` : 'Server is offline or blocks web players';
  if (d.details === 'manifestLoadTimeOut') return 'Server took too long to answer';
  if (d.details === 'manifestParsingError') return 'Not a valid stream';
  if (/^frag|^level/.test(d.details)) return 'Audio data failed to load';
  return d.details || 'Playback error';
}
const currentSourceUrl = () =>
  (session && S.current && session.st.key === S.current.key ? session.url : S.current && orderedSources(S.current)[0].url);
const hasBackup = () => session && session.idx < session.order.length - 1;

function playStation(st, startUrl) {
  leaveSession();
  teardown();
  S.current = st;
  S.ui.lastKey = st.key;
  const idx = S.filtered.findIndex(c => c.key === st.key);
  if (idx >= 0) S.cursor = idx;
  saveUi();
  let order = orderedSources(st);
  if (startUrl) order = [order.find(s => s.url === startUrl), ...order.filter(s => s.url !== startUrl)].filter(Boolean);
  session = { st, order, idx: -1 };
  scheduleRender();
  scrollToCurrent();
  Radio.needle();
  setMediaSession(st);
  nextSource();
}

function nextSource() {
  const s = session;
  if (!s || s.idx + 1 >= s.order.length) return false;
  s.idx++;
  teardown();
  const token = ++playToken;
  const src = s.order[s.idx];
  Object.assign(s, { url: src.url, t0: performance.now(), started: false, failed: false, recorded: false, stalls: 0, token });
  renderNow();
  Radio.setState('tuning');
  showOverlay('<div class="spinner"></div>' + (s.idx ? `Trying backup link ${s.idx + 1} of ${s.order.length}…` : 'Tuning…'));
  clearTimeout(startTimer);
  startTimer = setTimeout(() => onTimeout(token), S.settings.timeoutSec * 1000);
  (async () => {
    const h = S.health.get(src.url);
    let target = effectiveUrl(h?.probe?.resolved || src.url);
    let kind = h?.kind || (src.hls ? 'hls' : kindOf(target));
    if (kind === 'playlist' || (!h?.probe?.resolved && kindOf(target) === 'playlist')) {
      const r = await resolvePlaylist(target);
      if (r) { target = effectiveUrl(r.url); kind = r.kind; } else kind = 'native';
    }
    if (kind === 'hls' && !audio.canPlayType('application/vnd.apple.mpegurl')) await loadLib('hls').catch(() => {});
    if (token !== playToken) return;
    startEngine(kind, target, token);
  })();
  return true;
}

function startEngine(kind, url, token) {
  const fail = msg => { if (token === playToken) onPlayFail(msg); };
  // Safari plays HLS itself; everywhere else hls.js does it.
  if (kind === 'hls' && !audio.canPlayType('application/vnd.apple.mpegurl')) {
    if (!(window.Hls && Hls.isSupported())) return fail('This browser can’t play HLS streams');
    engine = 'hls';
    hls = new Hls({ enableWorker: true, liveSyncDurationCount: 4, manifestLoadingTimeOut: 10000, levelLoadingTimeOut: 10000, fragLoadingTimeOut: 20000 });
    let recovered = false;
    hls.on(Hls.Events.ERROR, (_, d) => {
      if (!d.fatal) return;
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
      fail(hlsMessage(d));
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => audio.play().catch(() => {}));
    hls.loadSource(url);
    hls.attachMedia(audio);
    return;
  }
  engine = kind === 'hls' ? 'hls' : 'native';
  nativeFail = fail;
  audio.src = url;
  audio.play().catch(e => { if (e.name === 'NotAllowedError') fail('The browser blocked autoplay. Press play.'); });
}

function recordFail(s, msg, countPlay) {
  const h = H(s.url);
  if (countPlay) h.plays++;
  h.fails++;
  h.lastResult = 'fail';
  h.lastNote = msg;
  h.lastPlay = Date.now();
  s.recorded = true;
  saveH(h);
}
function onTimeout(token) {
  const s = session;
  if (token !== playToken || !s || s.started || s.failed) return;
  if (hasBackup()) {
    s.failed = true;
    recordFail(s, `didn’t start within ${S.settings.timeoutSec}s`, true);
    nextSource();
    return;
  }
  if (S.settings.autoSkip) return onPlayFail(`Didn’t start within ${S.settings.timeoutSec}s`);
  showOverlay(`<b>⏳ Still tuning after ${S.settings.timeoutSec}s</b><div class="muted">This station is slow or off air right now.</div>`,
    [['wait', 'Keep waiting'], ['next', 'Next station'], ['broken', 'Mark broken & skip']]);
}
function onPlayFail(msg) {
  const s = session;
  if (!s || s.failed) return;
  s.failed = true;
  clearTimeout(startTimer);
  recordFail(s, msg, !s.started);
  teardown();
  Radio.setState('nosignal');
  if (!s.started && nextSource()) return;
  if (S.settings.autoSkip && !s.started) {
    showOverlay(`✖ ${esc(msg)}<div class="muted">Skipping to the next working station…</div>`);
    setTimeout(() => { if (s.token === playToken) step(1, true); }, 1500);
    return;
  }
  const tried = s.order.length > 1 ? ` (tried all ${s.order.length} links)` : '';
  showOverlay(`<b>NO SIGNAL</b><div>Couldn’t play this station${tried}</div><div class="muted">${esc(msg)}</div>`,
    [['next', 'Next station'], ['retry', 'Retry'], ['copy', 'Copy link for VLC']]);
}
function leaveSession() {
  const s = session;
  if (!s) return;
  clearTimeout(startTimer);
  const waited = performance.now() - s.t0;
  if (s.url && !s.started && !s.recorded && waited >= S.settings.slowStartSec * 1000) {
    recordFail(s, `didn’t start after ${Math.round(waited / 1000)}s`, true);
  }
  session = null;
}
// Live radio has no "pause": stop disconnects, play tunes in fresh at the live point.
function stopPlayback() {
  leaveSession();
  playToken++;
  teardown();
  hideOverlay();
  Radio.setState('stopped');
}
function togglePlay() {
  if (['live', 'buffering', 'tuning'].includes(Radio.state)) return stopPlayback();
  const st = S.current || S.filtered[S.cursor] || S.filtered[0];
  if (st) playStation(st);
}

audio.addEventListener('playing', () => {
  const s = session;
  if (!s || s.token !== playToken) return;
  hideOverlay();
  Radio.setState('live');
  if (s.started) return; // recovered from buffering
  s.started = true;
  s.liveAt = Date.now();
  addRecent(s.st);
  clearTimeout(startTimer);
  const ms = performance.now() - s.t0;
  const h = H(s.url);
  const n = h.ok + h.slow;
  h.avgStartMs = Math.round((h.avgStartMs * n + ms) / (n + 1));
  h.lastStartMs = Math.round(ms);
  h.plays++;
  h.lastPlay = Date.now();
  if (ms > S.settings.slowStartSec * 1000) { h.slow++; h.lastResult = 'slow'; }
  else { h.ok++; h.lastResult = 'ok'; lightUp(s.st); }
  s.recorded = true;
  saveH(h);
  // Radio Browser ranks stations by listens; tell it about this one (its API asks clients to).
  const uuid = s.order[s.idx]?.uuid;
  if (uuid && RB.base) fetch(`${RB.base}/json/url/${uuid}`).catch(() => {});
  const i = S.filtered.findIndex(c => c.key === s.st.key);
  const next = S.filtered[i + 1];
  if (next) preconnect(orderedSources(next)[0].url);
});
audio.addEventListener('waiting', () => {
  const s = session;
  if (!s?.started || s.token !== playToken || s.failed) return;
  Radio.setState('buffering');
  s.stalls++;
  if (s.stalls === 3) {
    const h = H(s.url);
    h.stalls++;
    h.lastResult = 'stall';
    h.lastPlay = Date.now();
    saveH(h);
  }
  if (s.stalls >= 3) {
    const acts = [['next', 'Next station'], ['rate-buffers', 'Rate “Drops out”']];
    if (hasBackup()) acts.unshift(['switch', 'Try backup link']);
    showOverlay('<div class="spinner"></div>Dropping out again… this link keeps stalling.', acts);
  } else {
    showOverlay('<div class="spinner"></div>Buffering…');
  }
});
audio.addEventListener('error', () => {
  if (engine !== 'native' || !nativeFail || !audio.error) return;
  const why = ['', 'aborted', 'network error', 'decode error', 'offline, or a format this browser can’t play'][audio.error.code] || 'error';
  nativeFail(`Browser couldn’t play it (${why})`);
});
// A live stream "ending" means the server hung up.
audio.addEventListener('ended', () => { if (session?.started && session.token === playToken) onPlayFail('The server ended the stream'); });
window.addEventListener('pagehide', leaveSession);

function step(dir, skipBad = false) {
  const list = S.filtered;
  if (!list.length) return;
  let i = S.current ? list.findIndex(c => c.key === S.current.key) : -1;
  if (i < 0 && dir < 0) i = 0;
  for (let n = 0; n < list.length; n++) {
    i = (i + dir + list.length) % list.length;
    if (!skipBad || !isBadCls(stationStatus(list[i]).cls)) return playStation(list[i]);
  }
  toast('No working stations left in this list');
}

// Lock-screen / headset controls on phones and laptops.
function setMediaSession(st) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: st.name, artist: [countryName(st.country || ''), groupLabel(st)].filter(x => x && x.length > 1).join(' · '), album: 'M3U Radio',
      artwork: st.logo ? [{ src: st.logo, sizes: '256x256' }] : [],
    });
  } catch { /* old browser */ }
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const on = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } };
  on('play', () => { if (Radio.state !== 'live') togglePlay(); });
  on('pause', stopPlayback);
  on('stop', stopPlayback);
  on('nexttrack', () => step(1));
  on('previoustrack', () => step(-1));
}

/* =========================================================================
   Overlay + "now playing" panel
   ========================================================================= */
function showOverlay(html, actions = []) {
  const el = $('#overlay');
  el.innerHTML = html + (actions.length
    ? `<div class="acts">${actions.map(([a, l]) => `<button type="button" data-act="${a}">${esc(l)}</button>`).join('')}</div>` : '');
  el.classList.remove('hidden');
}
function hideOverlay() { $('#overlay').classList.add('hidden'); }

function renderNow() {
  const st = S.current;
  for (const b of document.querySelectorAll('.rate button, #favBtn')) b.disabled = !st;
  VFD.update();
  if (!st) return;
  const url = currentSourceUrl();
  const src = st.sources.find(s => s.url === url) || st.sources[0];
  const ss = stationStatus(st);
  const h = S.health.get(src.url);
  $('#nowName').textContent = st.name;
  const cc = st.country;
  $('#nowMeta').innerHTML = `No. ${stNum(st)} · ${cc ? `${countryFlag(cc)} ${esc(countryName(cc))} · ` : ''}${esc(groupLabel(st))} · ${badgeHtml(ss, 'Untested')}`;
  const logo = $('#nowLogo');
  logo.classList.toggle('hidden', !st.logo);
  if (st.logo) { logo.src = st.logo; logo.onerror = () => logo.classList.add('hidden'); }
  const fav = S.favs.has(st.key);
  $('#favBtn b').textContent = fav ? '★' : '☆';
  $('#favBtn').classList.toggle('on', fav);
  $('#favBtn').setAttribute('aria-pressed', fav);
  for (const b of document.querySelectorAll('.rate [data-rate]')) b.classList.toggle('on', !!b.dataset.rate && b.dataset.rate === (h?.rating || ''));
  const sel = $('#sourceSel');
  sel.classList.toggle('hidden', st.sources.length < 2);
  if (st.sources.length > 1) {
    sel.innerHTML = st.sources.map((s, i) => {
      const f = formatOf(s);
      return `<option value="${esc(s.url)}"${s.url === src.url ? ' selected' : ''}>Link ${i + 1}${f ? ' · ' + esc(f) : ''} · ${esc(sourceStatus(s).label || 'Untested')}</option>`;
    }).join('');
  }
  const lines = [];
  if (st.sources.length > 1) lines.push(`Details for link ${st.sources.indexOf(src) + 1} of ${st.sources.length}. If one fails, the next one is tried automatically.`);
  if (h?.plays) {
    lines.push(`Played ${h.plays}× · ${h.ok + h.slow} started · ${h.fails} failed · ${h.stalls} with dropouts` +
      (h.avgStartMs ? ` · average start ${fmtS(h.avgStartMs)}` : '') + ` · last ${ago(h.lastPlay)}`);
  }
  if (h?.lastResult === 'fail' && h.lastNote) lines.push(`Last problem: ${h.lastNote}`);
  if (h?.probe) lines.push(`Test ${ago(h.probe.at)}: ${fromProbe(h.probe).label}${h.probe.note ? ' · ' + h.probe.note : ''}`);
  if (src.rbOk === 0) lines.push('Radio Browser’s own check failed for this link last time.');
  if (isMixed(src.url)) lines.push('Plain-HTTP stream: playing the HTTPS version, because browsers block plain HTTP on this page.');
  if (lines.length < 2 && !h) lines.push('No history yet.');
  $('#nowStats').innerHTML = lines.map(l => `<div>${esc(l)}</div>`).join('');
}

function setRating(r) {
  const url = currentSourceUrl();
  if (!url) return;
  const h = H(url);
  h.rating = r;
  saveH(h);
  toast(r ? 'Rating saved for this link' : 'Rating cleared');
}
const favRecord = st => ({ key: st.key, name: st.name, logo: st.logo, group: st.group, country: st.country, sources: st.sources, addedAt: Date.now() });
function toggleFav(st) {
  if (S.favs.has(st.key)) { S.favs.delete(st.key); DB.del('favs', st.key); }
  else { const f = favRecord(st); S.favs.set(st.key, f); DB.put('favs', f); }
  if (S.ui.status === 'fav') { rebuildGroups(); applyFilters(true); } else scheduleRender();
  renderNow();
}
const RECENT_MAX = 40;
function addRecent(st) {
  const rec = { ...favRecord(st), at: Date.now() };
  delete rec.addedAt;
  S.recent = [rec, ...S.recent.filter(r => r.key !== st.key)].slice(0, RECENT_MAX);
  DB.put('kv', S.recent, 'recent');
  if (S.ui.status === 'recent') { rebuildGroups(); applyFilters(true); }
}
function copyLink() {
  const url = currentSourceUrl();
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => toast('Link copied'), () => prompt('Stream link:', url));
}

/* =========================================================================
   Lists
   ========================================================================= */
function renderLists() {
  const sel = $('#listSelect');
  sel.innerHTML = S.lists.length
    ? S.lists.map(p => `<option value="${p.id}"${p.id === S.ui.currentId ? ' selected' : ''}>${esc(p.name)} (${p.count})</option>`).join('')
    : '<option value="">No lists yet</option>';
  const cur = S.lists.find(p => p.id === S.ui.currentId);
  $('#refreshListBtn').disabled = !canRefresh(cur);
  $('#deleteListBtn').disabled = !cur;
}
const canRefresh = p => !!p && (p.kind !== 'm3u' || !!p.url);
function setStations(sts) {
  S.stations = sts;
  S.byKey = new Map(sts.map(c => [c.key, c]));
  S.numByKey = new Map(sts.map((c, i) => [c.key, i + 1]));
  S.byUrl = new Map();
  for (const f of S.favs.values()) for (const s of f.sources || []) S.byUrl.set(s.url, S.byKey.get(f.key) || f);
  for (const r of S.recent) for (const s of r.sources || []) if (!S.byUrl.has(s.url)) S.byUrl.set(s.url, r);
  for (const c of sts) for (const s of c.sources) S.byUrl.set(s.url, c);
  // Keep favorites' links up to date with the newest copy of the list.
  for (const f of [...S.favs.values()]) {
    const st = S.byKey.get(f.key);
    if (st && JSON.stringify(st.sources) !== JSON.stringify(f.sources)) {
      const nf = { ...favRecord(st), addedAt: f.addedAt };
      S.favs.set(st.key, nf);
      DB.put('favs', nf);
    }
  }
}
async function addList(meta, entries) {
  if (!entries) entries = await loadEntries(meta);
  const sts = mergeStations(entries);
  if (!sts.length) throw new Error('No stations found in this list.');
  const id = 'l' + Date.now().toString(36);
  const list = { ...meta, id, count: sts.length, addedAt: Date.now(), updatedAt: Date.now() };
  await DB.put('kv', entries, 'list:' + id);
  S.lists.push(list);
  await DB.put('kv', S.lists, 'lists');
  if (S.ui.status === 'fav' || S.ui.status === 'recent') S.ui.status = 'all';
  await selectList(id, sts);
  toast(`Added ${sts.length} stations`);
}
async function selectList(id, parsed) {
  S.ui.currentId = id;
  S.ui.group = '';
  saveUi();
  setStations(!id ? [] : parsed || mergeStations((await DB.get('kv', 'list:' + id)) || []));
  const meta = S.lists.find(p => p.id === id);
  if (meta && meta.count !== S.stations.length) { meta.count = S.stations.length; DB.put('kv', S.lists, 'lists'); }
  if (S.current) S.current = S.byKey.get(S.current.key) || S.current;
  renderLists();
  Radio.bands();
  Radio.syncDx();
  $('#statusFilter').value = S.ui.status;
  $('#sortSel').value = S.ui.sort || '';
  rebuildGroups();
  applyFilters();
  backgroundRefresh(meta);
}
async function saveEntries(p, entries, sts) {
  await DB.put('kv', entries, 'list:' + p.id);
  p.count = sts.length;
  p.updatedAt = Date.now();
  await DB.put('kv', S.lists, 'lists');
}
async function refreshList(p = S.lists.find(x => x.id === S.ui.currentId), quiet = false) {
  if (!canRefresh(p) || refreshing.has(p.id)) return;
  refreshing.add(p.id);
  try {
    const entries = await loadEntries(p);
    const sts = mergeStations(entries);
    if (!sts.length) throw new Error('No stations found.');
    await saveEntries(p, entries, sts);
    Radio.bands();
    if (S.ui.currentId === p.id) {
      setStations(sts);
      if (S.current) S.current = S.byKey.get(S.current.key) || S.current;
      renderLists();
      rebuildGroups();
      applyFilters(true);
    }
    toast(`“${p.name}” updated: ${sts.length} stations`);
  } catch (e) {
    if (!quiet) toast(e.message); // offline or blocked: keep using the saved copy
  } finally {
    refreshing.delete(p.id);
  }
}
const refreshing = new Set();
function backgroundRefresh(p) {
  if (p && Date.now() - (p.updatedAt || p.addedAt || 0) >= REFRESH_AFTER) refreshList(p, true);
}
async function deleteList() {
  const p = S.lists.find(x => x.id === S.ui.currentId);
  if (!p || !confirm(`Remove the list “${p.name}”? Your favorites and ratings are kept.`)) return;
  await DB.del('kv', 'list:' + p.id);
  S.lists = S.lists.filter(x => x !== p);
  await DB.put('kv', S.lists, 'lists');
  await selectList(S.lists[0]?.id || null);
}
async function loadWithSpinner(meta) {
  S.loading = `Loading ${meta.name || 'list'}…`;
  S.filtered = [];
  renderList();
  try {
    await addList(meta);
  } catch (e) {
    toast(e.message);
  } finally {
    S.loading = '';
    applyFilters();
  }
}

/* =========================================================================
   Add-list dialog: Radio Browser queries, junguler genres, SomaFM, mirrors, custom
   ========================================================================= */
const userCountry = (navigator.language.match(/-([A-Z]{2})\b/i) || [])[1]?.toUpperCase() || 'US';
const choices = {};
async function loadChoices(kind) {
  if (choices[kind]) return;
  choices[kind] = true;
  try {
    if (kind === 'rb') {
      const [countries, tags, langs] = await Promise.all([
        rbFetch('countries?order=name&hidebroken=true'),
        rbFetch('tags?order=stationcount&reverse=true&hidebroken=true&limit=400'),
        rbFetch('languages?order=stationcount&reverse=true&hidebroken=true&limit=200'),
      ]);
      $('#rbCountry').innerHTML = countries.filter(c => c.iso_3166_1 && c.stationcount > 0)
        .map(c => [c.iso_3166_1.toUpperCase(), countryName(c.iso_3166_1.toLowerCase()), c.stationcount])
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([cc, name, n]) => `<option value="${esc(cc)}"${cc === userCountry ? ' selected' : ''}>${countryFlag(cc.toLowerCase())} ${esc(name)} (${n})</option>`).join('');
      $('#rbTag').innerHTML = tags.filter(t => t.name.length < 30)
        .map(t => `<option value="${esc(t.name)}">${esc(t.name)} (${t.stationcount})</option>`).join('');
      $('#rbLang').innerHTML = langs.map(l => `<option value="${esc(l.name)}">${esc(l.name)} (${l.stationcount})</option>`).join('');
    } else if (kind === 'jg') {
      let idx = await DB.get('kv', 'jg:index');
      if (!idx || Date.now() - idx.at > 24 * 3600e3) {
        const r = await fetch(`https://api.github.com/repos/${JG_REPO}/contents/`);
        if (!r.ok) throw new Error('GitHub API ' + r.status);
        const items = (await r.json()).filter(f => f.type === 'file' && f.name.endsWith('.m3u')).map(f => ({ name: f.name, size: f.size }));
        idx = { at: Date.now(), items };
        DB.put('kv', idx, 'jg:index');
      }
      const genres = idx.items.filter(f => !f.name.startsWith('-'));
      const big = idx.items.filter(f => f.name.startsWith('-'));
      $('#jgFile').innerHTML = '<option value="">Choose a genre…</option>' +
        genres.map(f => `<option value="${esc(f.name)}">${esc(jgLabel(f.name))}</option>`).join('') +
        (big.length ? '<optgroup label="Everything (large)">' + big.map(f => `<option value="${esc(f.name)}">${esc(f.name.replace(/^-+|\.m3u$/g, ''))} · ${(f.size / 1e6).toFixed(0)} MB</option>`).join('') + '</optgroup>' : '');
    } else if (kind === 'mirror') {
      const items = await (await fetch('lists/index.json', { cache: 'no-store' })).json();
      $('#mirrorFile').innerHTML = items.map(i => `<option value="${esc(i.file)}">${esc(i.name)} (${i.count} stations, updated ${esc((i.updated || '').slice(0, 10))})</option>`).join('');
    }
  } catch (e) {
    choices[kind] = false; // try again next time
    if (kind === 'jg') $('#jgFile').innerHTML = '<option value="">Couldn’t load the genre list (GitHub limit?). Try again later.</option>';
    else if (kind === 'rb') $('#addErr').textContent = e.message;
  }
}
const jgLabel = f => f.replace(/\.m3u$/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
function showSrc() {
  const k = $('#srcKind').value;
  for (const d of document.querySelectorAll('#addDlg .src')) d.classList.toggle('hidden', d.dataset.src !== k);
  const mode = $('#rbMode').value;
  for (const [id, m] of [['rbCountry', 'country'], ['rbTag', 'tag'], ['rbLang', 'language'], ['rbName', 'name']]) $('#' + id).classList.toggle('hidden', mode !== m);
  $('#addErr').textContent = '';
  loadChoices(k);
}
function openAddDialog() {
  $('#addForm').reset();
  showSrc();
  $('#addDlg').showModal();
}
// What the dialog's current choices add up to: { meta, entries? }
async function dialogChoice() {
  const k = $('#srcKind').value;
  const name = $('#plName').value.trim();
  if (k === 'rb') {
    const mode = $('#rbMode').value;
    const v = { country: $('#rbCountry').value, tag: $('#rbTag').value, language: $('#rbLang').value, name: $('#rbName').value.trim() }[mode];
    if (typeof RB_QUERY[mode] === 'function' && !v) throw new Error('Pick or type a value first.');
    const label = { top: 'Top voted', clicks: 'Most listened', trending: 'Trending', country: countryName((v || '').toLowerCase()),
                    tag: v, language: v, name: `“${v}”` }[mode];
    return { meta: { kind: 'rb', name: name || `Radio Browser · ${label}`, query: typeof RB_QUERY[mode] === 'function' ? RB_QUERY[mode](v) : RB_QUERY[mode] } };
  }
  if (k === 'jg') {
    const f = $('#jgFile').value;
    if (!f) throw new Error('Choose a genre first.');
    const genre = f.startsWith('-') ? '' : f.replace(/\.m3u$/, '');
    return { meta: { kind: 'm3u', name: name || `junguler · ${f.startsWith('-') ? f.replace(/^-+|\.m3u$/g, '') : jgLabel(f)}`, url: JG_RAW + encodeURIComponent(f), genre } };
  }
  if (k === 'soma') return { meta: { kind: 'soma', name: name || 'SomaFM' } };
  if (k === 'mirror') {
    const f = $('#mirrorFile').value;
    if (!f) throw new Error('No mirrored lists yet.');
    return { meta: { kind: 'm3u', name: name || $('#mirrorFile').selectedOptions[0].textContent.replace(/ \(.*$/, ''), url: new URL('lists/' + f, location.href).href } };
  }
  if (k === 'url') {
    const url = $('#plUrl').value.trim();
    if (!isStreamUrl(url)) throw new Error('Enter a playlist URL starting with https://');
    let n = '';
    try { n = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.(m3u8?|pls)$/i, ''); } catch { /* keep empty */ }
    return { meta: { kind: 'm3u', name: name || n || 'My list', url } };
  }
  if (k === 'file') {
    const file = $('#plFile').files[0];
    if (!file) throw new Error('Choose a file first.');
    return { meta: { kind: 'm3u', name: name || file.name.replace(/\.(m3u8?|pls|txt)$/i, ''), url: '' }, entries: parseText(await file.text()) };
  }
  const text = $('#plText').value.trim();
  if (!text) throw new Error('Paste a playlist first.');
  return { meta: { kind: 'm3u', name: name || 'Pasted list', url: '' }, entries: parseText(text) };
}

/* =========================================================================
   Backup / restore
   ========================================================================= */
async function exportData() {
  const data = {
    app: 'm3u-radio', version: 1, exportedAt: new Date().toISOString(),
    settings: S.settings, favs: [...S.favs.values()], health: [...S.health.values()], recent: S.recent, lists: [],
  };
  for (const p of S.lists) data.lists.push({ ...p, entries: await DB.get('kv', 'list:' + p.id) });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `m3u-radio-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'm3u-radio') throw new Error('This is not an M3U Radio backup.');
    if (data.settings) { S.settings = { ...DEFAULT_SETTINGS, ...data.settings }; await DB.put('kv', S.settings, 'settings'); }
    for (const f of data.favs || []) { S.favs.set(f.key, f); await DB.put('favs', f); }
    for (const h of data.health || []) { S.health.set(h.url, h); await DB.put('health', h); }
    if (data.recent?.length) {
      const seen = new Set(S.recent.map(r => r.key));
      S.recent = [...S.recent, ...data.recent.filter(r => !seen.has(r.key))].slice(0, RECENT_MAX);
      await DB.put('kv', S.recent, 'recent');
    }
    for (const p of data.lists || []) {
      if (S.lists.some(x => x.id === p.id) || !p.entries) continue;
      const { entries, ...meta } = p;
      await DB.put('kv', entries, 'list:' + p.id);
      S.lists.push(meta);
    }
    await DB.put('kv', S.lists, 'lists');
    await selectList(S.lists.some(p => p.id === S.ui.currentId) ? S.ui.currentId : S.lists[0]?.id || null);
    Radio.refreshFx();
    toast('Backup imported');
  } catch (e) {
    toast('Import failed: ' + e.message);
  }
}
async function clearStats() {
  if (!confirm('Clear all test results and play history? Your ratings and favorites are kept.')) return;
  await DB.clear('health');
  const keep = [...S.health.values()].filter(h => h.rating);
  S.health.clear();
  S.hosts.clear();
  for (const old of keep) { const h = H(old.url); h.rating = old.rating; await DB.put('health', h); }
  applyFilters(true);
  renderNow();
  toast('Test history cleared');
}
async function eraseAll() {
  if (!confirm('Erase all lists, favorites, ratings and settings from this browser?')) return;
  await Promise.all(['kv', 'health', 'favs'].map(s => DB.clear(s)));
  location.reload();
}

/* =========================================================================
   Wiring
   ========================================================================= */
function openSettings() {
  const s = S.settings;
  $('#sSlow').value = s.slowStartSec;
  $('#sTimeout').value = s.timeoutSec;
  $('#sAutoSkip').checked = s.autoSkip;
  $('#sAutoTest').checked = s.autoTest;
  $('#sConc').value = s.concurrency;
  $('#sFx').checked = s.fx;
  $('#setDlg').showModal();
}
const clamp = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };

function wire() {
  $('#list').addEventListener('scroll', () => {
    scheduleRender();
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(autoTestVisible, 600);
  });
  window.addEventListener('resize', scheduleRender);

  $('#listInner').addEventListener('click', e => {
    if (e.target.closest('[data-act="add"]')) return openAddDialog();
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); return toggleFav(S.filtered[+star.dataset.star]); }
    const row = e.target.closest('.ch');
    if (row) { $('#list').focus({ preventScroll: true }); playStation(S.filtered[+row.dataset.i]); }
  });
  $('#listInner').addEventListener('pointerover', e => {
    const row = e.target.closest('.ch');
    if (!row) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { const st = S.filtered[+row.dataset.i]; if (st) preconnect(orderedSources(st)[0].url); }, 120);
  });

  $('#search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { S.ui.search = e.target.value; saveUi(); applyFilters(); }, 150);
  });
  $('#groupFilter').addEventListener('change', e => { S.ui.group = e.target.value; saveUi(); applyFilters(); });
  $('#countryFilter').addEventListener('change', e => { S.ui.country = e.target.value; saveUi(); applyFilters(); });
  $('#statusFilter').addEventListener('change', e => { S.ui.status = e.target.value; saveUi(); Radio.syncDx(); rebuildGroups(); applyFilters(); });
  $('#sortSel').addEventListener('change', e => { S.ui.sort = e.target.value; saveUi(); applyFilters(); });

  $('#testBtn').addEventListener('click', () => {
    if (T.manual && (T.active || T.queue.length)) return stopTests();
    const urls = testUrlsFor(S.filtered);
    if (!urls.length) return toast(S.filtered.length ? 'Everything here was checked in the last 6 hours' : 'Nothing to test');
    if (urls.length > 1500 && !confirm(`Test ${urls.length} stations? This can take a while. Tip: pick a genre or country first.`)) return;
    queueTests(urls, { manual: true });
  });
  $('#testOneBtn').addEventListener('click', () => {
    if (!S.current) return;
    queueTests(S.current.sources.map(s => s.url), { force: true, front: true });
    toast(S.current.sources.length > 1 ? `Testing all ${S.current.sources.length} links…` : 'Testing…');
  });

  $('#listSelect').addEventListener('change', e => selectList(e.target.value));
  $('#addListBtn').addEventListener('click', openAddDialog);
  $('#refreshListBtn').addEventListener('click', () => refreshList());
  $('#deleteListBtn').addEventListener('click', deleteList);
  $('#srcKind').addEventListener('change', showSrc);
  $('#rbMode').addEventListener('change', showSrc);
  $('#addForm').addEventListener('submit', async e => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const err = $('#addErr');
    const btn = $('#addSubmit');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const { meta, entries } = await dialogChoice();
      await addList(meta, entries);
      $('#addDlg').close();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Add';
    }
  });

  $('#settingsBtn').addEventListener('click', openSettings);
  $('#setForm').addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const d = DEFAULT_SETTINGS;
    S.settings = {
      slowStartSec: clamp($('#sSlow').value, 1, 60, d.slowStartSec),
      timeoutSec: clamp($('#sTimeout').value, 3, 120, d.timeoutSec),
      autoSkip: $('#sAutoSkip').checked,
      autoTest: $('#sAutoTest').checked,
      concurrency: clamp($('#sConc').value, 1, 16, d.concurrency),
      fx: $('#sFx').checked,
    };
    DB.put('kv', S.settings, 'settings');
    Radio.refreshFx();
    toast('Settings saved');
  });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  $('#clearStatsBtn').addEventListener('click', clearStats);
  $('#clearAllBtn').addEventListener('click', eraseAll);

  $('#favBtn').addEventListener('click', () => S.current && toggleFav(S.current));
  $('#prevBtn').addEventListener('click', () => step(-1));
  $('#nextBtn').addEventListener('click', () => step(1));
  $('#playBtn').addEventListener('click', togglePlay);
  // Click anywhere on the tuning scale: jump to the station at that point of the list.
  $('#dial').addEventListener('click', e => {
    const n = S.filtered.length;
    if (!n) return;
    const dial = $('#dial');
    const cs = getComputedStyle(dial);
    const sl = parseFloat(cs.getPropertyValue('--sl')) || 0, sr = parseFloat(cs.getPropertyValue('--sr')) || 0;
    const r = dial.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left - sl) / (r.width - sl - sr)));
    playStation(S.filtered[Math.round(frac * (n - 1))]);
  });
  $('#bands').addEventListener('click', e => {
    const b = e.target.closest('[data-band]');
    const id = b && S.lists[+b.dataset.band]?.id;
    if (id && id !== S.ui.currentId) selectList(id);
  });
  knob($('#tuneKnob'), 18, turnTuning);
  knob($('#bandKnob'), 30, turnBand, () => turnBand(1));
  knob($('#volKnob'), 6, s => setVolume(audio.volume + s * 0.02));
  $('#dxBtn').addEventListener('click', () => {
    S.ui.status = S.ui.status === 'hideBad' ? 'all' : 'hideBad';
    $('#statusFilter').value = S.ui.status;
    saveUi(); Radio.syncDx(); rebuildGroups(); applyFilters();
    toast(S.ui.status === 'hideBad' ? 'LOCAL: hiding stations that are off air or blocked' : 'DX: showing every station');
  });
  $('#lightBtn').addEventListener('click', () => { S.settings.fx = !S.settings.fx; DB.put('kv', S.settings, 'settings'); Radio.refreshFx(); });
  $('#sourceSel').addEventListener('change', e => S.current && playStation(S.current, e.target.value));
  for (const b of document.querySelectorAll('[data-rate]')) b.addEventListener('click', () => setRating(b.dataset.rate));
  $('#copyBtn').addEventListener('click', copyLink);

  $('#overlay').addEventListener('click', e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (!a) return;
    if (a === 'next') step(1, true);
    else if (a === 'retry' && S.current) playStation(S.current);
    else if (a === 'copy') copyLink();
    else if (a === 'switch') { if (!nextSource()) toast('No other links for this station'); }
    else if (a === 'wait') showOverlay('<div class="spinner"></div>Still waiting…', [['next', 'Next station']]);
    else if (a === 'broken') { setRating('broken'); step(1, true); }
    else if (a === 'rate-buffers') { setRating('buffers'); hideOverlay(); }
  });

  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = !!e.target.closest?.('button, a');
    const k = e.key;
    const handled = () => e.preventDefault();
    if (k === 'ArrowDown' || k === 'ArrowUp') { handled(); const c = cursorStart(); moveCursor(c < 0 ? 0 : c + (k === 'ArrowDown' ? 1 : -1)); }
    else if (k === 'PageDown' || k === 'PageUp') { handled(); moveCursor(Math.max(0, cursorStart()) + (k === 'PageDown' ? 1 : -1) * pageRows()); }
    else if (k === 'Home' || k === 'End') { handled(); moveCursor(k === 'Home' ? 0 : S.filtered.length - 1); }
    else if (k === 'Enter' && !onButton && S.cursor >= 0 && S.filtered[S.cursor]) { handled(); playStation(S.filtered[S.cursor]); }
    else if (['ArrowRight', 'n', 'MediaTrackNext'].includes(k)) { handled(); step(1); }
    else if (['ArrowLeft', 'p', 'MediaTrackPrevious'].includes(k)) { handled(); step(-1); }
    else if (k === 'Escape') { S.cursor = S.current ? S.filtered.findIndex(c => c.key === S.current.key) : -1; scrollToCurrent(); scheduleRender(); }
    else if (k === 'f' || k === 'F') { const st = S.filtered[S.cursor] || S.current; if (st) toggleFav(st); }
    else if (k === ' ' && !onButton) { handled(); togglePlay(); }
  });

  let volTimer;
  audio.addEventListener('volumechange', () => {
    clearTimeout(volTimer);
    volTimer = setTimeout(() => { S.ui.volume = audio.volume; saveUi(); }, 300);
  });
}

async function init() {
  wire();
  const [lists, settings, ui, health, favs, recentList] = await Promise.all([
    DB.get('kv', 'lists'), DB.get('kv', 'settings'), DB.get('kv', 'ui'), DB.all('health'), DB.all('favs'), DB.get('kv', 'recent'),
  ]);
  S.recent = recentList || [];
  S.lists = lists || [];
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  S.ui = { ...S.ui, ...(ui || {}) };
  const recent = Date.now() - 24 * 3600e3;
  for (const h of health || []) {
    S.health.set(h.url, h);
    if (h.probe && !h.probe.inferred && h.probe.at > recent) noteHost(h.url, h.probe);
  }
  for (const f of favs || []) S.favs.set(f.key, f);
  $('#search').value = S.ui.search;
  const vol = Number(S.ui.volume ?? 0.8);
  setVolume(Number.isFinite(vol) ? vol : 0.8);
  Radio.refreshFx();
  Radio.setState('standby');

  const startId = S.lists.some(p => p.id === S.ui.currentId) ? S.ui.currentId : S.lists[0]?.id || null;
  await selectList(startId);

  // Show (but don't autoplay) the station played last.
  const last = S.byKey.get(S.ui.lastKey) || S.favs.get(S.ui.lastKey);
  if (last?.sources) { S.current = last; scrollToCurrent(); scheduleRender(); Radio.needle(); }
  renderNow();

  // Shortcut: ?m3u=<playlist url> adds that list (once).
  const qp = new URLSearchParams(location.search).get('m3u');
  if (qp && !S.lists.some(p => p.url === qp)) {
    loadWithSpinner({ kind: 'm3u', name: decodeURIComponent(qp.split('/').pop() || 'Shared list').replace(/\.(m3u8?|pls)$/i, ''), url: qp });
  } else if (!S.lists.length && !S.ui.seeded) {
    // First visit: load Radio Browser's top stations. Only once, so removing it sticks.
    S.ui.seeded = true;
    saveUi();
    loadWithSpinner(DEFAULT_LIST);
  }
  // Show the "mirrored lists" option only when this site has some.
  fetch('lists/index.json', { method: 'HEAD', cache: 'no-store' }).then(r => { if (r.ok) $('#mirrorOpt').hidden = false; }).catch(() => {});
}
init();
