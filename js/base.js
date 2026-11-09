'use strict';
/* =========================================================================
   What the radio screen (modern.js) stands on: playback state, volume, the sleep timer, presets,
   browsing Radio Browser, settings and backups, the song card, keyboard shortcuts and start-up.
   ========================================================================= */
const PLAYING_STATES = ['live', 'buffering', 'tuning'];

// The engine calls scheduleRender() whenever stations, health, tests or playback change.
// S.rev counts those changes, so the screen redraws only when something actually changed.
let renderPending = false;
function scheduleRender() {
  S.rev = (S.rev || 0) + 1;
  if (renderPending) return;
  renderPending = true;
  const go = () => { if (renderPending) { renderPending = false; if (typeof Modern !== 'undefined') Modern?.refresh(); } };
  requestAnimationFrame(go);
  setTimeout(go, 100); // rAF doesn't fire in background tabs
}
const renderNow = scheduleRender;

const Radio = {
  state: 'standby', // standby | stopped | tuning | live | buffering | paused | nosignal
  setState(s) { Radio.state = s; scheduleRender(); },
};
function setVolume(v) {
  audio.volume = Math.min(1, Math.max(0, Math.round(v * 50) / 50));
  if (audio.volume > 0 && audio.muted) setMuted(false);
}
function setMuted(m) {
  audio.muted = m;
  S.ui.muted = m;
  saveUi();
  scheduleRender();
}

