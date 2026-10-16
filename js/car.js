'use strict';
/* =========================================================================
   Small phones (a folded Galaxy Z Fold and the like): a 1950s push-button car radio,
   with the station guide as a separate full-screen picker.
     dial        station names on a chrome scale under a red needle; tap a name or swipe
     LCD         station, song, status, sleep countdown
     5 keys      presets: tap to play, tap an empty one to store what's on, hold to replace
     controls    previous · play/pause · next · sleep · mute · favorite
     bottom      VOL knob · STATIONS (opens the picker) · TUNE knob
   ========================================================================= */
const CAR = matchMedia('(max-width: 600px)');
const isCar = () => CAR.matches;

/* The station picker: the guide (search, chips, filters, list) as its own screen. */
const Picker = {
  open() {
    document.body.classList.add('picker-open');
    Picker.sync();
    scheduleRender();
    requestAnimationFrame(scrollToCurrent);
  },
  close() {
    document.body.classList.remove('picker-open');
    Picker.sync();
    $('#carStations').focus({ preventScroll: true });
  },
  isOpen: () => document.body.classList.contains('picker-open'),
  sync() { $('#guide').inert = isCar() && !Picker.isOpen(); },
};

const Car = (() => {
  const KEYS = 5;
  let presets = [];
  let dialSig = '', keysSig = '';
  const api = {};

  api.load = async () => {
    presets = (await DB.get('kv', 'presets')) || [];
    keysSig = '';
    api.render();
  };
  const save = () => DB.put('kv', presets, 'presets');
  api.presets = () => presets;
  api.importPresets = p => { if (Array.isArray(p)) { presets = p; save(); keysSig = ''; api.render(); } };

  function store(i) {
    if (!S.current) return toast('Tune to a station first, then press a key to store it');
    presets[i] = favRecord(S.current);
    save();
    keysSig = '';
    api.render();
    toast(`Stored on key ${i + 1}: ${S.current.name}`);
  }
  function press(i) {
    const p = presets[i];
    if (!p) return store(i);
    playStation(S.byKey.get(p.key) || p);
  }

  // Which station sits under the needle: the one being tuned to, else the one on.
  const centre = () => (S.cursor >= 0 ? S.cursor : S.current ? S.filtered.findIndex(c => c.key === S.current.key) : -1);
  const label = n => cleanName(n).replace(/^(radio|the)\s+/i, '').toUpperCase();

  function renderDial() {
    const n = S.filtered.length;
    const c = centre();
    const sig = `${n}|${c}|${S.filtered[c]?.key || ''}`;
    if (sig === dialSig) return;
    dialSig = sig;
    let html = '';
    for (let d = -2; d <= 2; d++) {
      const i = c < 0 ? d + 2 : c + d;
      const st = i >= 0 && i < n ? S.filtered[i] : null;
      html += `<button type="button" class="car-slot${d === 0 && c >= 0 ? ' on' : ''}" ${st ? `data-i="${i}"` : 'disabled'} tabindex="-1">${st ? esc(label(st.name)) : ''}</button>`;
    }
    $('#carNames').innerHTML = html;
  }
  function renderKeys() {
    const sig = presets.map(p => p?.key || '').join('|') + '#' + (S.current?.key || '');
    if (sig === keysSig) return;
    keysSig = sig;
    $('#carKeys').innerHTML = Array.from({ length: KEYS }, (_, i) => {
      const p = presets[i];
      const on = p && S.current?.key === p.key;
      return `<button type="button" class="car-key${on ? ' on' : ''}${p ? '' : ' empty'}" data-key="${i}"
        title="${p ? esc(p.name) + ' · hold to store the station that’s on instead' : 'Store the station that’s on'}"
        aria-label="${p ? `Key ${i + 1}: ${esc(p.name)}` : `Key ${i + 1}: empty, tap to store the station that’s on`}"><b>${i + 1}</b><span>${p ? esc(label(p.name)) : '+'}</span></button>`;
    }).join('');
  }
  const STATE = { standby: 'STANDBY', stopped: 'STOPPED', tuning: 'TUNING…', live: 'ON AIR', buffering: 'BUFFERING', paused: 'PAUSED', nosignal: 'NO SIGNAL' };
  function renderLcd() {
    const st = S.current;
    const np = NowPlaying.current(st);
    const set = (id, t) => { const el = $(id); if (el.textContent !== t) el.textContent = t; };
    set('#carName', st ? withFlag(st.country, st.name.toUpperCase()) : 'PICK A STATION');
    set('#carTrack', np ? '♪ ' + np.text : st ? [st.country ? countryName(st.country) : '', langsOf(st).join(', '), groupLabel(st)].filter(x => x && x.length > 1).join(' · ') : 'Tap STATIONS to choose one');
    set('#carState', STATE[Radio.state] || 'STANDBY');
    $('#carLed').className = 'led ' + ({ live: 'good', buffering: 'warn', tuning: 'warn', paused: 'warn', nosignal: 'bad' }[Radio.state] || '');
    $('#carLcd').classList.toggle('standby', !st);
  }
  api.render = () => {
    if (!isCar()) return;
    renderDial();
    renderKeys();
    renderLcd();
  };

  /* wiring */
  // Preset keys: tap = play (or store if empty), hold = store the station that's on.
  let holdTimer = null, held = false;
  $('#carKeys').addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    held = false;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => { held = true; store(+b.dataset.key); navigator.vibrate?.(30); }, 650);
  });
  const cancelHold = () => clearTimeout(holdTimer);
  $('#carKeys').addEventListener('pointerleave', cancelHold);
  $('#carKeys').addEventListener('pointercancel', cancelHold);
  $('#carKeys').addEventListener('contextmenu', e => e.preventDefault());
  $('#carKeys').addEventListener('click', e => {
    cancelHold();
    const b = e.target.closest('[data-key]');
    if (b && !held) press(+b.dataset.key);
    held = false;
  });
  // Dial: tap a name to tune there; swipe sideways to step through stations.
  let downX = null;
  $('#carDial').addEventListener('pointerdown', e => { downX = e.clientX; });
  $('#carDial').addEventListener('pointerup', e => {
    if (downX === null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 30) { turnTuning(dx < 0 ? 1 : -1); return; }
    const slot = e.target.closest('[data-i]');
    if (slot) playStation(S.filtered[+slot.dataset.i]);
  });
  $('#carDial').addEventListener('pointercancel', () => { downX = null; });
  // Controls
  $('#carPrev').addEventListener('click', () => step(-1));
  $('#carNext').addEventListener('click', () => step(1));
  $('#carPlay').addEventListener('click', togglePause);
  $('#carMute').addEventListener('click', () => setMuted(!audio.muted));
  $('#carFav').addEventListener('click', () => toggleFav(S.current));
  $('#carSleepSel').addEventListener('change', e => Sleep.set(+e.target.value));
  knob($('#carVol'), 8, s => setVolume(audio.volume + s * 0.04));
  knob($('#carTune'), 18, turnTuning);
  // Station picker
  $('#carStations').addEventListener('click', () => Picker.open());
  $('#pickerClose').addEventListener('click', () => Picker.close());
  $('#pickerAdd').addEventListener('click', openAddDialog);

  CAR.addEventListener('change', () => {
    if (!isCar()) document.body.classList.remove('picker-open');
    Picker.sync();
    Sheet.sync();
    dialSig = keysSig = '';
    api.render();
  });
  return api;
})();
