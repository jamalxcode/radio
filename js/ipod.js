'use strict';
/* =========================================================================
   The iPod look (Settings → Look, or the ◉ button): a black click-wheel player that fills the screen.
     screen      status bar (clock · title · play state · battery), then either
                 a split menu (list on the left, station art on the right) or the Now Playing screen
     click wheel turn = move the highlight (or the volume on Now Playing) · centre = select
                 MENU = back (hold = main menu) · ⏮ ⏭ = previous / next station · ▶❚❚ = play / pause
   Folded phone (≤ 600 px): the iPod alone; the full station guide opens from Stations › Search.
   Fold open / tablet / desktop: the station guide on the left page, the iPod on the right page.
   ========================================================================= */
const Ipod = (() => {
  const ROWS = 7;                    // rows on a menu screen (they fill the screen exactly)
  const api = {};
  let stack = [];                    // menu screens, last = the one showing
  let np = false;                    // Now Playing showing?
  let lastHtml = '';
  let volUntil = 0;                  // show the volume bar until this time
  let battery = null;

  const on = () => document.body.classList.contains('look-ipod');
  api.on = on;
  const el = id => document.getElementById(id);

  /* ---------- screens ----------
     Each screen: title, n() rows, row(i) → { t: text, r: right text, dot?: status class }, act(i), sel, top. */
  const statusDot = st => stationStatus(st).cls;
  const stationRow = st => ({ h: flagHtml(st.country) + esc(st.name), dot: statusDot(st), st });
  const listScreen = (title, get, onPick, empty) => ({
    title,
    n: () => get().length || (empty ? 1 : 0),
    row: i => (get().length ? stationRow(get()[i]) : { t: empty, muted: true }),
    act: i => { const st = get()[i]; if (st) onPick(st); },
    sel: 0, top: 0,
  });
  const menu = (title, items) => ({ title, n: () => items().length, row: i => items()[i], act: i => items()[i]?.act?.(), sel: 0, top: 0 });

  const SLEEPS = [[0, 'Off'], [30, '30 minutes'], [60, '1 hour'], [90, '1½ hours'], [120, '2 hours'], [150, '2½ hours'], [180, '3 hours']];
  const screens = {
    main: () => menu('radio.sala.company', () => [
      ...(S.current ? [{ t: 'Now Playing', r: '›', act: () => showNp() }] : []),
      { t: 'Stations', r: '›', act: () => push(screens.stations()) },
      { t: 'Lists', r: '›', act: () => push(screens.lists()) },
      { t: 'Favorites', r: '›', act: () => push(screens.favs()) },
      { t: 'Recent', r: '›', act: () => push(screens.recent()) },
      { t: 'Search', r: '›', act: openSearch },
      { t: 'Songs heard', r: '›', act: openSongs },
      { t: 'Sleep', r: Sleep.at ? Sleep.left() + ' min' : '›', act: () => push(screens.sleep()) },
      { t: 'Settings', r: '›', act: () => push(screens.settings()) },
    ]),
    stations: () => {
      const s = listScreen('', () => S.filtered, st => { playStation(st); showNp(); }, 'No stations in this list');
      s.titleFn = () => S.browse?.label || S.lists.find(p => p.id === S.ui.currentId)?.name.replace(/^Radio Browser · |^junguler · /, '') || 'Stations';
      // open with the station that's on under the highlight
      const i = S.current ? S.filtered.findIndex(c => c.key === S.current.key) : -1;
      if (i >= 0) { s.sel = i; s.top = Math.max(0, i - 3); }
      return s;
    },
    favs: () => listScreen('Favorites', () => [...S.favs.values()], st => { playStation(S.byKey.get(st.key) || st); showNp(); }, 'No favorites yet'),
    recent: () => listScreen('Recent', () => S.recent, st => { playStation(S.byKey.get(st.key) || st); showNp(); }, 'Nothing played yet'),
    lists: () => menu('Lists', () => [
      ...S.lists.map((p, i) => ({ t: p.name, r: p.id === S.ui.currentId ? '●' : bandLabel(i), act: async () => { if (p.id !== S.ui.currentId || S.browse) await selectList(p.id); pop(); push(screens.stations()); } })),
      { t: 'Add a list…', r: '+', act: openAddDialog },
    ]),
    sleep: () => menu('Sleep', () => SLEEPS.map(([m, t]) => ({ t, r: !Sleep.at && m === 0 ? '●' : '', act: () => { Sleep.set(m); pop(); } }))),
    settings: () => menu('Settings', () => [
      { t: 'Look', r: 'iPod ›', act: () => api.setSkin('radio') },
      { t: 'Hide off-air stations', r: S.ui.status === 'hideBad' ? 'On' : 'Off', act: () => { $('#statusFilter').value = S.ui.status = S.ui.status === 'hideBad' ? 'all' : 'hideBad'; saveUi(); rebuildGroups(); applyFilters(); } },
      { t: 'Skip stations that fail', r: S.settings.autoSkip ? 'On' : 'Off', act: () => { S.settings.autoSkip = !S.settings.autoSkip; DB.put('kv', S.settings, 'settings'); } },
      { t: 'Mute', r: audio.muted ? 'On' : 'Off', act: () => setMuted(!audio.muted) },
      { t: 'More settings & backup…', r: '›', act: openSettings },
      { t: 'Help', r: '›', act: () => $('#helpDlg').showModal() },
    ]),
  };
  function openSearch() {
    if (isCar()) Picker.open();
    else $('#search').focus();
  }
  const top = () => stack[stack.length - 1];
  function push(s) { np = false; stack.push(s); render(true); }
  function pop() { if (np) { np = false; } else if (stack.length > 1) stack.pop(); render(true); }
  function showNp() { if (!S.current) return; np = true; render(true); }
  function home() { stack = [screens.main()]; np = false; render(true); }

  /* ---------- rendering ---------- */
  const art = st => (st?.logo
    ? `<img src="${esc(st.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('noart');this.remove()">`
    : '') + '<i class="ipod-scene"><b></b><b></b><b></b></i>';
  const NPSTATE = { standby: 'Standby', stopped: 'Stopped', tuning: 'Tuning…', live: 'On air', buffering: 'Buffering…', paused: 'Paused', nosignal: 'No signal' };
  const two = n => String(n).padStart(2, '0');
  const since = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600); return h ? `${h}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`; };

  function render(force) {
    if (!on()) return;
    if (!stack.length) stack = [screens.main()];
    const st = S.current;
    const s = session && st && session.st.key === st.key ? session : null;
    const playing = PLAYING_STATES.includes(Radio.state);
    // status bar
    el('ipodClock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    el('ipodPlayIco').className = 'ipod-pi ' + (playing ? 'play' : Radio.state === 'paused' ? 'pause' : '');
    if (battery) { el('ipodBatt').style.setProperty('--lvl', battery.level); el('ipodBatt').classList.toggle('chg', battery.charging); }
    let html, title;
    if (np && st) {
      title = 'Now Playing';
      const nowp = NowPlaying.current(st);
      const meta = [st.country ? countryName(st.country) : '', langsOf(st).join(', '), groupLabel(st)].filter(x => x && x.length > 1).join(' · ');
      const showVol = Date.now() < volUntil;
      const ss = stationStatus(st);
      html = `<div class="ipod-np">
        <div class="np-art${st.logo ? '' : ' noart'}">${art(st)}</div>
        <div class="np-info">
          <b>${withFlag(st.country, esc(st.name))}</b>
          <span class="np-track">${nowp ? '♪ ' + esc(nowp.text) : esc(meta)}</span>
          ${nowp ? `<span class="np-meta">${esc(meta)}</span>` : ''}
          <span class="np-state lvl-${{ live: 'good', buffering: 'warn', tuning: 'warn', paused: 'warn', nosignal: 'bad' }[Radio.state] || ''}">${NPSTATE[Radio.state] || ''}${s?.liveAt && Radio.state !== 'stopped' ? ' · ' + since(Date.now() - s.liveAt) : ''}${Sleep.at ? ' · ☾ ' + Sleep.left() + ' min' : ''}</span>
          <span class="np-sig">${BARS[ss.cls]} ${esc(ss.label)}${st.sources.length > 1 ? ` · link ${s ? s.idx + 1 : 1}/${st.sources.length}` : ''}${s?.relay ? ' · via relay' : ''}</span>
        </div>
        <div class="np-bar${showVol ? ' vol' : ''}">
          <span>${showVol ? '🔈' : S.favs.has(st.key) ? '★' : '☆'}</span>
          <div class="np-track-bar"><i style="width:${showVol ? Math.round(audio.volume * 100) : s?.started ? 100 : 0}%"></i></div>
          <span>${showVol ? Math.round(audio.volume * 100) + '%' : audio.muted ? '🔇' : '🔊'}</span>
        </div>
      </div>`;
    } else {
      const sc = top();
      title = sc.titleFn ? sc.titleFn() : sc.title;
      const n = sc.n();
      if (sc.sel >= n) sc.sel = Math.max(0, n - 1);
      if (sc.sel < sc.top) sc.top = sc.sel;
      if (sc.sel >= sc.top + ROWS) sc.top = sc.sel - ROWS + 1;
      if (sc.top > Math.max(0, n - ROWS)) sc.top = Math.max(0, n - ROWS);
      let rows = '';
      let artSt = null;
      for (let i = sc.top; i < Math.min(n, sc.top + ROWS); i++) {
        const r = sc.row(i);
        const sel = i === sc.sel;
        if (sel && r.st) artSt = r.st;
        rows += `<div class="ipod-row${sel ? ' sel' : ''}${r.muted ? ' muted' : ''}${r.st && S.current?.key === r.st.key ? ' on' : ''}" data-i="${i}">
          ${r.dot ? `<i class="dot ${r.dot}"></i>` : ''}<span class="ipod-row-t">${r.h || esc(r.t)}</span><span class="ipod-row-r">${esc(r.r || '')}</span>
        </div>`;
      }
      if (!artSt) artSt = S.current;
      html = `<div class="ipod-split">
        <div class="ipod-menu" id="ipodMenu" role="listbox">${rows}</div>
        <div class="ipod-art${artSt?.logo ? '' : ' noart'}">${art(artSt)}${n > ROWS ? `<i class="ipod-scroll"><b style="top:${(sc.top / n) * 100}%;height:${Math.max(8, (ROWS / n) * 100)}%"></b></i>` : ''}</div>
      </div>`;
    }
    if (el('ipodTitle').textContent !== title) el('ipodTitle').textContent = title;
    if (force || html !== lastHtml) { lastHtml = html; el('ipodView').innerHTML = html; }
  }
  api.render = () => render(false);

  /* ---------- the click wheel ---------- */
  const STEP_DEG = 22;
  function stepWheel(dir) {
    navigator.vibrate?.(4);
    if (np) { setVolume(audio.volume + dir * 0.04); volUntil = Date.now() + 1800; render(true); setTimeout(() => render(false), 1900); return; }
    const sc = top();
    const n = sc.n();
    if (!n) return;
    sc.sel = Math.min(n - 1, Math.max(0, sc.sel + dir));
    render(true);
  }
  function select() {
    if (np) return togglePause();
    const sc = top();
    if (!sc.n()) return;
    sc.act(sc.sel);
    render(true);
  }
  const playBtn = () => { if (session || Radio.state === 'paused') togglePause(); else if (S.current) { playStation(S.current); showNp(); } else push(screens.stations()); };
  function wireWheel() {
    const w = el('ipodWheel');
    let last = null, acc = 0, moved = false, down = null, holdTimer = null, held = false;
    const angle = e => { const r = w.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    w.addEventListener('pointerdown', e => {
      if (e.target.closest('#ipodCenter')) return;
      w.setPointerCapture(e.pointerId);
      last = angle(e); acc = 0; moved = false; down = last; held = false;
      e.preventDefault();
      clearTimeout(holdTimer);
      // hold MENU: straight to the main menu
      if (down > -135 && down <= -45) holdTimer = setTimeout(() => { held = true; home(); navigator.vibrate?.(20); }, 600);
    });
    w.addEventListener('pointermove', e => {
      if (last === null) return;
      const a = angle(e);
      let d = a - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      last = a; acc += d;
      if (Math.abs(acc) > 5) { moved = true; clearTimeout(holdTimer); }
      while (Math.abs(acc) >= STEP_DEG) { const sgn = Math.sign(acc); acc -= sgn * STEP_DEG; stepWheel(sgn); }
    });
    const up = () => {
      clearTimeout(holdTimer);
      if (last !== null && !moved && !held) {
        if (down > -135 && down <= -45) pop();
        else if (down > -45 && down <= 45) step(1);
        else if (down > 45 && down <= 135) playBtn();
        else step(-1);
      }
      last = null;
    };
    w.addEventListener('pointerup', up);
    w.addEventListener('pointercancel', () => { clearTimeout(holdTimer); last = null; });
    w.addEventListener('wheel', e => { e.preventDefault(); stepWheel(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    el('ipodCenter').addEventListener('click', select);
    // the screen itself: tap a row to pick it, swipe or scroll to move
    const v = el('ipodView');
    let sy = null;
    v.addEventListener('pointerdown', e => { sy = e.clientY; });
    v.addEventListener('pointerup', e => {
      if (sy === null) return;
      const dy = e.clientY - sy; sy = null;
      if (Math.abs(dy) > 24) { for (let k = 0; k < Math.min(ROWS, Math.round(Math.abs(dy) / 24)); k++) stepWheel(dy < 0 ? 1 : -1); return; }
      const row = e.target.closest('[data-i]');
      if (row) { const sc = top(); sc.sel = +row.dataset.i; render(true); sc.act(sc.sel); render(true); }
      else if (np && e.target.closest('.np-art, .np-info')) togglePause();
    });
    v.addEventListener('wheel', e => { e.preventDefault(); stepWheel(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    // keyboard, when the guide isn't being used
    document.addEventListener('keydown', e => {
      if (!on() || e.target.closest?.('input, textarea, select, dialog, #guide') || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); stepWheel(k === 'ArrowDown' ? 1 : -1); }
      else if (k === 'Enter') { e.preventDefault(); e.stopPropagation(); select(); }
      else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); e.stopPropagation(); pop(); }
    }, true);
  }

  /* ---------- size: the iPod fills whatever space the page gives it, keeping its shape ---------- */
  const SHAPE = 0.63;   // width / height, like the real thing
  const TALLEST = 0.44; // on a tall phone the body stretches this far (the gap under the screen grows)
  function fit() {
    const wrap = el('ipodWrap'), ipod = el('ipod');
    if (!on() || !wrap) return;
    const cs = getComputedStyle(wrap);
    const w = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const h = wrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const width = Math.min(w, h * SHAPE);
    ipod.style.width = width + 'px';
    ipod.style.height = Math.max(width / SHAPE, Math.min(h, width / TALLEST)) + 'px';
  }

  /* ---------- on / off ---------- */
  api.setSkin = skin => {
    S.settings.skin = skin;
    DB.put('kv', S.settings, 'settings');
    api.apply();
    toast(skin === 'ipod' ? 'iPod look on · turn the wheel, press the centre' : 'Back to the shortwave radio');
  };
  api.apply = () => {
    const ipod = S.settings.skin === 'ipod';
    document.body.classList.toggle('look-ipod', ipod);
    document.body.classList.remove('sheet-open', 'picker-open');
    el('lookBtn').classList.toggle('on', ipod);
    el('lookBtn').setAttribute('aria-pressed', ipod);
    const sel = el('sSkin'); if (sel) sel.value = ipod ? 'ipod' : 'radio';
    Sheet.sync();
    Picker.sync();
    if (ipod) { if (!stack.length) home(); fit(); render(true); scheduleRender(); }
  };

  wireWheel();
  new ResizeObserver(fit).observe(el('ipodWrap'));
  addEventListener('resize', fit);
  navigator.getBattery?.().then(b => {
    battery = b;
    for (const ev of ['levelchange', 'chargingchange']) b.addEventListener(ev, () => render(false));
  }).catch(() => {});
  return api;
})();
