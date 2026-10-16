'use strict';
/* =========================================================================
   Station lists: Radio Browser JSON, M3U/PLS text, SomaFM JSON — all turned
   into the same entries, then duplicates merged into one station with backups.
   ========================================================================= */
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
        lang: langNames(attrs['tvg-language']),
      };
    } else if (/^#EXTGRP:/i.test(line)) {
      if (cur && !cur.group) cur.group = line.slice(8).trim();
    } else if (!line.startsWith('#')) {
      const url = line.split('|')[0].trim().replace(/^icy:/i, 'http:');
      if (!isStreamUrl(url)) { cur = null; continue; }
      out.push({ name: cur?.name || url.split('/').pop() || 'Unnamed', logo: cur?.logo || '',
                 group: (cur?.group || defGroup || 'Ungrouped').replace(/_/g, ' '), country: cur?.country || '', lang: cur?.lang || '', url });
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
           codec: s.codec && s.codec !== 'UNKNOWN' ? s.codec : '', hls: !!s.hls, uuid: s.stationuuid, rbOk: s.lastcheckok,
           lang: langNames(s.language) };
}
function somaEntries(json) {
  const out = [];
  for (const c of json.channels || []) {
    for (const p of c.playlists || []) {
      out.push({ name: c.title, logo: c.xlimage || c.largeimage || c.image || '', group: (c.genre || '').split('|').join(';'),
                 country: 'us', lang: 'English', url: p.url, codec: (p.format || '').toUpperCase() });
    }
  }
  return out;
}

const groupsOf = st => (st.group || '').split(';').map(g => g.trim()).filter(Boolean);
const groupLabel = st => groupsOf(st).join(', ');
// Languages, tidied: "english,GERMAN" -> "English;German" (at most 3).
function langNames(raw) {
  return [...new Set(String(raw || '').split(/[,;/|]/).map(l => l.toLowerCase().replace(/[^\p{L}\s-]/gu, '').trim()).filter(l => l.length > 1 && l.length < 30)
    .map(l => l.replace(/(^|[\s-])\p{L}/gu, c => c.toUpperCase())))].slice(0, 3).join(';');
}
const langsOf = st => (st.lang || '').split(';').filter(Boolean);
const cleanName = n => n.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
const stationKey = e => 'n:' + cleanName(e.name).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + '|' + (e.country || '');
function mergeStations(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!e.url) continue;
    const key = stationKey(e);
    let st = map.get(key);
    if (!st) {
      st = { key, name: cleanName(e.name) || e.name, logo: e.logo, group: e.group, country: e.country, lang: langNames((e.lang || '').replace(/;/g, ',')), sources: [] };
      map.set(key, st);
    } else {
      if (!st.logo) st.logo = e.logo;
      const groups = new Set(groupsOf(st));
      for (const g of e.group.split(';')) if (g.trim()) groups.add(g.trim());
      st.group = [...groups].slice(0, 6).join(';');
      if (e.lang) st.lang = langNames([...langsOf(st), ...e.lang.split(';')].join(','));
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
   Your saved lists (the BAND knob)
   ========================================================================= */
function renderLists() {
  const sel = $('#listSelect');
  sel.innerHTML = S.lists.length
    ? S.lists.map((p, i) => `<option value="${p.id}"${p.id === S.ui.currentId ? ' selected' : ''}>${esc(bandLabel(i))} · ${esc(p.name)} (${p.count})</option>`).join('')
    : '<option value="">No lists yet</option>';
  const cur = S.lists.find(p => p.id === S.ui.currentId);
  $('#refreshListBtn').disabled = !canRefresh(cur);
  $('#deleteListBtn').disabled = !cur;
}
const canRefresh = p => !!p && (p.kind !== 'm3u' || !!p.url);
// Remember which station each stream URL belongs to (the tester and player look this up).
function indexUrls(sts, overwrite = true) {
  for (const c of sts) for (const s of c.sources || []) if (overwrite || !S.byUrl.has(s.url)) S.byUrl.set(s.url, c);
}
function setStations(sts) {
  S.stations = sts;
  S.byKey = new Map(sts.map(c => [c.key, c]));
  S.numByKey = new Map(sts.map((c, i) => [c.key, i + 1]));
  S.byUrl = new Map();
  for (const f of S.favs.values()) for (const s of f.sources || []) S.byUrl.set(s.url, S.byKey.get(f.key) || f);
  indexUrls(S.recent, false);
  indexUrls(sts);
  if (S.browse) indexUrls(S.browse.stations, false);
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
  allCache = null;
  if (S.ui.status === 'fav' || S.ui.status === 'recent') S.ui.status = 'all';
  await selectList(id, sts);
  toast(S.lists.length <= BANDS.length ? `Added ${sts.length} stations on band ${bandLabel(S.lists.length - 1)}` : `Added ${sts.length} stations`);
}
async function selectList(id, parsed) {
  S.ui.currentId = id;
  S.ui.group = '';
  endBrowse(false);
  saveUi();
  const saved = !id || parsed ? null : (await DB.get('kv', 'list:' + id)) || [];
  setStations(!id ? [] : parsed || mergeStations(saved));
  // Radio Browser lists saved before languages were kept: fetch them again once, quietly.
  const metaNow = S.lists.find(p => p.id === id);
  if (metaNow?.kind === 'rb' && saved?.length && !('lang' in saved[0])) refreshList(metaNow, true);
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
  allCache = null;
}
const refreshing = new Set();
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
      if (!S.browse) { rebuildGroups(); applyFilters(true); }
    }
    toast(`“${p.name}” updated: ${sts.length} stations`);
  } catch (e) {
    if (!quiet) toast(e.message); // offline or blocked: keep using the saved copy
  } finally {
    refreshing.delete(p.id);
  }
}
function backgroundRefresh(p) {
  if (p && Date.now() - (p.updatedAt || p.addedAt || 0) >= REFRESH_AFTER) refreshList(p, true);
}
async function deleteList() {
  const p = S.lists.find(x => x.id === S.ui.currentId);
  if (!p || !confirm(`Remove the list “${p.name}”? Your favorites and ratings are kept.`)) return;
  await DB.del('kv', 'list:' + p.id);
  S.lists = S.lists.filter(x => x !== p);
  await DB.put('kv', S.lists, 'lists');
  allCache = null;
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
