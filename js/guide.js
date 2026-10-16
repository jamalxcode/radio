'use strict';
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
const BARS = { good: '▮▮▮▮', warn: '▮▮▯▯', bad: '▯▯▯▯', blocked: '✕', untested: '····' };
const badgeHtml = st => `<span class="badge ${st.cls}" aria-label="${esc(st.label)}"><i aria-hidden="true">${BARS[st.cls] || ''}</i>${esc(st.label)}</span>`;
// Position in what's shown: browse results are numbered on their own, otherwise the list's numbers. ★ = from favorites / recent.
const stNum = st => S.browse?.num.get(st.key) ?? S.numByKey.get(st.key) ?? '★';
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
      : !S.lists.length && !S.browse
        ? '<div class="empty">No station list yet.<br><button class="primary" data-act="add">+ Add a list</button></div>'
        : S.ui.status === 'fav' && !S.favs.size
          ? '<div class="empty">No favorites yet.<br>Tap ☆ next to a station to save it here.</div>'
          : S.ui.status === 'recent' && !S.recent.length
            ? '<div class="empty">Nothing played yet.<br>Stations you play show up here.</div>'
            : S.browse?.kind === 'rb' && !S.browse.query
              ? '<div class="empty">Type a station name above to search all of Radio Browser.</div>'
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
  return S.browse ? S.browse.stations : S.stations;
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
let scrollIdle, hoverTimer;
function applyFilters(keepScroll = false) {
  // In "Radio Browser" search the server already matched the name; elsewhere the box filters what's shown.
  const q = S.ui.scope === 'rb' ? '' : S.ui.search.toLowerCase().trim();
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
   Finding stations beyond the list you have open:
     search scope  "This view" filters what's shown · "All my lists" merges every list ·
                   "Radio Browser" searches all of it by name
     chips         Near me, Trending and popular genres, straight from Radio Browser
   Results are a temporary view ("browse"); save it as a list to keep it on a band.
   ========================================================================= */
const RB_FEW = '&order=votes&reverse=true&hidebroken=true&limit=500';
const CHIPS = {
  near: () => ({ label: `Near me · ${countryName(userCountry.toLowerCase())}`, query: `stations/search?countrycode=${userCountry}${RB_FEW}`, save: `Radio Browser · ${countryName(userCountry.toLowerCase())}` }),
  trending: () => ({ label: 'Trending now', query: 'stations/search?order=clicktrend&reverse=true&hidebroken=true&limit=300', save: 'Radio Browser · Trending' }),
};
const chipQuery = c => (CHIPS[c] ? CHIPS[c]() : { label: c[0].toUpperCase() + c.slice(1), query: `stations/search?tag=${encodeURIComponent(c)}${RB_FEW}`, save: `Radio Browser · ${c}`, chip: c });
let allCache = null, browseRun = 0, rbSearchTimer;

function showBrowse() {
  const bar = $('#browseBar');
  const b = S.browse;
  bar.classList.toggle('hidden', !b);
  for (const c of document.querySelectorAll('#chips [data-chip]')) c.classList.toggle('on', !!b && b.chip === c.dataset.chip);
  if (!b) return;
  const back = S.lists.find(l => l.id === S.ui.currentId);
  bar.innerHTML = `<span class="bb-label">${b.kind === 'all' ? 'All my lists' : 'Radio Browser'} · <b>${esc(b.label)}</b>${b.stations.length ? ` · ${b.stations.length}` : ''}</span>` +
    (b.kind === 'rb' && b.entries?.length ? '<button data-bb="save" title="Keep these stations as a list on the next free band">＋ Save as list</button>' : '') +
    `<button data-bb="close" title="Back to your list">✕${back ? ' ' + esc(bandLabel(S.lists.indexOf(back))) : ''}</button>`;
}
async function browseRb({ label, query, save, chip }) {
  const my = ++browseRun;
  S.browse = { kind: 'rb', label, query, save, chip, stations: [], num: new Map() };
  S.loading = `Searching Radio Browser: ${label}…`;
  showBrowse();
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
    if (my === browseRun) { S.loading = ''; showBrowse(); rebuildGroups(); applyFilters(); }
  }
}
async function browseAll() {
  const my = ++browseRun;
  const sig = S.lists.map(l => l.id + ':' + l.updatedAt).join('|');
  if (allCache?.sig !== sig) {
    S.loading = 'Merging your lists…';
    renderList();
    const all = [];
    for (const l of S.lists) all.push(...((await DB.get('kv', 'list:' + l.id)) || []));
    allCache = { sig, stations: mergeStations(all) };
    S.loading = '';
  }
  if (my !== browseRun) return;
  const sts = allCache.stations;
  S.browse = { kind: 'all', label: `${S.lists.length} lists`, stations: sts, num: new Map(sts.map((s, i) => [s.key, i + 1])) };
  indexUrls(sts, false);
  showBrowse();
  rebuildGroups();
  applyFilters();
}
function endBrowse(render = true) {
  browseRun++;
  clearTimeout(rbSearchTimer);
  const was = !!S.browse || S.ui.scope !== 'view';
  S.browse = null;
  S.ui.scope = 'view';
  $('#scopeSel').value = 'view';
  $('#search').placeholder = 'Filter this list…';
  if (S.loading.startsWith('Searching') || S.loading.startsWith('Merging')) S.loading = '';
  showBrowse();
  if (render && was) { rebuildGroups(); applyFilters(); }
}
const rbNameQuery = q => ({ label: `“${q}”`, query: `stations/search?name=${encodeURIComponent(q)}&order=votes&reverse=true&hidebroken=true&limit=300`, save: `Radio Browser · “${q}”` });
function setScope(v) {
  if (v === 'view') return endBrowse();
  S.ui.scope = v;
  $('#scopeSel').value = v;
  $('#search').placeholder = v === 'rb' ? 'Search all of Radio Browser…' : 'Filter all my lists…';
  if (v === 'all') return browseAll();
  const q = S.ui.search.trim();
  if (q.length >= 2) return browseRb(rbNameQuery(q));
  browseRun++;
  S.browse = { kind: 'rb', label: 'type a name', stations: [], num: new Map() };
  showBrowse();
  applyFilters();
  $('#search').focus();
}
function onSearchInput(v) {
  S.ui.search = v;
  if (S.ui.scope !== 'rb') return applyFilters();
  clearTimeout(rbSearchTimer);
  const q = v.trim();
  if (q.length >= 2) rbSearchTimer = setTimeout(() => browseRb(rbNameQuery(q)), 450);
}
async function saveBrowse() {
  const b = S.browse;
  if (!b?.entries?.length) return;
  S.ui.search = '';
  $('#search').value = '';
  try {
    await addList({ kind: 'rb', name: b.save || `Radio Browser · ${b.label}`, query: b.query.replace(/limit=\d+/, 'limit=3000') }, b.entries);
  } catch (e) {
    toast(e.message);
  }
}
