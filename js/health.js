'use strict';
/* =========================================================================
   Health: what we know about each stream, and the badge it gets.
   One vocabulary everywhere: On air · Weak · Off air · Blocked · New.
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
const LABEL = { good: 'On air', warn: 'Weak', bad: 'Off air', blocked: 'Blocked', untested: 'New' };

function fromHistory(h) {
  const tip = `You played it ${h.plays}×: ${h.fails} failed, ${h.stalls} with dropouts`;
  if (h.lastResult === 'fail') return mk('bad', LABEL.bad, `Failed last time (${h.lastNote || 'error'}). ${tip}`);
  if (h.plays >= 3 && h.fails / h.plays >= 0.5) return mk('bad', LABEL.bad, `Fails more often than it plays. ${tip}`);
  if (h.lastResult === 'stall') return mk('warn', LABEL.warn, `Kept dropping out last time. ${tip}`);
  if (h.lastResult === 'slow') return mk('warn', LABEL.warn, `Took ${fmtS(h.lastStartMs)} to start. ${tip}`);
  return mk('good', LABEL.good, `Played: started in ${fmtS(h.lastStartMs)}. ${tip}`);
}
function fromProbe(p) {
  const tip = `${p.note ? p.note + '. ' : ''}Tested ${ago(p.at)}`;
  const cls = { ok: 'good', slow: 'warn', dead: 'bad', blocked: 'blocked' }[p.status] || 'untested';
  return mk(cls, LABEL[cls], tip);
}
function sourceStatus(src) {
  const h = S.health.get(src.url);
  if (h?.rating === 'good') return mk('good', LABEL.good + ' ★', 'You marked this as playing fine');
  if (h?.rating === 'buffers') return mk('warn', LABEL.warn + ' ★', 'You marked this as weak');
  if (h?.rating === 'broken') return mk('bad', LABEL.bad + ' ★', 'You marked this as off air');
  if (h?.relay && h.lastPlay >= (h.probe?.at || 0) && h.lastResult !== 'fail') { const r = fromHistory(h); return { ...r, tip: 'Via relay. ' + r.tip }; }
  const hist = h?.lastPlay ? fromHistory(h) : null;
  const pr = h?.probe ? fromProbe(h.probe) : null;
  if (hist && pr) return h.lastPlay >= h.probe.at ? hist : pr; // newest evidence wins
  if (hist || pr) return hist || pr;
  if (isMixed(src.url)) return mk('untested', LABEL.untested, 'Plain-HTTP stream: browsers may block it on this HTTPS page');
  return mk('untested', LABEL.untested, 'Not tested yet');
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

// Test a link directly; if the browser can't reach it, test it through the relay (not for HLS: its pieces load on their own).
async function probe(url, depth = 0) {
  const p = await probeDirect(url, depth);
  if (!RELAY || isRelayed(url) || p.kind === 'hls' || p.noRelay || !(p.status === 'dead' || p.status === 'blocked')) return p;
  const q = await probeDirect(relayUrl(url), depth);
  if (q.status === 'ok' || q.status === 'slow') return { ...q, relay: true, scope: undefined, note: 'Via relay · ' + (q.note || '') };
  return { ...p, note: `${p.note || ''} · relay couldn’t reach it either` };
}
async function probeDirect(url, depth = 0) {
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
      const p = await probe(isRelayed(target) ? relayUrl(next) : next, depth + 1);
      return { ...p, resolved: p.resolved || next, note: `Via playlist file. ${p.note || ''}`.trim() };
    }
    const au = sniffAudio(first.data);
    const mime = au.mime || (ct.startsWith('audio/') ? ct.split(';')[0] : '');
    const fmt = au.codec || (mime ? mime.replace(/^audio\/(x-)?/, '').toUpperCase() : '');
    if (mime && !canPlay(mime)) return { ...base, kind: 'native', codec: fmt, status: 'blocked', noRelay: true, note: `This browser can’t play ${fmt || mime}` };
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
const T = { queue: [], queued: new Set(), force: new Set(), shown: new Set(), hostActive: new Map(), activeUrls: new Set(), active: 0, done: 0, total: 0, manual: false };
function queueTests(urls, { manual = false, force = false, front = false, show = false } = {}) {
  if (manual) { T.queue = []; T.queued.clear(); T.done = 0; T.total = T.active; T.manual = true; }
  const add = [];
  for (const u of urls) {
    if (T.queued.has(u)) continue;
    T.queued.add(u);
    if (force) T.force.add(u);
    if (show) T.shown.add(u);
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
  T.shown.delete(url);
  if (!T.active && !T.queue.length) { T.manual = false; T.done = T.total = 0; }
  updateTestUi();
}
function recordProbe(url, p) {
  const h = H(url);
  if (p.kind) h.kind = p.kind;
  h.probe = p;
  if (!p.inferred) h.relay = !!p.relay;
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
// Only a test you asked for (the Test buttons) shows its progress; automatic tests work quietly and just update the badges.
function updateTestUi() {
  const busy = T.active > 0 || T.queue.length > 0;
  $('#testBtn').textContent = T.manual && busy ? 'Stop' : 'Test';
  $('#testProgress').textContent = T.manual && busy ? `Checking ${T.done}/${T.total}…` : '';
  $('#scanBar').classList.toggle('on', T.manual && busy);
  scheduleRender();
}
function lightUp(st) { if (st?.key) S.lit.set(st.key, Date.now()); }
function testState(st) {
  const vis = s => T.manual || T.shown.has(s.url);
  if (st.sources.some(s => vis(s) && T.activeUrls.has(s.url))) return 'checking';
  if (st.sources.some(s => vis(s) && T.queued.has(s.url))) return 'queued';
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
