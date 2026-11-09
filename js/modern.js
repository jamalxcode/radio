'use strict';
/* Adaptive radio interface. Underlying player, tester, lists, storage and classic UI remain untouched.
   Add ?classic=1 to return to the previous interface. */
const Modern = (() => {
  const root = document.getElementById('modernApp');
  if (!root || new URLSearchParams(location.search).has('classic')) return null;
  document.body.classList.add('modern-ui');
  let browserOpen = matchMedia('(min-width: 1050px)').matches;
  let navOpen = false, view = 'browse', country = '', genre = '', query = '';
  let renderSignature = '', recentSignature = '', presetSignature = '';
  let holdTimer = null, held = false, downKey = -1;
  const $m = id => document.getElementById(id);
  const ico = (path, size = 20) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const antenna = ico('<path d="M12 20v-8m-4 8h8M12 8v1m-4-5a11 11 0 0 0-2 13m14 0a11 11 0 0 0-2-13M5 7a7 7 0 0 0 0 10m14 0a7 7 0 0 0 0-10"/><circle cx="12" cy="10" r="1.6"/>');
  const heart = ico('<path d="M20.8 4.8a5.3 5.3 0 0 0-7.5 0L12 6.2l-1.3-1.4a5.3 5.3 0 1 0-7.5 7.5L12 21l8.8-8.7a5.3 5.3 0 0 0 0-7.5Z"/>');
  const moon = ico('<path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z"/>');
  const safe = x => esc(String(x ?? ''));
  const image = (st, small = false) => st?.logo ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + safe(st.logo) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="m-fallback">' + (small ? antenna : '♫') + '</span>';
  const stationFor = s => S.byKey.get(s.key) || s;
  const source = () => view === 'favorites' ? [...S.favs.values()].map(stationFor) : view === 'recent' ? S.recent.map(stationFor) : (S.browse?.stations || S.stations);
  const health = st => { try { return stationStatus(st); } catch (_) { return { cls: 'untested', label: 'New' }; } };
  const marker = st => {
    const h = health(st);
    const props = { good: ['✓', 'Verified working'], warn: ['!', 'Weak stream'], bad: ['×', 'Unavailable'], blocked: ['×', 'Blocked'], untested: ['?', 'Not checked'] };
    const [symbol, label] = props[h.cls] || props.untested;
    return '<span class="m-status m-status-' + safe(h.cls) + '" aria-label="' + label + '" title="' + label + '"><span aria-hidden="true">' + symbol + '</span> ' + label + '</span>';
  };
  const navItem = (action, icon, label) => '<button type="button" class="m-navitem" data-action="' + action + '">' + icon + '<span>' + label + '</span></button>';
  root.innerHTML = '<div class="m-shell">' +
    '<aside class="m-nav" id="mNav"><div class="m-brand"><img src="favicon.svg" alt="" width="30" height="30"><span> SALA <b>RADIO</b></span></div>' +
    navItem('home', '⌂', 'Home') + navItem('favorites', heart, 'Favorites') + navItem('recent', '◷', 'Recently Played') +
    navItem('stations', antenna, 'Station Browser') +
    '<div class="m-navspacer"></div>' + navItem('settings', '⚙', 'Settings & backup') + navItem('classic', '◉', 'Classic radio') + '</aside>' +
    '<section class="m-central"><header class="m-header"><div><button id="mNavToggle" aria-label="Toggle navigation" title="Navigation">☰</button><span class="m-brandtext">radio.sala.company</span></div>' +
    '<div class="m-head-actions"><button id="mStationToggle" class="m-station-launch" aria-expanded="false" title="Station picker">' + antenna + ' <span>Stations</span></button><button id="mSettings" aria-label="Settings">⚙</button></div></header>' +
    '<div class="m-center-scroll"><section class="m-player"><div class="m-eyebrow">NOW PLAYING <span id="mNowBadge"></span></div>' +
    '<div class="m-now"><div class="m-now-logo" id="mNowLogo">♫</div><div class="m-now-labels"><h1 id="mNowName">Pick a station</h1><p id="mNowMeta">Use the antenna button to discover stations</p></div>' +
    '<button id="mPlay" class="m-play" aria-label="Play or pause" title="Play / Pause">▶</button></div>' +
    '<div class="m-connection" id="mConnection" role="status" aria-live="polite"><span class="m-connection-dot"></span><div><strong id="mConnTitle">Ready</strong><small id="mConnSub">Choose a station to listen</small></div><button id="mRetry" hidden>Retry</button></div>' +
    '<div class="m-player-tools"><button id="mHeart" aria-label="Add current station to favorites" aria-pressed="false">' + heart + ' <span>Favorite</span></button>' +
    '<div class="m-timer"><span class="m-ring" id="mRing"><span>' + moon + '</span></span><label for="mSleep">Sleep timer</label><select id="mSleep" aria-label="Sleep timer"><option value="0">Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">2 hours</option><option value="150">2½ hours</option><option value="180">3 hours</option></select><output id="mSleepTime">Off</output></div>' +
    '<div class="m-volume"><label for="mVolume">Volume</label><input id="mVolume" type="range" min="0" max="100" step="1" value="80" aria-label="Volume"></div></div></section>' +
    '<section class="m-section"><div class="m-section-head"><h2>Favorite presets</h2><span>Long-press to save current station</span></div><div id="mPresets" class="m-presets"></div></section>' +
    '<section class="m-section"><div class="m-section-head"><h2>Recently played</h2><button data-action="recent">See all</button></div><div id="mRecent" class="m-recent"></div></section>' +
    '</div></section>' +
    '<aside class="m-browser" id="mBrowser"><header class="m-browser-head"><div><h2>Station picker</h2><p>Explore your entire radio collection</p></div><button id="mBrowserClose" aria-label="Close station picker">✕</button></header>' +
    '<div class="m-browser-search"><input type="search" id="mSearch" placeholder="Search stations in this view…" aria-label="Search stations"><button id="mSearchWorld" title="Search Radio Browser worldwide">Worldwide</button></div>' +
    '<div class="m-browser-tabs"><button data-view="browse">Discover</button><button data-view="favorites">♥ Favorites</button><button data-view="recent">Recent</button></div>' +
    '<div class="m-quick"><button data-quick="trending">Trending</button><button data-quick="news">News</button><button data-quick="jazz">Jazz</button><button data-quick="classical">Classical</button><button data-quick="near">My country</button></div>' +
    '<div class="m-columns" id="mColumns" aria-label="Finder-style station browser"></div>' +
    '<footer class="m-browser-footer"><span class="m-silver-key">✓ Verified working</span><span class="m-failed-key">× Unavailable</span><button id="mTest">Check visible</button></footer></aside>' +
    '</div><div id="mBackdrop" class="m-backdrop"></div>';
  function openBrowser(open) {
    browserOpen = open;
    root.classList.toggle('m-browser-open', open);
    $m('mStationToggle').setAttribute('aria-expanded', String(open));
    if (open) { drawBrowser(); if (matchMedia('(max-width: 950px)').matches) $m('mBrowserClose').focus(); }
  }
  function openNav(open) { navOpen = open; root.classList.toggle('m-nav-open', open); }
  function setView(v) {
    view = v; country = ''; genre = '';
    $m('mSearch').value = ''; query = '';
    if (v !== 'browse') endBrowse();
    openBrowser(true); openNav(false); drawBrowser();
  }
  const countryOf = st => st.country ? countryName(st.country) : 'Other';
  function chooseList(id) {
    view = 'browse'; country = ''; genre = ''; query = ''; $m('mSearch').value = '';
    endBrowse(false);
    Promise.resolve(selectList(id)).then(() => drawBrowser()).catch(e => toast(e.message));
  }
  function drawBrowser() {
    if (!browserOpen) return;
    const all = source();
    const countries = new Map(), genres = new Map();
    for (const st of all) {
      const cc = st.country || '__other__';
      countries.set(cc, (countries.get(cc) || 0) + 1);
      if (country && (st.country || '__other__') !== country) continue;
      const g = groupsOf(st)[0] || 'Other';
      genres.set(g, (genres.get(g) || 0) + 1);
    }
    const countriesSorted = [...countries].sort((a,b) => b[1]-a[1]);
    const genresSorted = [...genres].sort((a,b) => b[1]-a[1]).slice(0,160);
    const items = all.filter(st => (!country || (st.country || '__other__') === country) && (!genre || (groupsOf(st)[0] || 'Other') === genre) && (!query || [st.name, st.group, st.country].join(' ').toLowerCase().includes(query)));
    const listColumn = '<div class="m-column m-column-source"><h3>Collections</h3><button data-list="__browse__" class="' + (S.browse ? 'selected' : '') + '">All in view <span>›</span></button>' +
      S.lists.map(l => '<button data-list="' + safe(l.id) + '" class="' + (!S.browse && S.ui.currentId === l.id ? 'selected' : '') + '">' + safe(l.name) + ' <span>›</span></button>').join('') + '</div>';
    const ccColumn = '<div class="m-column"><h3>Countries <small>' + countries.size + '</small></h3><button data-country="" class="' + (!country?'selected':'') + '">All countries <span>›</span></button>' + countriesSorted.map(([cc,n]) => '<button data-country="' + safe(cc) + '" class="' + (country===cc?'selected':'') + '">' + (cc==='__other__'?'':countryFlag(cc)+' ') + safe(cc==='__other__'?'Other':countryName(cc)) + ' <small>' + n + '</small><span>›</span></button>').join('') + '</div>';
    const genreColumn = '<div class="m-column"><h3>Genres <small>' + genres.size + '</small></h3><button data-genre="" class="' + (!genre?'selected':'') + '">All genres <span>›</span></button>' + genresSorted.map(([g,n]) => '<button data-genre="' + safe(g) + '" class="' + (genre===g?'selected':'') + '">' + safe(g) + ' <small>' + n + '</small><span>›</span></button>').join('') + '</div>';
    const stRows = items.slice(0, 350).map((st,i) => '<div class="m-st-row ' + (health(st).cls==='good'?'m-verified':'') + '"><button data-st="' + i + '" class="m-st-select" title="' + safe(st.name) + '">' + image(st,true) + '<span class="m-st-text"><strong>' + safe(st.name) + '</strong>' + marker(st) + '</span></button><button data-fav-st="' + i + '" class="m-st-fav" aria-label="' + (S.favs.has(st.key)?'Remove from':'Add to') + ' favorites">' + (S.favs.has(st.key)?'♥':'♡') + '</button></div>').join('');
    const stationColumn = '<div class="m-column m-column-stations"><h3>Stations <small>' + items.length + '</small></h3>' + (stRows || '<p class="m-empty">No stations match. Choose another collection or search worldwide.</p>') + (items.length>350?'<p class="m-more">Showing first 350. Narrow by country, genre or search.</p>':'') + '</div>';
    $m('mColumns').innerHTML = listColumn + ccColumn + genreColumn + stationColumn;
    $m('mColumns')._shown = items;
    for (const b of root.querySelectorAll('[data-view]')) b.classList.toggle('selected', b.dataset.view===view);
    const active = root.querySelector('.m-column-stations');
    if (active && !root.dataset.columnsInitialized) { root.dataset.columnsInitialized='yes'; }
  }
  function scrollColumns(i){
    const holder=$m('mColumns'),column=holder.children[i];
    if(!column)return;
    const offset=column.offsetLeft-holder.children[0].offsetLeft;
    holder.scrollTo({left:offset,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function paintPresets(force=false) {
    const presets = Car.presets();
    const sig = presets.map(p=>p?.key||'').join('|')+'|'+(S.current?.key||'');
    if (!force && sig===presetSignature) return;
    presetSignature=sig;
    $m('mPresets').innerHTML = Array.from({length:18},(_,i)=>{
      const p=presets[i], active=!!p && S.current?.key===p.key;
      return '<button class="m-preset' +(active?' active':'')+'" data-preset="'+i+'" title="'+safe(p?p.name+' · long-press to replace':'Long-press to save current station')+'" aria-label="Preset '+(i+1)+(p?' '+safe(p.name):' empty')+'; long-press to assign">' +
        '<span class="m-preset-number">'+(i+1)+'</span>'+(p?image(p,true):'<span class="m-preset-add">＋</span>')+'<span class="m-preset-label">'+safe(p?.name||'Save')+'</span></button>';
    }).join('');
  }
  function paintRecent(force=false) {
    const sig = S.recent.slice(0,12).map(r=>r.key).join('|');
    if(!force && sig===recentSignature)return;
    recentSignature=sig;
    $m('mRecent').innerHTML = S.recent.length ? S.recent.slice(0,12).map((r,i)=>'<button data-recent="'+i+'" title="'+safe(r.name)+'">'+image(r,true)+'<span>'+safe(r.name)+'</span></button>').join('') : '<p class="m-empty">Stations you play will appear here automatically.</p>';
  }
  function paintLive() {
    const st=S.current, status=Radio.state;
    const name=st?.name||'Pick a station';
    if ($m('mNowName').textContent!==name) {
      $m('mNowName').textContent=name;
      $m('mNowLogo').innerHTML=st?image(st):'♫';
      $m('mNowMeta').textContent=st?[countryOf(st),groupsOf(st).slice(0,2).join(', ')].filter(Boolean).join(' · '):'Tap Stations to discover something new';
    }
    $m('mNowBadge').innerHTML=st?marker(st):'';
    const states={standby:['Ready','Choose a station to listen'],stopped:['Stopped','Tap Play to listen'],live:['Connected · On air','Audio playback confirmed'],buffering:['Buffering / reconnecting','Trying to restore the stream'],tuning:['Connecting…','Opening the selected stream'],paused:['Paused','Tap Play to resume'],nosignal:['Connection lost','Could not play this station']};
    const [title,detail]=states[status]||states.standby;
    $m('mConnection').dataset.state=status;
    $m('mConnTitle').textContent=title;
    $m('mConnSub').textContent=detail;
    $m('mRetry').hidden=status!=='nosignal';
    $m('mPlay').textContent=status==='live'?'❚❚':'▶';
    $m('mPlay').setAttribute('aria-label', status==='live'?'Pause':'Play');
    $m('mPlay').disabled=!st;
    $m('mHeart').classList.toggle('active',!!st && S.favs.has(st.key));
    $m('mHeart').setAttribute('aria-pressed',String(!!st&&S.favs.has(st.key)));
    $m('mHeart').disabled=!st;
    $m('mVolume').value=Math.round((audio.volume||0)*100);
    const left=Math.max(0,Sleep.at-Date.now()), on=Sleep.at>0;
    const min=Math.floor(left/60000),sec=Math.ceil(left%60000/1000);
    $m('mSleepTime').textContent=!on?'Off':Sleep.fading?'Fading…':min+':'+String(sec%60).padStart(2,'0');
    const select=$m('mSleep');
    if (!on && select.value!=='0')select.value='0';
    const max=+(select.value)||Math.ceil(left/60000)||1;
    $m('mRing').style.setProperty('--progress',on?Math.max(0,Math.min(100,left/(max*60000)*100))+'%':'0%');
    $m('mRing').classList.toggle('active',on);
  }
  function refresh() {
    paintLive();paintPresets();paintRecent();
    if(browserOpen){
      const sig=[view,country,genre,query,S.ui.currentId,S.browse?.label,S.browse?.stations?.length,S.stations.length,S.favs.size,S.recent.length,S.health.size,T.done,T.active,Math.floor(Date.now()/5000),S.current?.key].join('|');
      if(sig!==renderSignature){renderSignature=sig;drawBrowser();}
    }
  }
  function assign(i){
    if(!S.current)return toast('Play a station before assigning a preset');
    const p=Car.presets().slice();p[i]=favRecord(S.current);Car.importPresets(p);
    paintPresets(true);toast('Saved '+S.current.name+' to preset '+(i+1));
  }
  $m('mStationToggle').addEventListener('click',()=>openBrowser(!browserOpen));
  $m('mBrowserClose').addEventListener('click',()=>openBrowser(false));
  $m('mNavToggle').addEventListener('click',()=>openNav(!navOpen));
  $m('mBackdrop').addEventListener('click',()=>{openBrowser(false);openNav(false);});
  $m('mSettings').addEventListener('click',()=>document.getElementById('settingsBtn').click());
  $m('mPlay').addEventListener('click',()=>togglePause());
  $m('mRetry').addEventListener('click',()=>S.current&&playStation(S.current));
  $m('mHeart').addEventListener('click',()=>{toggleFav(S.current);refresh();});
  $m('mSleep').addEventListener('change',e=>Sleep.set(+e.target.value));
  $m('mVolume').addEventListener('input',e=>setVolume(+e.target.value/100));
  $m('mSearch').addEventListener('input',e=>{query=e.target.value.toLowerCase().trim();drawBrowser();});
  $m('mSearch').addEventListener('keydown',e=>{if(e.key==='Enter'&&query.length>=2)$m('mSearchWorld').click();});
  $m('mSearchWorld').addEventListener('click',()=>{const q=$m('mSearch').value.trim();if(q.length<2)return toast('Enter at least two letters to search worldwide');query='';country='';genre='';browseRb(rbNameQuery(q)).then(()=>drawBrowser());});
  $m('mTest').addEventListener('click',()=>{const s=$m('mColumns')._shown||[];const urls=testUrlsFor(s.slice(0,25));if(urls.length)queueTests(urls);else toast('These stations are already checked');});
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b)return;
    if(b.dataset.action){const a=b.dataset.action;if(a==='settings')document.getElementById('settingsBtn').click();else if(a==='classic')location.href=location.pathname+'?classic=1';else if(a==='home'){openBrowser(false);openNav(false);}else if(a==='stations')setView('browse');else setView(a);return;}
    if(b.dataset.view)return setView(b.dataset.view);
    if(b.dataset.quick){view='browse';country='';genre='';query='';$m('mSearch').value='';return browseRb(chipQuery(b.dataset.quick)).then(()=>{drawBrowser();scrollColumns(3);});}
    if(b.dataset.list!==undefined){if(b.dataset.list==='__browse__')return scrollColumns(1);chooseList(b.dataset.list);return scrollColumns(1);}
    if(b.dataset.country!==undefined){country=b.dataset.country;genre='';drawBrowser();return scrollColumns(2);}
    if(b.dataset.genre!==undefined){genre=b.dataset.genre;drawBrowser();return scrollColumns(3);}
    if(b.dataset.st!==undefined){const st=$m('mColumns')._shown[+b.dataset.st];if(st){playStation(st);if(matchMedia('(max-width:950px)').matches)openBrowser(false);}return;}
    if(b.dataset.favSt!==undefined){const st=$m('mColumns')._shown[+b.dataset.favSt];if(st)toggleFav(st);drawBrowser();return;}
    if(b.dataset.recent!==undefined){const r=S.recent[+b.dataset.recent];if(r)playStation(stationFor(r));return;}
    if(b.dataset.preset!==undefined){clearTimeout(holdTimer);if(held){held=false;return;}const p=Car.presets()[+b.dataset.preset];if(p)playStation(stationFor(p));else toast('Long-press to assign the playing station');}
  });
  const presetsEl=$m('mPresets');
  presetsEl.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-preset]');if(!b)return;downKey=+b.dataset.preset;held=false;clearTimeout(holdTimer);holdTimer=setTimeout(()=>{held=true;assign(downKey);navigator.vibrate?.(30)},650);});
  ['pointerup','pointercancel','pointerleave'].forEach(t=>presetsEl.addEventListener(t,()=>clearTimeout(holdTimer)));
  presetsEl.addEventListener('contextmenu',e=>{if(e.target.closest('[data-preset]'))e.preventDefault();});
  root.addEventListener('keydown',e=>{const b=e.target.closest('[data-preset]');if(!b)return;if(e.key==='Enter'&&e.shiftKey){e.preventDefault();assign(+b.dataset.preset);}});
  window.addEventListener('resize',()=>{if(matchMedia('(min-width:1050px)').matches){openNav(false);} });
  root.classList.toggle('m-browser-open',browserOpen);
  $m('mStationToggle').setAttribute('aria-expanded',String(browserOpen));
  setInterval(refresh,900);
  refresh();
  return {refresh,openBrowser};
})();
