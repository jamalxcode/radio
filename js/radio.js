'use strict';
/* =========================================================================
   The radio itself: band strip, dial display, needle, LEDs, knobs, transport
   buttons, sleep timer, and the phone mini-player. How its controls map to the app:
   BAND = your station lists (FM = first list, MW = second, SW1–SW8 = the next eight),
   TUNING = move through the stations, POWER = play/stop, SENS DX/LOCAL = all / hide off air,
   MEMORY = favorite, LIGHT = dial lamp + effects; the sleep timer sits with the play controls under the dial.
   ========================================================================= */
const BANDS = [['FM', ''], ['MW', ''], ['SW1', '49m'], ['SW2', '41m'], ['SW3', '31m'], ['SW4', '25m'], ['SW5', '22m'], ['SW6', '19m'], ['SW7', '16m'], ['SW8', '13m']];
const bandLabel = i => (i < BANDS.length ? BANDS[i][0] : 'EXT' + (i - BANDS.length + 1));
const ON_STATES = ['live', 'buffering', 'tuning', 'nosignal', 'paused'];
const PLAYING_STATES = ['live', 'buffering', 'tuning'];
let tuneTimer, bandTimer, tuneRot = 0, bandPending = -1, scaleN = -1;

const Radio = (() => {
  const needleEl = $('#needle');
  const api = {
    state: 'standby', // standby | stopped | tuning | live | buffering | paused | nosignal
    setState(s) {
      api.state = s;
      const on = ON_STATES.includes(s) && !!session;
      const playing = PLAYING_STATES.includes(s);
      document.body.classList.toggle('onair', s === 'live' || s === 'buffering');
      document.body.classList.toggle('playing', s === 'live');
      $('#playBtn').classList.toggle('on', on);
      $('#playBtn').setAttribute('aria-pressed', on);
      $('#powerLed').classList.toggle('on', on);
      $('#tuneLed').className = 'led ' + ({ live: 'good', buffering: 'warn', tuning: 'warn', paused: 'warn', nosignal: 'bad' }[s] || '');
      for (const b of [$('#tPause'), $('#miniPlay')]) {
        b.textContent = playing ? '⏸' : '▶';
        b.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        b.title = playing ? 'Pause (Space)' : 'Play (Space)';
      }
      $('#tStop').disabled = !session;
      $('#tLive').disabled = !session;
      $('#tLive').classList.toggle('behind', s === 'paused');
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
      $('#volVal').textContent = audio.muted ? 'MUTE' : Math.round(v * 100);
    },
    muted(m) {
      for (const b of [$('#tMute'), $('#miniMute')]) {
        b.textContent = m ? '🔇' : '🔊';
        b.classList.toggle('on', m);
        b.setAttribute('aria-pressed', m);
        b.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
      }
      api.volume(audio.volume);
    },
    fav(on) {
      $('#favBtn b').textContent = on ? '★' : '☆';
      $('#favBtn').classList.toggle('on', on);
      $('#favBtn').setAttribute('aria-pressed', on);
      $('#tFav').textContent = on ? '★' : '☆';
      $('#tFav').classList.toggle('on', on);
      $('#tFav').setAttribute('aria-pressed', on);
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

/* A rotary knob: tap its left or right half to step, drag it round, scroll on it,
   or use the arrow keys when it has focus. */
function knob(el, degPerStep, onSteps) {
  let last = null, acc = 0, moved = false, downX = 0;
  const angle = e => {
    const r = el.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
  };
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId);
    last = angle(e); acc = 0; moved = false; downX = e.clientX;
    e.preventDefault();
    el.focus({ preventScroll: true });
  });
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
  el.addEventListener('pointerup', () => {
    if (last !== null && !moved) {
      const r = el.getBoundingClientRect(); // knobs rotate, so judge by where the finger went down, not the rotated box
      onSteps(downX < r.left + r.width / 2 ? -1 : 1);
    }
    last = null;
  });
  el.addEventListener('pointercancel', () => { last = null; });
  el.addEventListener('wheel', e => { e.preventDefault(); onSteps(e.deltaY < 0 ? 1 : -1); }, { passive: false });
  el.addEventListener('keydown', e => {
    const s = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, Enter: 1, ' ': 1 }[e.key];
    if (s) { e.preventDefault(); e.stopPropagation(); onSteps(s); }
  });
}
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
  bandTimer = setTimeout(() => { const id = S.lists[bandPending]?.id; bandPending = -1; if (id && (id !== S.ui.currentId || S.browse)) selectList(id); }, 350);
}
function setVolume(v) {
  audio.volume = Math.min(1, Math.max(0, Math.round(v * 50) / 50));
  if (audio.volume > 0 && audio.muted) setMuted(false);
  Radio.volume(audio.volume);
}
function setMuted(m) {
  audio.muted = m;
  S.ui.muted = m;
  saveUi();
  Radio.muted(m);
}