/* Sleep timer: at zero the sound fades out over 8 seconds and the radio turns off. The screen shows the countdown. */
const Sleep = (() => {
  const api = { at: 0, fading: false };
  const two = n => String(n).padStart(2, '0');
  const clock = ms => { const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`; };
  api.set = minutes => {
    api.at = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    scheduleRender();
    toast(minutes > 0 ? `Sleep timer: the radio turns off in ${clock(minutes * 60000)}` : 'Sleep timer off');
  };
  async function fadeOut() {
    api.fading = true;
    const v0 = audio.volume;
    for (let i = 1; i <= 20 && session; i++) {
      audio.volume = v0 * (1 - i / 20);
      await new Promise(r => setTimeout(r, 400));
    }
    stopPlayback();
    audio.volume = v0; // ready at the usual volume next time
    api.fading = false;
    api.at = 0;
    toast('Sleep timer: radio off. Good night.');
  }
  // Its own clock, so it keeps counting while the screen is off.
  setInterval(() => {
    if (!api.at || api.fading || Date.now() < api.at) return;
    if (session) fadeOut();
    else api.at = 0;
  }, 1000);
  return api;
})();

/* Presets: 18 slots, saved in this browser (and in backups). */
const PRESET_SLOTS = 18;
const Presets = (() => {
  let presets = [];
  return {
    async load() { presets = (await DB.get('kv', 'presets')) || []; },
    all: () => presets,
    set(p) { if (Array.isArray(p)) { presets = p; DB.put('kv', presets, 'presets'); scheduleRender(); } },
    // Put stations into the empty slots (not ones already saved); returns how many went in.
    fill(stations) {
      const p = presets.slice(), have = new Set(p.filter(Boolean).map(x => x.key));
      let added = 0;
      for (const st of stations) {
        if (have.has(st.key)) continue;
        const i = Array.from({ length: PRESET_SLOTS }, (_, k) => k).find(k => !p[k]);
        if (i === undefined) break;
        p[i] = favRecord(st); have.add(st.key); added++;
      }
      if (added) Presets.set(p);
      return added;
    },
  };
})();

const favRecord = st => ({ key: st.key, name: st.name, logo: st.logo, group: st.group, country: st.country, sources: st.sources, addedAt: Date.now() });
const RECENT_MAX = 40;
function addRecent(st) {
  const rec = { ...favRecord(st), at: Date.now() };
  delete rec.addedAt;
  S.recent = [rec, ...S.recent.filter(r => r.key !== st.key)].slice(0, RECENT_MAX);
  DB.put('kv', S.recent, 'recent');
  scheduleRender();
}

/* What next / previous and auto-skip step through: the open list (the screen narrows it to what the picker shows). */
const sourceStations = () => (S.browse ? S.browse.stations : S.stations);
function applyFilters() {
  S.filtered = sourceStations();
  scheduleRender();
}

/* Radio Browser results are a temporary view ("browse") on top of your lists. */
let browseRun = 0;
async function browseRb({ label, query, save }) {
  const my = ++browseRun;
  S.browse = { kind: 'rb', label, query, save, stations: [], num: new Map() };
  S.loading = `Searching Radio Browser: ${label}…`;
  applyFilters();
  try {
    const entries = (await rbFetch(query)).map(rbEntry);
    if (my !== browseRun) return;
    const sts = mergeStations(entries);
    Object.assign(S.browse, { stations: sts, entries, num: new Map(sts.map((s, i) => [s.key, i + 1])) });
    indexUrls(sts, false);
  } catch (e) {
    if (my === browseRun) toast(e.message);
  } finally {
    if (my === browseRun) { S.loading = ''; applyFilters(); }
  }
}
function endBrowse(render = true) {
  browseRun++;
  const was = !!S.browse;
  S.browse = null;
  if (S.loading.startsWith('Searching')) S.loading = '';
  if (render && was) applyFilters();
}
const rbNameQuery = q => ({ label: `“${q}”`, query: `stations/search?name=${encodeURIComponent(q)}&order=votes&reverse=true&hidebroken=true&limit=300`, save: `Radio Browser · “${q}”` });

/* =========================================================================
   Backup / restore
   ========================================================================= */
async function exportData() {
  const data = {
    app: 'm3u-radio', version: 3, exportedAt: new Date().toISOString(),
    settings: S.settings, health: [...S.health.values()], recent: S.recent, songs: Songs.all(), presets: Presets.all(), lists: [],
  };
  for (const p of S.lists) data.lists.push({ ...p, entries: await DB.get('kv', 'list:' + p.id) });
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `radio-sala-company-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'm3u-radio') throw new Error('This is not a radio.sala.company backup.');
    if (data.settings) { S.settings = { ...DEFAULT_SETTINGS, ...data.settings }; await DB.put('kv', S.settings, 'settings'); }
    for (const h of data.health || []) { S.health.set(h.url, h); await DB.put('health', h); }
    if (data.recent?.length) {
      const seen = new Set(S.recent.map(r => r.key));
      S.recent = [...S.recent, ...data.recent.filter(r => !seen.has(r.key))].slice(0, RECENT_MAX);
      await DB.put('kv', S.recent, 'recent');
    }
    if (data.songs?.length) Songs.merge(data.songs);
    if (data.presets?.length) Presets.set(data.presets);
    if (data.favs?.length) Presets.fill(data.favs); // older backups: favorites go into empty preset slots
    for (const p of data.lists || []) {
      if (S.lists.some(x => x.id === p.id) || !p.entries) continue;
      const { entries, ...meta } = p;
      await DB.put('kv', entries, 'list:' + p.id);
      S.lists.push(meta);
    }
    await DB.put('kv', S.lists, 'lists');
    await selectList(S.lists.some(p => p.id === S.ui.currentId) ? S.ui.currentId : S.lists[0]?.id || null);
    toast('Backup imported');
  } catch (e) {
    toast('Import failed: ' + e.message);
  }
}
async function clearStats() {
  if (!confirm('Clear all test results and play history? Your ratings and presets are kept.')) return;
  await DB.clear('health');
  const keep = [...S.health.values()].filter(h => h.rating);
  S.health.clear();
  S.hosts.clear();
  for (const old of keep) { const h = H(old.url); h.rating = old.rating; await DB.put('health', h); }
  scheduleRender();
  toast('Test history cleared');
}
async function eraseAll() {
  if (!confirm('Erase all lists, presets, ratings, songs and settings from this browser?')) return;
  await Promise.all(['kv', 'health', 'favs'].map(s => DB.clear(s)));
  location.reload();
}

/* =========================================================================
   Settings, the song card and songs heard
   ========================================================================= */
