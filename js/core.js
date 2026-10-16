'use strict';
/* radio.sala.company — plain browser scripts, no build step. They share one global scope and load in order:
     core.js       storage, helpers, constants, app state
     lists.js      station lists: parsing, Radio Browser / SomaFM / M3U sources, the Add-list dialog
     health.js     what we know about each stream (badges) and the in-browser stream tester
     guide.js      the station guide: virtual list, filters, search, Radio Browser browsing
     radio.js      the radio itself: dial, needle, knobs, display, sleep timer, phone mini-player
     player.js     playback: engines, backup links, reconnecting, pause / mute, lock-screen controls
     nowplaying.js song / show titles and the "songs heard" log
     app.js        station details, favorites, backup, settings, help, wiring, start-up */

/* =========================================================================
   Storage — IndexedDB, so everything stays in this browser only.
   Stores: kv (settings, ui, list index, list contents, songs heard),
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
const clamp = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
function countryName(cc) {
  const iso = cc === 'uk' ? 'GB' : cc.toUpperCase();
  try { return regionNames?.of(iso) || iso; } catch { return iso; }
}
const countryFlag = cc => (/^[a-z]{2}$/.test(cc || '') ? [...(cc === 'uk' ? 'gb' : cc).toUpperCase()].map(c => String.fromCodePoint(0x1f1a5 + c.charCodeAt(0))).join('') : '');
const userCountry = (navigator.language.match(/-([A-Z]{2})\b/i) || [])[1]?.toUpperCase() || 'US';

/* =========================================================================
   State
   ========================================================================= */
const DEFAULT_SETTINGS = { slowStartSec: 5, timeoutSec: 12, autoSkip: false, autoTest: true, concurrency: 6, fx: true };
const REFRESH_AFTER = 24 * 3600e3;   // re-download saved lists older than this
const FRESH_FOR = 6 * 3600e3;        // test/play results newer than this aren't re-tested
const S = {
  lists: [],            // [{ id, name, kind: rb|m3u|soma, query?, url?, genre?, count, addedAt, updatedAt }]
  stations: [],         // the current list: { key, name, logo, group, country, sources: [{ url, name, br, codec, hls, uuid }] }
  byKey: new Map(),
  byUrl: new Map(),     // stream URL -> station (current list, browse results, favorites, recent)
  numByKey: new Map(),
  browse: null,         // a temporary view instead of the list: { kind: 'rb' | 'all', label, stations, num, entries?, query? }
  filtered: [],         // what the guide shows right now
  health: new Map(),    // stream URL -> health record
  hosts: new Map(),     // server host -> { ok, blocked, dead } from recent tests
  favs: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  ui: { currentId: null, search: '', scope: 'view', group: '', country: '', status: 'all', sort: '', lastKey: '', volume: 0.8, muted: false, helpSeen: false },
  recent: [],
  cursor: -1,
  lit: new Map(),
  current: null,
  loading: '',
};
const saveUi = () => DB.put('kv', { ...S.ui }, 'ui');
