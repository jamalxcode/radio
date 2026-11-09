'use strict';
/* =========================================================================
   Playback: the browser plays Icecast/Shoutcast/MP3/AAC itself, hls.js handles
   HLS. A station's links are tried best-first; if one fails or hangs, the next
   one takes over. A stream that drops mid-listen is reconnected quietly.
   Every attempt is measured and remembered.
   ========================================================================= */
const audio = $('#audio');
let hls = null, engine = '', nativeFail = null;
let playToken = 0, session = null, startTimer = null, stallTimer = null;
const RETRY_DELAYS = [1000, 3000, 6000]; // reconnect attempts after a drop, before trying backup links
const STALL_LIMIT = 8000;                // buffering this long counts as a drop: reconnect rather than sit in silence

function teardown() {
  NowPlaying.stop();
  clearTimeout(stallTimer);
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
  session = { st, order, idx: -1, retries: 0 };
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
  if (s.url !== src.url) s.relayTried = false; // a new link gets its own relay attempt
  Object.assign(s, { url: src.url, t0: performance.now(), started: false, failed: false, recorded: false, stalls: 0, token, pausedAt: 0, behindMs: 0 });
  renderNow();
  Radio.setState('tuning');
  showOverlay('<div class="spinner"></div>' + (s.reconnecting ? `Signal lost — reconnecting (${s.retries}/${RETRY_DELAYS.length})…`
    : s.relayNow ? 'Direct link failed — trying through the relay…' : s.idx ? `Trying backup link ${s.idx + 1} of ${s.order.length}…` : 'Tuning…'));
  clearTimeout(startTimer);
  startTimer = setTimeout(() => onTimeout(token), S.settings.timeoutSec * 1000);
  const h = S.health.get(src.url);
  // Through the relay when the test said the browser can't take this link directly, or the direct try just failed.
  const useRelay = !!RELAY && (s.relayNow || (!s.relayTried && !!h?.relay));
  (async () => {
    let target = effectiveUrl(h?.probe?.resolved || src.url);
    let kind = h?.kind || (src.hls ? 'hls' : kindOf(target));
    if (kind === 'playlist' || (!h?.probe?.resolved && kindOf(target) === 'playlist')) {
      const r = await resolvePlaylist(target);
      if (r) { target = effectiveUrl(r.url); kind = r.kind; } else kind = 'native';
    }
    if (kind === 'hls' && !audio.canPlayType('application/vnd.apple.mpegurl')) await loadLib('hls').catch(() => {});
    if (token !== playToken) return;
    s.kind = kind;
    s.relay = useRelay && kind !== 'hls';
    if (s.relay) target = relayUrl(target);
    s.target = target; // the URL actually playing, for the now-playing look-ups
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
  if (s.reconnecting) return onPlayFail(`didn’t reconnect within ${S.settings.timeoutSec}s`);
  if (RELAY && !s.relay && !s.relayTried && s.kind !== 'hls') return onPlayFail(`didn’t start within ${S.settings.timeoutSec}s`);
  if (hasBackup()) {
    s.failed = true;
    recordFail(s, `didn’t start within ${S.settings.timeoutSec}s`, true);
    nextSource();
    return;
  }
  if (S.settings.autoSkip) return onPlayFail(`Didn’t start within ${S.settings.timeoutSec}s`);
  showOverlay(`<b>⏳ Still tuning after ${S.settings.timeoutSec}s</b><div class="muted">This station is slow or off air right now.</div>`,
    [['wait', 'Keep waiting'], ['next', 'Next station'], ['broken', 'Mark off air & skip']]);
}
function onPlayFail(msg) {
  const s = session;
  if (!s || s.failed) return;
  s.failed = true;
  clearTimeout(startTimer);
  clearTimeout(stallTimer);
  // It was playing and dropped (or a reconnect attempt failed): reconnect the same link quietly a few times.
  if ((s.started || s.reconnecting) && s.retries < RETRY_DELAYS.length) {
    if (s.started) { const h = H(s.url); h.stalls++; h.lastNote = msg; saveH(h); }
    teardown();
    s.reconnecting = true;
    s.retries++;
    Radio.setState('tuning');
    showOverlay(`<div class="spinner"></div>Signal lost — reconnecting (${s.retries}/${RETRY_DELAYS.length})…<div class="muted">${esc(msg)}</div>`);
    const tok = s.token;
    setTimeout(() => { if (session === s && s.token === tok) { s.idx--; nextSource(); } }, RETRY_DELAYS[s.retries - 1]);
    return;
  }
  if (!s.started && !s.reconnecting && RELAY && !s.relay && !s.relayTried && s.kind !== 'hls') {
    s.relayTried = true;
    s.relayNow = true;
    s.idx--;
    nextSource();
    s.relayNow = false;
    return;
  }
  recordFail(s, msg, !s.started);
  s.reconnecting = false;
  teardown();
  Radio.setState('nosignal');
  if (!s.started && nextSource()) return; // a backup link takes over
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
  if (s.url && !s.started && !s.recorded && !s.reconnecting && waited >= S.settings.slowStartSec * 1000) {
    recordFail(s, `didn’t start after ${Math.round(waited / 1000)}s`, true);
  }
  session = null;
}

/* Power / pause / live. Stop disconnects. Pause keeps the connection and resumes where you left off
   (a little behind the broadcast); after a long pause, or with ● LIVE, it reconnects at the live point. */
function stopPlayback() {
  leaveSession();
  playToken++;
  teardown();
  hideOverlay();
  Radio.setState('stopped');
}
function togglePlay() {
  if (session && Radio.state !== 'stopped' && Radio.state !== 'nosignal') return stopPlayback();
  const st = S.current || S.filtered[S.cursor] || S.filtered[0];
  if (st) playStation(st);
}
function pausePlayback() {
  const s = session;
  if (!s) return;
  if (!s.started) return stopPlayback(); // still tuning: nothing to pause
  audio.pause();
  s.pausedAt = Date.now();
  clearTimeout(stallTimer);
  NowPlaying.stop();
  hideOverlay();
  Radio.setState('paused');
}
function resumePlayback() {
  const s = session;
  if (!s) return togglePlay();
  const away = Date.now() - (s.pausedAt || Date.now());
  s.pausedAt = 0;
  if (away > 60000) return goLive(); // live servers don't hold that much: start fresh at the live point
  s.behindMs = (s.behindMs || 0) + away;
  audio.play().then(() => NowPlaying.start(s)).catch(() => goLive());
}
function togglePause() {
  if (Radio.state === 'paused') return resumePlayback();
  if (PLAYING_STATES.includes(Radio.state) && session) return pausePlayback();
  togglePlay();
}
function goLive() {
  const s = session;
  if (!s && !S.current) return;
  playStation(s ? s.st : S.current, s?.url);
}

audio.addEventListener('playing', () => {
  const s = session;
  if (!s || s.token !== playToken) return;
  clearTimeout(stallTimer);
  hideOverlay();
  Radio.setState('live');
  if (s.started) return; // recovered from buffering, or resumed after a pause
  s.started = true;
  s.liveAt = s.reconnecting ? s.liveAt || Date.now() : Date.now();
  if (s.reconnecting) {
    s.reconnecting = false;
    const tok = s.token;
    setTimeout(() => { if (session === s && s.token === tok) s.retries = 0; }, 60000); // stayed up a minute: allow fresh retries later
  }
  addRecent(s.st);
  // Folded phone: say once where the full radio (dial, sleep timer, details) is.
  if (Sheet.phone.matches && !isCar() && !S.ui.miniHint) { S.ui.miniHint = true; saveUi(); toast('Tip: tap the player bar for the full radio, sleep timer and more'); }
  NowPlaying.start(s);
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
  h.relay = !!s.relay; // next time, go straight through the relay (or straight to the server) like this time
  s.recorded = true;
  saveH(h);
  if (s.relay) h.lastNote = 'Plays through the relay';
  // Radio Browser ranks stations by listens; tell it about this one (its API asks clients to).
  const uuid = s.order[s.idx]?.uuid;
  if (uuid && RB.base) fetch(`${RB.base}/json/url/${uuid}`).catch(() => {});
  const i = S.filtered.findIndex(c => c.key === s.st.key);
  const next = S.filtered[i + 1];
  if (next) preconnect(orderedSources(next)[0].url);
});
audio.addEventListener('waiting', () => {
  const s = session;
  if (!s?.started || s.token !== playToken || s.failed || Radio.state === 'paused') return;
  Radio.setState('buffering');
  s.stalls++;
  clearTimeout(stallTimer);
  const tok = s.token;
  stallTimer = setTimeout(() => { if (session === s && s.token === tok && Radio.state === 'buffering') onPlayFail('Stream stalled'); }, STALL_LIMIT);
  if (s.stalls === 3) {
    const h = H(s.url);
    h.stalls++;
    h.lastResult = 'stall';
    h.lastPlay = Date.now();
    saveH(h);
  }
  if (s.stalls >= 3) {
    const acts = [['next', 'Next station'], ['rate-buffers', 'Mark as weak']];
    if (hasBackup()) acts.unshift(['switch', 'Try backup link']);
    showOverlay('<div class="spinner"></div>Dropping out again… this link keeps stalling.', acts);
  } else {
    showOverlay('<div class="spinner"></div>Buffering…');
  }
});
// Paused from outside (headset button, phone call, OS media controls): show it as paused.
audio.addEventListener('pause', () => {
  const s = session;
  if (s?.started && !s.failed && audio.currentSrc && Radio.state !== 'paused') { s.pausedAt = Date.now(); NowPlaying.stop(); Radio.setState('paused'); }
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

// Lock-screen / headset controls on phones and laptops: the song when we know it, else the station.
function setMediaSession(st) {
  if (!('mediaSession' in navigator)) return;
  const np = NowPlaying.current(st);
  const art = np?.art || st.logo;
  try {
    navigator.mediaSession.metadata = new MediaMetadata(np
      ? { title: np.title || np.text, artist: np.artist || st.name, album: np.artist ? st.name : 'radio.sala.company', artwork: art ? [{ src: art, sizes: '256x256' }] : [] }
      : { title: st.name, artist: [countryName(st.country || ''), groupLabel(st)].filter(x => x && x.length > 1).join(' · '), album: 'radio.sala.company',
          artwork: st.logo ? [{ src: st.logo, sizes: '256x256' }] : [] });
  } catch { /* old browser */ }
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const on = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported action */ } };
  on('play', () => (Radio.state === 'paused' ? resumePlayback() : Radio.state !== 'live' && togglePlay()));
  on('pause', pausePlayback);
  on('stop', stopPlayback);
  on('nexttrack', () => step(1));
  on('previoustrack', () => step(-1));
}

function showOverlay(html, actions = []) {
  const el = $('#overlay');
  el.innerHTML = html + (actions.length
    ? `<div class="acts">${actions.map(([a, l]) => `<button type="button" data-act="${a}">${esc(l)}</button>`).join('')}</div>` : '');
  el.classList.remove('hidden');
}
function hideOverlay() { $('#overlay').classList.add('hidden'); }