function openSettings() {
  const s = S.settings;
  $('#sSlow').value = s.slowStartSec;
  $('#sTimeout').value = s.timeoutSec;
  $('#sAutoSkip').checked = s.autoSkip;
  $('#sAutoTest').checked = s.autoTest;
  $('#sConc').value = s.concurrency;
  const cur = S.lists.find(p => p.id === S.ui.currentId);
  $('#curListName').textContent = cur ? `Open list: ${cur.name} (${cur.count} stations)` : 'No list open';
  $('#refreshListBtn').disabled = !canRefresh(cur);
  $('#deleteListBtn').disabled = !cur;
  $('#shareListBtn').disabled = !cur;
  $('#setDlg').showModal();
}
const findQ = s => encodeURIComponent(s.artist && s.title ? `${s.artist} ${s.title}` : s.text);
const findLinks = s => `<a href="https://www.youtube.com/results?search_query=${findQ(s)}" target="_blank" rel="noopener">YouTube</a>
  <a href="https://open.spotify.com/search/${findQ(s)}" target="_blank" rel="noopener">Spotify</a>
  <a href="https://music.apple.com/search?term=${findQ(s)}" target="_blank" rel="noopener">Apple Music</a>`;
function openSongCard(st = S.current) {
  const np = NowPlaying.current(st);
  if (!np) return toast(st && session?.started ? 'This station hasn’t sent a song title yet' : 'Play a station first');
  const hist = NowPlaying.history;
  $('#songCard').innerHTML = `
    <div class="sc-now">
      <b class="sc-title">${esc(np.title || np.text)}</b>
      ${np.artist ? `<span class="sc-artist">${esc(np.artist)}</span>` : ''}
      <span class="muted small">${esc([np.album, withFlag(st.country, st.name), hhmm(np.at), 'from ' + np.source].filter(Boolean).join(' · '))}</span>
      <div class="sc-links">${findLinks(np)}<button type="button" id="songCopy">Copy</button></div>
    </div>
    ${hist.length ? `<h4>Earlier on this station</h4>${hist.map(h => `<div class="song"><span class="song-time">${esc(hhmm(h.at))}</span><span class="song-text"><b>${esc(h.text)}</b></span><span class="song-links">${findLinks(h)}</span></div>`).join('')}` : ''}`;
  $('#songCopy').addEventListener('click', () => navigator.clipboard?.writeText(np.text).then(() => toast('Copied: ' + np.text)));
  $('#songDlg').showModal();
}
function openSongs() {
  $('#songsSearch').value = '';
  renderSongs();
  $('#songsDlg').showModal();
}
const onClick = (sel, fn) => $(sel).addEventListener('click', fn);