/* The dial display and the phone mini-player: what's on, how well it's playing. */
const VFD = (() => {
  const el = id => document.getElementById(id);
  const box = $('#vfd');
  const STATE = {
    standby: ['STANDBY', ''], stopped: ['STOPPED', ''], tuning: ['TUNING…', 'lvl-warn'], live: ['● ON AIR', 'lvl-good'],
    buffering: ['BUFFERING', 'lvl-warn'], paused: ['❚❚ PAUSED', 'lvl-warn'], nosignal: ['NO SIGNAL', 'lvl-bad'],
  };
  const MINI = { standby: 'Tap play to listen', stopped: 'Stopped', tuning: 'Tuning…', live: 'On air', buffering: 'Buffering…', paused: 'Paused', nosignal: 'No signal' };
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
  function set(id, text, cls) {
    const n = el(id);
    if (n.textContent !== text) n.textContent = text;
    if (cls !== undefined) n.className = cls;
  }
  function setImg(img, src) {
    if ((src || '') === img.dataset.src) return;
    img.dataset.src = src || '';
    img.classList.toggle('hidden', !src);
    if (src) { img.onerror = () => img.classList.add('hidden'); img.src = src; }
  }
  function update() {
    const st = S.current;
    const s = session && st && session.st.key === st.key ? session : null;
    const [stateText, stateCls] = STATE[Radio.state] || STATE.standby;
    box.classList.toggle('standby', !st);
    const num = st ? stNum(st) : '---';
    set('vfdNum', typeof num === 'number' ? String(num).padStart(3, '0') : num);
    set('vfdName', st ? st.name.toUpperCase() : 'PICK A STATION');
    set('vfdMeta', st ? [countryFlag(st.country) + ' ' + (st.country ? countryName(st.country) : ''), groupLabel(st)].map(x => x.trim()).filter(Boolean).join(' · ')
                      : 'Turn TUNING or pick a station from the guide', 'dial-meta');
    const np = NowPlaying.current(st);
    set('vfdTrack', np ? '♪ ' + np.text : '', 'dial-np' + (np ? '' : ' hidden'));
    el('vfdTrack').title = np ? `${np.text}${np.album ? ' · ' + np.album : ''} (from ${np.source})` : '';
    setImg(el('vfdLogo'), st?.logo);
    set('vfdState', stateText, stateCls);
    if (st) {
      const ss = stationStatus(st);
      set('vfdSig', `${BARS[ss.cls]} ${ss.label.toUpperCase()}`, 'lvl-' + ss.cls);
    } else set('vfdSig', '····', '');
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
    } else set('vfdBuf', '▯'.repeat(6), '');
    set('vfdTime', s?.liveAt && Radio.state !== 'stopped' ? since(Date.now() - s.liveAt) + (s.behindMs > 1500 ? ` −${Math.round(s.behindMs / 1000)}s` : '') : '--:--');
    const kind = { hls: 'HLS', native: 'DIRECT' }[engine] || '';
    set('vfdSrc', s ? `${s.idx + 1}/${s.order.length}${kind ? ' · ' + kind : ''}` : st ? `${st.sources.length} LINK${st.sources.length > 1 ? 'S' : ''}` : '—');
    set('vfdClock', new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toUpperCase() + (Sleep.at ? ` · ⏾${Sleep.left()}m` : ''));
    // Phone mini-player
    set('miniName', st ? st.name : 'Pick a station');
    set('miniSub', np ? '♪ ' + np.text : st ? (s ? MINI[Radio.state] || '' : 'Tap play to listen') : 'Tap a station below to play it');
    setImg(el('miniLogo'), st?.logo);
    $('#mini').classList.toggle('live', Radio.state === 'live');
  }
  setInterval(() => { if (!document.hidden) update(); }, 1000);
  return { update };
})();

/* Sleep timer, next to the play controls: pick 30 minutes to 3 hours, it counts down beside the menu,
   and at zero the sound fades out over 8 seconds and the radio turns off. */
const Sleep = (() => {
  const api = { at: 0, fading: false };
  const msLeft = () => Math.max(0, api.at - Date.now());
  api.left = () => Math.ceil(msLeft() / 60000);
  const two = n => String(n).padStart(2, '0');
  function clock(ms) {
    const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
  }
  function render() {
    const left = $('#sleepLeft');
    const on = !!api.at;
    left.classList.toggle('hidden', !on);
    $('#sleepBox').classList.toggle('on', on);
    if (on) left.textContent = api.fading ? 'fading…' : clock(msLeft());
    if (!on && $('#sleepSel').value !== '0') $('#sleepSel').value = '0';
  }
  api.set = minutes => {
    api.at = minutes > 0 ? Date.now() + minutes * 60000 : 0;
    render();
    toast(minutes > 0 ? `Sleep timer: the radio turns off in ${clock(minutes * 60000)}` : 'Sleep timer off');
  };
  async function fadeOut() {
    api.fading = true;
    render();
    const v0 = audio.volume;
    for (let i = 1; i <= 20 && session; i++) {
      audio.volume = v0 * (1 - i / 20);
      await new Promise(r => setTimeout(r, 400));
    }
    stopPlayback();
    audio.volume = v0; // ready at the usual volume next time
    Radio.volume(v0);
    api.fading = false;
    api.at = 0;
    render();
    toast('Sleep timer: radio off. Good night.');
  }
  // Its own clock (not the display's), so it keeps counting while the screen is off.
  setInterval(() => {
    if (!api.at || api.fading) return;
    if (Date.now() >= api.at) {
      if (session) fadeOut();
      else { api.at = 0; render(); }
      return;
    }
    render();
  }, 1000);
  return api;
})();

/* Phone: the radio is a sheet that slides up over the station guide. */
const Sheet = (() => {
  const phone = matchMedia('(max-width: 820px)');
  const sync = () => { $('#stage').inert = phone.matches && !document.body.classList.contains('sheet-open'); };
  phone.addEventListener('change', sync);
  return {
    open() { document.body.classList.add('sheet-open'); sync(); $('#sheetClose').focus({ preventScroll: true }); },
    close() { document.body.classList.remove('sheet-open'); sync(); },
    sync,
    phone,
  };
})();
