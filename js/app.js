'use strict';
/* =========================================================================
   Station details (below the radio): which link, your rating, test and play history.
   Name, logo, country, genre and the song are on the dial itself.
   ========================================================================= */
function renderNow() {
  const st = S.current;
  for (const b of document.querySelectorAll('.details button, #favBtn, #tFav')) b.disabled = !st;
  VFD.update();
  Radio.fav(!!st && S.favs.has(st.key));
  if (!st) { $('#nowStats').innerHTML = '<div>Pick a station to see its links, test results and earlier songs.</div>'; return; }
  const url = currentSourceUrl();
  const src = st.sources.find(s => s.url === url) || st.sources[0];
  const h = S.health.get(src.url);
  for (const b of document.querySelectorAll('.rate [data-rate]')) b.classList.toggle('on', !!b.dataset.rate && b.dataset.rate === (h?.rating || ''));
  const sel = $('#sourceSel');
  sel.classList.toggle('hidden', st.sources.length < 2);
  if (st.sources.length > 1) {
    sel.innerHTML = st.sources.map((s, i) => {
      const f = formatOf(s);
      return `<option value="${esc(s.url)}"${s.url === src.url ? ' selected' : ''}>Link ${i + 1}${f ? ' · ' + esc(f) : ''} · ${esc(sourceStatus(s).label)}</option>`;
    }).join('');
  }
  const np = NowPlaying.current(st);
  const lines = [];
  lines.push(`${badgeHtml(stationStatus(st))} <span>${esc(stationStatus(st).tip)}</span>`);
  if (st.sources.length > 1) lines.push(esc(`Showing link ${st.sources.indexOf(src) + 1} of ${st.sources.length}. If one fails, the next one is tried automatically.`));
  if (h?.plays) {
    lines.push(esc(`Played ${h.plays}× · ${h.ok + h.slow} started · ${h.fails} failed · ${h.stalls} with dropouts` +
      (h.avgStartMs ? ` · average start ${fmtS(h.avgStartMs)}` : '') + ` · last ${ago(h.lastPlay)}`));
  }
  if (h?.lastResult === 'fail' && h.lastNote) lines.push(esc(`Last problem: ${h.lastNote}`));
  if (h?.probe) lines.push(esc(`Test ${ago(h.probe.at)}: ${fromProbe(h.probe).label}${h.probe.note ? ' · ' + h.probe.note : ''}`));
  if (src.rbOk === 0) lines.push(esc('Radio Browser’s own check failed for this link last time.'));
  if (isMixed(src.url)) lines.push(esc('Plain-HTTP stream: playing the HTTPS version, because browsers block plain HTTP on this page.'));
  if (np && NowPlaying.history.length) lines.push(esc('Earlier: ' + NowPlaying.history.map(x => `${hhmm(x.at)} ${x.text}`).join(' · ')));
  if (session?.started && session.st.key === st.key && NowPlaying.method === 'none') {
    lines.push(esc('No song or show titles: this station’s server doesn’t share them with web pages.'));
  }
  $('#nowStats').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

function setRating(r) {
  const url = currentSourceUrl();
  if (!url) return;
  const h = H(url);
  h.rating = r;
  saveH(h);
  toast(r ? `Marked as ${LABEL[{ good: 'good', buffers: 'warn', broken: 'bad' }[r]].toLowerCase()}` : 'Mark cleared');
}
const favRecord = st => ({ key: st.key, name: st.name, logo: st.logo, group: st.group, country: st.country, sources: st.sources, addedAt: Date.now() });
function toggleFav(st) {
  if (!st) return;
  if (S.favs.has(st.key)) { S.favs.delete(st.key); DB.del('favs', st.key); toast('Removed from favorites'); }
  else { const f = favRecord(st); S.favs.set(st.key, f); DB.put('favs', f); toast('Saved to favorites (Show: ★ Favorites)'); }
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
   Backup / restore
   ========================================================================= */
async function exportData() {
  const data = {
    app: 'm3u-radio', version: 2, exportedAt: new Date().toISOString(),
    settings: S.settings, favs: [...S.favs.values()], health: [...S.health.values()], recent: S.recent, songs: Songs.all(), presets: Car.presets(), lists: [],
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
    for (const f of data.favs || []) { S.favs.set(f.key, f); await DB.put('favs', f); }
    for (const h of data.health || []) { S.health.set(h.url, h); await DB.put('health', h); }
    if (data.recent?.length) {
      const seen = new Set(S.recent.map(r => r.key));
      S.recent = [...S.recent, ...data.recent.filter(r => !seen.has(r.key))].slice(0, RECENT_MAX);
      await DB.put('kv', S.recent, 'recent');
    }
    if (data.songs?.length) Songs.merge(data.songs);
    if (data.presets?.length) Car.importPresets(data.presets);
    for (const p of data.lists || []) {
      if (S.lists.some(x => x.id === p.id) || !p.entries) continue;
      const { entries, ...meta } = p;
      await DB.put('kv', entries, 'list:' + p.id);
      S.lists.push(meta);
    }
    await DB.put('kv', S.lists, 'lists');
    allCache = null;
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
  if (!confirm('Erase all lists, favorites, ratings, songs and settings from this browser?')) return;
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
  $('#sSkin').value = s.skin === 'ipod' ? 'ipod' : 'radio';
  $('#setDlg').showModal();
}
function openSongs() {
  $('#songsSearch').value = '';
  renderSongs();
  $('#songsDlg').showModal();
}
const onClick = (sel, fn) => $(sel).addEventListener('click', fn);

function wire() {
  // Station guide
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
    if (row) {
      $('#list').focus({ preventScroll: true });
      playStation(S.filtered[+row.dataset.i]);
      if (isCar() && Picker.isOpen()) Picker.close(); // car radio: picking a station takes you back to it
    }
  });
  $('#listInner').addEventListener('pointerover', e => {
    const row = e.target.closest('.ch');
    if (!row) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { const st = S.filtered[+row.dataset.i]; if (st) preconnect(orderedSources(st)[0].url); }, 120);
  });

  // Search, scope, chips, filters
  let searchTimer;
  $('#search').addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => onSearchInput(e.target.value), 150); });
  $('#scopeSel').addEventListener('change', e => setScope(e.target.value));
  $('#chips').addEventListener('click', e => {
    const c = e.target.closest('[data-chip]')?.dataset.chip;
    if (!c) return;
    if (S.browse?.chip === c) return endBrowse();
    S.ui.scope = 'view';
    $('#scopeSel').value = 'view';
    browseRb(chipQuery(c));
  });
  $('#browseBar').addEventListener('click', e => {
    const a = e.target.closest('[data-bb]')?.dataset.bb;
    if (a === 'save') saveBrowse();
    else if (a === 'close') endBrowse();
  });
  $('#groupFilter').addEventListener('change', e => { S.ui.group = e.target.value; saveUi(); applyFilters(); });
  $('#countryFilter').addEventListener('change', e => { S.ui.country = e.target.value; saveUi(); applyFilters(); });
  $('#langFilter').addEventListener('change', e => { S.ui.lang = e.target.value; saveUi(); applyFilters(); });
  $('#statusFilter').addEventListener('change', e => { S.ui.status = e.target.value; saveUi(); Radio.syncDx(); rebuildGroups(); applyFilters(); });
  $('#sortSel').addEventListener('change', e => { S.ui.sort = e.target.value; saveUi(); applyFilters(); });
  onClick('#testBtn', () => {
    if (T.manual && (T.active || T.queue.length)) return stopTests();
    const urls = testUrlsFor(S.filtered);
    if (!urls.length) return toast(S.filtered.length ? 'Everything here was checked in the last 6 hours' : 'Nothing to test');
    if (urls.length > 1500 && !confirm(`Test ${urls.length} stations? This can take a while. Tip: pick a genre or country first.`)) return;
    queueTests(urls, { manual: true });
  });

  // Lists
  $('#listSelect').addEventListener('change', e => selectList(e.target.value));
  onClick('#addListBtn', openAddDialog);
  onClick('#refreshListBtn', () => refreshList());
  onClick('#deleteListBtn', deleteList);
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

  // Settings, songs, help
  onClick('#settingsBtn', openSettings);
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
      skin: $('#sSkin').value === 'ipod' ? 'ipod' : 'radio',
    };
    DB.put('kv', S.settings, 'settings');
    Radio.refreshFx();
    Ipod.apply();
    toast('Settings saved');
  });
  onClick('#exportBtn', exportData);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
  onClick('#clearStatsBtn', clearStats);
  onClick('#clearAllBtn', eraseAll);
  onClick('#songsBtn', openSongs);
  onClick('#lookBtn', () => Ipod.setSkin(S.settings.skin === 'ipod' ? 'radio' : 'ipod'));
  $('#songsSearch').addEventListener('input', renderSongs);
  onClick('#songsClear', () => { if (confirm('Clear the list of songs you heard?')) { Songs.clear(); renderSongs(); } });
  onClick('#helpBtn', () => $('#helpDlg').showModal());

  // The radio: dial, bands, knobs, switches, keys
  onClick('#dial', e => {
    const n = S.filtered.length;
    if (!n) return;
    const dial = $('#dial');
    const cs = getComputedStyle(dial);
    const sl = parseFloat(cs.getPropertyValue('--sl')) || 0, sr = parseFloat(cs.getPropertyValue('--sr')) || 0;
    const r = dial.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left - sl) / (r.width - sl - sr)));
    playStation(S.filtered[Math.round(frac * (n - 1))]);
  });
  onClick('#bands', e => {
    const b = e.target.closest('[data-band]');
    const id = b && S.lists[+b.dataset.band]?.id;
    if (id && (id !== S.ui.currentId || S.browse)) selectList(id);
  });
  knob($('#tuneKnob'), 18, turnTuning);
  knob($('#bandKnob'), 30, turnBand);
  knob($('#volKnob'), 8, s => setVolume(audio.volume + s * 0.04));
  onClick('#playBtn', togglePlay);
  onClick('#dxBtn', () => {
    S.ui.status = S.ui.status === 'hideBad' ? 'all' : 'hideBad';
    $('#statusFilter').value = S.ui.status;
    saveUi(); Radio.syncDx(); rebuildGroups(); applyFilters();
    toast(S.ui.status === 'hideBad' ? 'LOCAL: hiding stations that are off air or blocked' : 'DX: showing every station');
  });
  onClick('#lightBtn', () => { S.settings.fx = !S.settings.fx; DB.put('kv', S.settings, 'settings'); Radio.refreshFx(); });
  for (const id of ['#sleepSel', '#miniSleepSel']) $(id).addEventListener('change', e => Sleep.set(+e.target.value));
  onClick('#favBtn', () => toggleFav(S.current));
  onClick('#prevBtn', () => step(-1));
  onClick('#nextBtn', () => step(1));
  // Transport row under the dial
  onClick('#tPrev', () => step(-1));
  onClick('#tNext', () => step(1));
  onClick('#tPause', togglePause);
  onClick('#tStop', stopPlayback);
  onClick('#tMute', () => setMuted(!audio.muted));
  onClick('#tLive', goLive);
  onClick('#tFav', () => toggleFav(S.current));
  // Phone mini-player + sheet
  onClick('#miniOpen', () => Sheet.open());
  onClick('#miniExpand', () => Sheet.open());
  // Swipe the player bar up to open the radio (like music apps).
  let swipeY = null;
  $('#mini').addEventListener('touchstart', e => { swipeY = e.touches[0].clientY; }, { passive: true });
  $('#mini').addEventListener('touchend', e => { if (swipeY !== null && swipeY - e.changedTouches[0].clientY > 40) Sheet.open(); swipeY = null; }, { passive: true });
  onClick('#sheetClose', () => Sheet.close());
  onClick('#miniPlay', togglePause);
  onClick('#miniNext', () => step(1));
  onClick('#miniMute', () => setMuted(!audio.muted));
  // Station details
  $('#sourceSel').addEventListener('change', e => S.current && playStation(S.current, e.target.value));
  for (const b of document.querySelectorAll('[data-rate]')) b.addEventListener('click', () => setRating(b.dataset.rate));
  onClick('#copyBtn', copyLink);
  onClick('#testOneBtn', () => {
    if (!S.current) return;
    queueTests(S.current.sources.map(s => s.url), { force: true, front: true });
    toast(S.current.sources.length > 1 ? `Testing all ${S.current.sources.length} links…` : 'Testing…');
  });

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

  // Keyboard: ↑↓ guide · Enter play · ←→ prev/next · Space pause · M mute · F favorite · Esc back to playing
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
    else if (k === 'Escape') { if (Picker.isOpen()) Picker.close(); if (document.body.classList.contains('sheet-open')) Sheet.close(); S.cursor = S.current ? S.filtered.findIndex(c => c.key === S.current.key) : -1; scrollToCurrent(); scheduleRender(); }
    else if (k === 'f' || k === 'F') { toggleFav(S.filtered[S.cursor] || S.current); }
    else if (k === 'm' || k === 'M') { setMuted(!audio.muted); }
    else if ((k === ' ' && !onButton) || k === 'MediaPlayPause') { handled(); togglePause(); }
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
    DB.get('kv', 'lists'), DB.get('kv', 'settings'), DB.get('kv', 'ui'), DB.all('health'), DB.all('favs'), DB.get('kv', 'recent'), Songs.load(), Car.load(),
  ]);
  S.recent = recentList || [];
  S.lists = lists || [];
  S.settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  S.ui = { ...S.ui, ...(ui || {}), search: '', scope: 'view' };
  const recent = Date.now() - 24 * 3600e3;
  for (const h of health || []) {
    S.health.set(h.url, h);
    if (h.probe && !h.probe.inferred && h.probe.at > recent) noteHost(h.url, h.probe);
  }
  for (const f of favs || []) S.favs.set(f.key, f);
  const vol = Number(S.ui.volume ?? 0.8);
  audio.muted = !!S.ui.muted;
  setVolume(Number.isFinite(vol) ? vol : 0.8);
  Radio.muted(audio.muted);
  Radio.refreshFx();
  Radio.setState('standby');
  Sheet.sync();
  Picker.sync();
  Ipod.apply();

  const startId = S.lists.some(p => p.id === S.ui.currentId) ? S.ui.currentId : S.lists[0]?.id || null;
  await selectList(startId);

  // Show (but don't autoplay) the station played last.
  const last = S.byKey.get(S.ui.lastKey) || S.favs.get(S.ui.lastKey) || S.recent.find(r => r.key === S.ui.lastKey);
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
  // First visit: explain the radio once.
  if (!S.ui.helpSeen) {
    S.ui.helpSeen = true;
    saveUi();
    $('#helpDlg').showModal();
  }
  // Show the "mirrored lists" option only when this site has some.
  fetch('lists/index.json', { method: 'HEAD', cache: 'no-store' }).then(r => { if (r.ok) $('#mirrorOpt').hidden = false; }).catch(() => {});
}
init();