function wire() {
  // Add a list
  $('#srcKind').addEventListener('change', showSrc);
  $('#rbMode').addEventListener('change', showSrc);
  $('#curGroup').addEventListener('change', showCurated);
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

  // Settings and your data
  $('#setForm').addEventListener('submit', e => {
    if (e.submitter?.value !== 'save') return;
    const d = DEFAULT_SETTINGS;
    S.settings = {
      ...S.settings,
      slowStartSec: clamp($('#sSlow').value, 1, 60, d.slowStartSec),
      timeoutSec: clamp($('#sTimeout').value, 3, 120, d.timeoutSec),
      autoSkip: $('#sAutoSkip').checked,
      autoTest: $('#sAutoTest').checked,
      concurrency: clamp($('#sConc').value, 1, 16, d.concurrency),
    };
    DB.put('kv', S.settings, 'settings');
    toast('Settings saved');
  });
  onClick('#refreshListBtn', () => { $('#setDlg').close(); refreshList(); });
  onClick('#deleteListBtn', () => { $('#setDlg').close(); deleteList(); });
  onClick('#exportBtn', exportData);
  onClick('#sharePresetsBtn', Share.sharePresets);
  onClick('#shareListBtn', Share.shareList);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  onClick('#clearStatsBtn', clearStats);
  onClick('#clearAllBtn', eraseAll);

  // Songs
  onClick('#songAll', () => { $('#songDlg').close(); openSongs(); });
  $('#songsSearch').addEventListener('input', renderSongs);
  onClick('#songsClear', () => { if (confirm('Clear the list of songs you heard?')) { Songs.clear(); renderSongs(); } });

  // Keyboard: Space pause · M mute · media keys · N / P next and previous
  document.addEventListener('keydown', e => {
    if (e.target.closest?.('input, textarea, select, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key, onButton = !!e.target.closest?.('button, a');
    if ((k === ' ' && !onButton) || k === 'MediaPlayPause') { e.preventDefault(); togglePause(); }
    else if (k === 'm' || k === 'M') setMuted(!audio.muted);
    else if (k === 'n' || k === 'N' || k === 'MediaTrackNext') step(1);
    else if (k === 'p' || k === 'P' || k === 'MediaTrackPrevious') step(-1);
  });

  let volTimer;
  audio.addEventListener('volumechange', () => {
    clearTimeout(volTimer);
    volTimer = setTimeout(() => { S.ui.volume = audio.volume; saveUi(); }, 300);
  });
}

async function init() {
  wire();
  const [lists, settings, ui, health, oldFavs, recentList] = await Promise.all([
    DB.get('kv', 'lists'), DB.get('kv', 'settings'), DB.get('kv', 'ui'), DB.all('health'), DB.all('favs'), DB.get('kv', 'recent'), Songs.load(), Presets.load(),
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
  // Favorites were retired in favor of presets: once, put them into the empty preset slots.
  if (oldFavs?.length && !S.ui.favsToPresets) {
    S.ui.favsToPresets = true;
    saveUi();
    const n = Presets.fill(oldFavs.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0)));
    if (n) toast(`Your ${n} favorite station${n > 1 ? 's are' : ' is'} now in your presets`);
  }
  const vol = Number(S.ui.volume ?? 0.8);
  audio.muted = !!S.ui.muted;
  setVolume(Number.isFinite(vol) ? vol : 0.8);
  Radio.setState('standby');

  const startId = S.lists.some(p => p.id === S.ui.currentId) ? S.ui.currentId : S.lists[0]?.id || null;
  await selectList(startId);

  // Show (but don't autoplay) the station played last.
  const last = S.byKey.get(S.ui.lastKey) || S.recent.find(r => r.key === S.ui.lastKey) || Presets.all().find(p => p?.key === S.ui.lastKey);
  if (last?.sources) { S.current = last; scheduleRender(); }

  // A share link (#share=…) carries stations or a list: offer to add them.
  const shared = location.hash.startsWith('#share=');
  if (shared) Share.receive();
  addEventListener('hashchange', () => { if (location.hash.startsWith('#share=')) Share.receive(); });
  // Shortcut: ?m3u=<playlist url> adds that list (once).
  const qp = new URLSearchParams(location.search).get('m3u');
  if (shared) { /* handled above */ }
  else if (qp && !S.lists.some(p => p.url === qp)) {
    // Ask first: a link shouldn't be able to add a list to someone's radio without them noticing.
    history.replaceState(null, '', location.pathname);
    if (/^https?:\/\//i.test(qp) && confirm(`Add the station list from ${new URL(qp).host}?`)) {
      loadWithSpinner({ kind: 'm3u', name: decodeURIComponent(qp.split('/').pop() || 'Shared list').replace(/\.(m3u8?|pls)$/i, ''), url: qp });
    }
  } else if (!S.lists.length && !S.ui.seeded) {
    // First visit: load Radio Browser's top stations. Only once, so removing it sticks.
    S.ui.seeded = true;
    saveUi();
    loadWithSpinner(DEFAULT_LIST);
  }
  // Show the "mirrored lists" option only when this site has some.
  fetch('lists/index.json', { method: 'HEAD', cache: 'no-store' }).then(r => { if (r.ok) $('#mirrorOpt').hidden = false; }).catch(() => {});
}
document.addEventListener('DOMContentLoaded', init);
