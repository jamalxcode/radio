'use strict';
/* The radio screen: now playing, presets, recently played and the station picker.
   Player, tester, lists and storage live in the other scripts (see core.js). */
const Modern = (() => {
  const root = document.getElementById('modernApp');
  if (!root) return null;
  const WIDE = '(min-width: 1050px)';
  // Short, wide screens (phones in landscape, narrow outer displays): a vertical side rail replaces the top bar.
  const RAIL = '(orientation: landscape) and (max-height: 560px) and (min-width: 560px)';
  let dual = ''; // a folding screen split by a hinge: 'h' side by side, 'v' top and bottom, '' one screen
  let browserOpen = matchMedia(WIDE).matches;
  let pickerChoice = browserOpen; // the picker as you last left it (open or closed), apart from folds
  let navOpen = false, view = 'browse', country = '', genre = '', query = '';
  let renderSignature = '', recentSignature = '', presetSignature = '';
  let chosenPreset = -1; // exact slot tapped, even if the same station is saved twice
  let holdTimer = null, held = false, downKey = -1;
  // The picker redraws only when S.rev moves (the engine counts every change in scheduleRender).
  const $m = id => document.getElementById(id);
  const ico = (path, size = 20) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const antenna = ico('<path d="M12 20v-8m-4 8h8M12 8v1m-4-5a11 11 0 0 0-2 13m14 0a11 11 0 0 0-2-13M5 7a7 7 0 0 0 0 10m14 0a7 7 0 0 0 0-10"/><circle cx="12" cy="10" r="1.6"/>');

  const safe = x => esc(String(x ?? ''));
  const image = (st, small = false) => st?.logo ? '<img loading="lazy" referrerpolicy="no-referrer" src="' + safe(st.logo) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="m-fallback">' + (small ? antenna : '♫') + '</span>';
  const stationFor = s => S.byKey.get(s.key) || s;
  const source = () => view === 'recent' ? S.recent.map(stationFor) : (S.browse?.stations || S.stations);
  const health = st => { try { return stationStatus(st); } catch (_) { return { cls: 'untested', label: 'New' }; } };
  const verified = st => st?.sources?.some(src => {
    const h=S.health.get(src.url);
    return h?.probe?.status==='ok' || h?.lastResult==='ok';
  }) && health(st).cls==='good';
  const marker = st => {
    const h = health(st), checking=testState(st);
    const good=verified(st);
    const props = { good: ['✓', good?'Verified working':'Marked working'], warn: ['!', 'Weak stream'], bad: ['×', 'Unavailable'], blocked: ['×', 'Blocked'], untested: ['?', 'Not checked'] };
    let [symbol, label] = props[h.cls] || props.untested;
    if(checking){symbol='◌';label='Checking…';}
    const cls=checking?'checking':good?'good':h.cls==='good'?'untested':h.cls;
    // Keep every status on the station-name line. Verified stations get a tiny
    // silver check badge, with the full meaning retained for AT and tooltips.
    const compact = good ? '✓' : checking ? '◌' : ({ warn:'! Weak', bad:'×', blocked:'×', untested:'?' }[cls] || symbol);
    return '<span class="m-status m-status-' + safe(cls) + '" aria-label="' + label + '" title="' + label + '">' + compact + '</span>';
  };
  const navItem = (action, icon, label) => '<button type="button" class="m-navitem" data-action="' + action + '">' + icon + '<span>' + label + '</span></button>';
  root.innerHTML = '<div class="m-shell">' +
    '<aside class="m-nav" id="mNav"><div class="m-brand"><img src="favicon.svg" alt="" width="30" height="30"><span> SALA <b>RADIO</b></span></div>' +
    navItem('home', '⌂', 'Home') + navItem('recent', '◷', 'Recently Played') +
    navItem('stations', antenna, 'Station Browser') +
    '<div class="m-navspacer"></div>' + navItem('settings', '⚙', 'Settings & backup') + '</aside>' +
    '<section class="m-central"><header class="m-header"><div><button id="mNavToggle" aria-label="Toggle navigation" title="Navigation">☰</button><span class="m-brandtext">radio.sala.company</span></div>' +
    '<div class="m-head-actions"><button id="mStationToggle" class="m-station-launch" aria-expanded="false" title="Station picker">' + antenna + ' <span>Stations</span></button><button id="mSettings" aria-label="Settings">⚙</button></div></header>' +
    '<div class="m-center-scroll"><section class="m-player"><div class="m-eyebrow">NOW PLAYING <span id="mNowBadge"></span></div>' +
    '<div class="m-now"><div class="m-now-logo" id="mNowLogo">♫</div><div class="m-now-labels"><h1 id="mNowName">Pick a station</h1><p id="mNowMeta">Use the antenna button to discover stations</p><button id="mNowSong" class="m-now-song" hidden title="Song card: links and what played before"></button></div>' +
    '<button id="mPlay" class="m-play" aria-label="Play or pause" title="Play / Pause">▶</button></div>' +
    '<div class="m-connection" id="mConnection" role="status" aria-live="polite"><span class="m-connection-dot"></span><div><strong id="mConnTitle">Ready</strong><small id="mConnSub">Choose a station to listen</small></div><button id="mRetry" hidden>Retry</button></div>' +
    '<div class="m-player-tools">' +
    '<div class="m-timer"><select id="mSleep" aria-label="Sleep timer"><option value="0">Sleep Off</option><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">2 hours</option><option value="150">2½ hours</option><option value="180">3 hours</option></select></div>' +
    '<div class="m-volume"><label for="mVolume">Volume</label><input id="mVolume" type="range" min="0" max="100" step="1" value="80" aria-label="Volume"></div></div></section>' +
    '<section class="m-section"><div class="m-section-head"><h2>Presets</h2><span>Long-press to save current station</span></div><div id="mPresets" class="m-presets"></div></section>' +
    '<section class="m-section"><div class="m-section-head"><h2>Recently played</h2><button data-action="recent">See all</button></div><div id="mRecent" class="m-recent"></div></section>' +
    '</div></section>' +
    '<aside class="m-browser" id="mBrowser"><header class="m-browser-head"><div><h2>Station picker</h2><p>Explore your entire radio collection</p></div><button id="mBrowserClose" class="m-back-radio" aria-label="Back to main radio screen" title="Back to Radio">← <span>Back to Radio</span></button></header>' +
    '<div class="m-browser-search"><input type="search" id="mSearch" placeholder="Search stations in this view…" aria-label="Search stations"><button id="mSearchWorld" title="Search Radio Browser worldwide">Worldwide</button></div>' +
    '<div class="m-columns" id="mColumns" aria-label="Finder-style station browser"></div>' +
    '<footer class="m-browser-footer"><span class="m-silver-key">✓ Verified working</span><span class="m-failed-key">× Unavailable</span><button id="mTest">Check visible</button></footer></aside>' +
    '</div><div id="mBackdrop" class="m-backdrop"></div>';
  for(const option of $m('mSleep').options) option.dataset.originalLabel=option.textContent;
  // Layouts: one screen (narrow, wide, rail) or two screens either side of a hinge.
  const railMode = () => !dual && matchMedia(RAIL).matches;
  // The picker covers the radio (narrow and rail layouts) or sits beside it (wide, and folds: its own screen).
  const overlayMode = () => !dual && (railMode() || !matchMedia(WIDE).matches);
  // The menu is a drawer, except on wide screens and in the rail, where it's always there.
  const navOverlay = () => !railMode() && (!!dual || !matchMedia(WIDE).matches);
  // Whatever an overlay covers is inert: keyboard and screen-reader focus stay inside the overlay.
  function syncInert() {
    const central = root.querySelector('.m-central'), browser = $m('mBrowser'), nav = $m('mNav');
    central.inert = (overlayMode() && browserOpen) || (navOverlay() && navOpen);
    browser.inert = (overlayMode() && !browserOpen) || (navOverlay() && navOpen);
    nav.inert = navOverlay() && !navOpen;
  }
  // auto: opened or closed by a fold, not by you; after folding back the picker returns to your choice.
  function openBrowser(open, auto = false) {
    if (dual && !open) return; // on a fold the picker has its own screen
    if (!auto) pickerChoice = open;
    browserOpen = open;
    syncInert();
    root.classList.toggle('m-browser-open', open);
    $m('mStationToggle').setAttribute('aria-expanded', String(open));
    if (open) { drawBrowser(); if (overlayMode()) $m('mBrowserClose').focus({preventScroll:true}); }
    else if (!auto && overlayMode()) $m('mStationToggle').focus({preventScroll:true});
  }
  function openNav(open) {
    navOpen = open;
    syncInert();
    root.classList.toggle('m-nav-open', open);
    if (open) root.querySelector('.m-navitem')?.focus({ preventScroll: true });
  }
  function setView(v) {
    view = v; country = ''; genre = '';
    $m('mSearch').value = ''; query = '';
    openBrowser(true); openNav(false); drawBrowser();
  }
  const countryOf = st => st.country ? countryName(st.country) : 'Other';
  function chooseList(id) {
    view = 'browse'; country = ''; genre = ''; query = ''; $m('mSearch').value = '';
    endBrowse(false);
    Promise.resolve(selectList(id)).then(() => drawBrowser()).catch(e => toast(e.message));
  }
  let shownListId;
  function drawBrowser() {
    if (!browserOpen) return;
    // Another list was opened (added, removed, imported, shared): show its stations, not the old filters or view.
    if (S.ui.currentId !== shownListId) {
      if (shownListId) { view = 'browse'; country = ''; genre = ''; query = ''; $m('mSearch').value = ''; }
      shownListId = S.ui.currentId;
    }
    const all = source();
    const countries = new Map(), genres = new Map();
    const inCountry = st => !country || country.split('|').includes(st.country || '__other__');
    const inGenre = st => !genre || genre.split('|').includes(groupsOf(st)[0] || 'Other');
    for (const st of all) {
      const cc = st.country || '__other__';
      countries.set(cc, (countries.get(cc) || 0) + 1);
      if (!inCountry(st)) continue;
      const g = groupsOf(st)[0] || 'Other';
      genres.set(g, (genres.get(g) || 0) + 1);
    }
    // Display country names, not their station counts, in A–Z order.
    const alpha = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const displayCountry = cc => cc === '__other__' ? 'Other' : countryName(cc);
    const countriesSorted = [...countries].sort((a,b) =>
      alpha.compare(displayCountry(a[0]).trim(), displayCountry(b[0]).trim()) || alpha.compare(a[0],b[0]));
    const genresSorted = [...genres].sort((a,b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
    const items = all.filter(st => inCountry(st) && inGenre(st) && (!query || [st.name, st.group, st.country ? countryName(st.country) : '', groupsOf(st).join(' ')].join(' ').toLowerCase().includes(query)))
      .sort((a,b) => alpha.compare(a.name.trim().replace(/^[^\p{L}\p{N}]+/u, ''), b.name.trim().replace(/^[^\p{L}\p{N}]+/u, '')) || alpha.compare(a.name,b.name));
    const listColumn = '<div class="m-column m-column-source"><h3>Collections</h3>' +
      (S.browse ? '<button data-list="__browse__" class="' + (view === 'browse' ? 'selected' : '') + '">' + safe('Search ' + S.browse.label) + ' <span>›</span></button>' : '') +
      S.lists.map(l => '<button data-list="' + safe(l.id) + '" class="' + (view === 'browse' && !S.browse && S.ui.currentId === l.id ? 'selected' : '') + '">' + safe(l.name) + ' <span>›</span></button>').join('') +
      '<button data-list="__recent__" class="' + (view === 'recent' ? 'selected' : '') + '">◷ Recently played <span>›</span></button>' +
      '<button data-add-list class="m-add-list">＋ Add list</button></div>';
    const mergedButton = (attr, current, e, single) => e.keys.length === 1 ? single(e.keys[0], e.n) :
      '<button data-' + attr + '="' + safe(e.keys.join('|')) + '" class="m-merged' + (current===e.keys.join('|')?' selected':'') + '" title="' + safe(e.labels.join(', ')) + '" aria-label="' + safe(e.labels.join(', ') + ', ' + e.n + ' stations') + '" data-names="' + safe(JSON.stringify(e.labels)) + '"' + (attr==='country' ? ' data-codes="' + safe(e.keys.map(k => k==='__other__' ? 'Other' : k.toUpperCase()).join('·')) + '"' : '') + '><b class="m-merge-names">' + safe(e.labels.join(' · ')) + '</b> <small>' + e.n + '</small><span>›</span></button>';
    const ccColumn = '<div class="m-column"><h3>Countries <small>' + countries.size + '</small></h3><button data-country="" class="' + (!country?'selected':'') + '">All countries <span>›</span></button>' + mergeSmall(countriesSorted.map(([cc,n]) => ({key:cc,n,label:displayCountry(cc)}))).map(e => mergedButton('country', country, e, (cc,n) => '<button data-country="' + safe(cc) + '" class="' + (country===cc?'selected':'') + '">' + (cc==='__other__'?'':countryFlag(cc)+' ') + safe(cc==='__other__'?'Other':countryName(cc)) + ' <small>' + n + '</small><span>›</span></button>')).join('') + '</div>';
    const genreColumn = '<div class="m-column"><h3>Genres <small>' + genres.size + '</small></h3><button data-genre="" class="' + (!genre?'selected':'') + '">All genres <span>›</span></button>' + mergeSmall(genresSorted.map(([g,n]) => ({key:g,n,label:g}))).map(e => mergedButton('genre', genre, e, (g,n) => '<button data-genre="' + safe(g) + '" class="' + (genre===g?'selected':'') + '">' + safe(g) + ' <small>' + n + '</small><span>›</span></button>')).join('') + '</div>';
    const stRows = items.slice(0, 350).map((st,i) => '<div class="m-st-row ' + (verified(st)?'m-verified':'') + '"><button data-st="' + i + '" class="m-st-select" title="' + safe(st.name) + '">' + image(st,true) + '<span class="m-st-text"><strong>' + safe(st.name) + '</strong>' + marker(st) + '</span></button></div>').join('');
    const stationColumn = '<div class="m-column m-column-stations"><h3>Stations <small>' + items.length + '</small></h3>' + (stRows || '<p class="m-empty">No stations match. Choose another collection or search worldwide.</p>') + (items.length>350?'<p class="m-more">Showing first 350. Narrow by country, genre or search.</p>':'') + '</div>';
    const holder=$m('mColumns');
    const horizontal=holder.scrollLeft;
    const vertical=[...holder.children].map(node=>node.scrollTop);
    holder.innerHTML = listColumn + ccColumn + genreColumn + stationColumn;
    // A redraw in the middle of the slide to the next column (stations arriving, checks finishing)
    // would otherwise stop it part way, leaving the stations off screen on phones and folds.
    const goal=holder._goal;
    holder.scrollLeft=goal&&Date.now()<goal.until?goal.left:horizontal;
    [...holder.children].forEach((node,i)=>{node.scrollTop=vertical[i]||0;});
    holder._shown = items;
    S.filtered = items; // next / previous and auto-skip follow what the picker shows
    const active = root.querySelector('.m-column-stations');
    if (active && !root.dataset.columnsInitialized) { root.dataset.columnsInitialized='yes'; }
    fitMergedNames();
    autoTestSoon();
    restoreScroll();
  }
  // Countries/genres with only 1–2 stations are merged, A–Z, with the next small ones until the group
  // holds at least 6 stations, so these columns scroll less. Bigger entries stay as they are.
  function mergeSmall(entries){
    const out=[]; let bucket=null;
    for(const e of entries){
      if(e.n>2){out.push({keys:[e.key],labels:[e.label],n:e.n});continue;}
      if(!bucket){bucket={keys:[],labels:[],n:0};out.push(bucket);}
      bucket.keys.push(e.key);bucket.labels.push(e.label);bucket.n+=e.n;
      if(bucket.n>=6)bucket=null;
    }
    // a short leftover at the end joins the previous merged group
    if(bucket&&bucket.n<6){
      const prev=out.slice(0,out.indexOf(bucket)).reverse().find(g=>g.keys.length>1);
      if(prev){prev.keys.push(...bucket.keys);prev.labels.push(...bucket.labels);prev.n+=bucket.n;out.splice(out.indexOf(bucket),1);}
    }
    return out;
  }
  // Merged names stay on one line: shorten every name a step at a time (Albania → Alban. → Alba.) until it fits;
  // countries then switch to codes (AL·AD·AO), genres end with … if still too long.
  const shorten=(name,k)=>name.length<=k+1?name:name.slice(0,k).replace(/[\s.,&-]+$/,'')+'.';
  function fitMergedNames(){
    for(const b of $m('mColumns').querySelectorAll('.m-merged')){
      const el=b.querySelector('.m-merge-names'),names=JSON.parse(b.dataset.names||'[]');
      el.textContent=names.join(' · ');
      for(let k=10;k>=3&&el.scrollWidth>el.clientWidth;k--)el.textContent=names.map(n=>shorten(n,k)).join(k<=4?'·':' · ');
      // countries: below 4 letters names get ambiguous (An., An., An.), so use their unique 2-letter codes
      if(b.dataset.codes&&el.scrollWidth>el.clientWidth&&/(^|·)\S{1,3}\.(·|$)/.test(el.textContent))el.textContent=b.dataset.codes;
    }
  }
  // Quiet checks for the station rows on screen, while you scroll
  // (Settings → auto-test). Already-checked and queued stations are skipped, so redraws don't loop.
  let autoTestTimer=0;
  function autoTestSoon(){clearTimeout(autoTestTimer);autoTestTimer=setTimeout(autoTestShown,500);}
  function autoTestShown(){
    if(!S.settings.autoTest||!browserOpen)return;
    const holder=$m('mColumns'),box=holder.getBoundingClientRect(),shown=holder._shown||[];
    const onScreen=[...holder.querySelectorAll('.m-column-stations [data-st]')].filter(b=>{
      const r=b.getBoundingClientRect();
      return r.bottom>box.top&&r.top<box.bottom&&r.right>box.left&&r.left<box.right;
    }).map(b=>shown[+b.dataset.st]).filter(Boolean);
    const urls=testUrlsFor(onScreen);
    if(urls.length)queueTests(urls);
  }
  function scrollColumns(i){
    const holder=$m('mColumns'),column=holder.children[i];
    if(!column)return;
    const offset=Math.min(column.offsetLeft-holder.children[0].offsetLeft,holder.scrollWidth-holder.clientWidth);
    holder._goal={left:offset,until:Date.now()+1500};
    holder.scrollTo({left:offset,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function paintPresets(force=false) {
    const presets = Presets.all();
    // If the same station occupies several slots, highlight only the slot
    // the listener selected; when coming from another view, use the first match.
    const matches = presets.map((p,i) => p && S.current?.key===p.key ? i : -1).filter(i=>i>=0);
    const activeIndex = matches.includes(chosenPreset) ? chosenPreset : (matches[0] ?? -1);
    const sig = presets.map(p=>p?.key||'').join('|')+'|'+(S.current?.key||'')+'|'+activeIndex;
    if (!force && sig===presetSignature) return;
    presetSignature=sig;
    $m('mPresets').innerHTML = Array.from({length:18},(_,i)=>{
      const p=presets[i], active=i===activeIndex;
      return '<button class="m-preset' +(active?' active':'')+'" data-preset="'+i+'" title="'+safe(p?p.name+' · long-press to replace':'Long-press to save current station')+'" aria-label="Preset '+(i+1)+(p?' '+safe(p.name):' empty')+'; long-press or Shift Enter to assign">' +
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
    // The song on now, when the station sends titles: "Artist — Title"; tap for the song card.
    const np=st&&['live','buffering'].includes(status)?NowPlaying.current(st):null;
    const song=np?(np.artist&&np.title?np.artist+' — '+np.title:np.text):'';
    const songEl=$m('mNowSong');
    if(songEl.textContent!==(song?'♪ '+song:'')){songEl.textContent=song?'♪ '+song:'';songEl.hidden=!song;}
    const name=st?.name||'Pick a station';
    if ($m('mNowName').textContent!==name) {
      $m('mNowName').textContent=name;
      $m('mNowLogo').innerHTML=st?image(st):'♫';
      $m('mNowMeta').textContent=st?[countryOf(st),groupsOf(st).slice(0,2).join(', ')].filter(Boolean).join(' · '):'Tap Stations to discover something new';
    }
    $m('mNowBadge').innerHTML=st?marker(st):'';
    const states={standby:['Ready','Choose a station to listen'],stopped:['Stopped','Tap Play to listen'],live:['Connected · On air','Audio playback confirmed'],buffering:['Buffering / reconnecting','Trying to restore the stream'],tuning:['Connecting…','Opening the selected stream'],paused:['Paused','Tap Play to resume'],nosignal:['Connection lost','Could not play this station']};
    const [title,generic]=states[status]||states.standby;
    // While connecting or after a failure, say what's actually happening ("Trying backup link 2 of 3…").
    const detail=['tuning','buffering','nosignal'].includes(status)&&S.note?S.note:generic;
    $m('mConnection').dataset.state=status;
    $m('mConnTitle').textContent=title;
    $m('mConnSub').textContent=detail;
    $m('mRetry').hidden=status!=='nosignal';
    // While connecting or buffering a press stops the attempt, so it shows pause too.
    const busy=['live','tuning','buffering'].includes(status);
    $m('mPlay').textContent=busy?'❚❚':'▶';
    $m('mPlay').setAttribute('aria-label', busy?'Pause':'Play');
    $m('mPlay').disabled=!st;
    $m('mVolume').value=Math.round((audio.volume||0)*100);
    // The native sleep selector is the sole visible control. Its selected
    // option becomes a live countdown, while the other durations stay intact.
    const select=$m('mSleep');
    const on=Sleep.at>0, left=Math.max(0,Sleep.at-Date.now());
    if(!on && select.value!=='0')select.value='0';
    // A timer started some other way (a restored session, a future control): select the nearest duration at or above it.
    // Only when a new timer starts (Sleep.at changes), so a chosen slot doesn't drift as it counts down.
    if(on && !Sleep.fading && document.activeElement!==select && select.dataset.at!==String(Sleep.at)){
      const mins=Math.ceil(left/60000), opts=[...select.options].map(o=>+o.value).filter(v=>v>0);
      const want=String(opts.find(v=>v>=mins)??opts[opts.length-1]);
      select.value=want;
      select.dataset.at=String(Sleep.at);
    }
    if(!on)delete select.dataset.at;
    for (const option of select.options) {
      if(option.dataset.originalLabel && option.textContent!==option.dataset.originalLabel)
        option.textContent=option.dataset.originalLabel;
    }
    if(on){
      const total=Math.ceil(left/1000), h=Math.floor(total/3600), m=Math.floor(total/60)%60, s=total%60;
      const clock=(h?h+':'+String(m).padStart(2,'0'):String(m))+':'+String(s).padStart(2,'0');
      const display=Sleep.fading?'Sleep · Fading…':'Sleep · '+clock;
      const selected=select.selectedOptions[0];
      if(selected && selected.textContent!==display)selected.textContent=display;
    }
  }
  function refresh() {
    paintLive();paintPresets();paintRecent();
    if(browserOpen){
      const sig=[view,country,genre,query,S.ui.currentId,S.browse?.label,S.browse?.stations?.length,S.stations.length,S.lists.length,S.recent.length,S.health.size,T.done,T.active,S.rev,S.current?.key].join('|');
      if(sig!==renderSignature){renderSignature=sig;drawBrowser();}
    }
  }
  function assign(i){
    if(!S.current)return toast('Play a station before assigning a preset');
    const p=Presets.all().slice();p[i]=favRecord(S.current);Presets.set(p);
    paintPresets(true);toast('Saved '+S.current.name+' to preset '+(i+1));
  }
  $m('mStationToggle').addEventListener('click',()=>openBrowser(!browserOpen));
  $m('mColumns').addEventListener('scroll',autoTestSoon,{capture:true,passive:true});
  addEventListener('resize',()=>{if(browserOpen)fitMergedNames();});
  $m('mBrowserClose').addEventListener('click',()=>openBrowser(false));
  $m('mNavToggle').addEventListener('click',()=>openNav(!navOpen));
  $m('mBackdrop').addEventListener('click',()=>{openBrowser(false);openNav(false);});
  $m('mSettings').addEventListener('click',openSettings);
  $m('mNowSong').addEventListener('click',()=>openSongCard());
  $m('mPlay').addEventListener('click',()=>togglePause());
  $m('mRetry').addEventListener('click',()=>S.current&&playStation(S.current));
  $m('mSleep').addEventListener('change',e=>Sleep.set(+e.target.value));
  $m('mVolume').addEventListener('input',e=>setVolume(+e.target.value/100));
  $m('mSearch').addEventListener('input',e=>{query=e.target.value.toLowerCase().trim();drawBrowser();});
  $m('mSearch').addEventListener('keydown',e=>{if(e.key==='Enter'&&query.length>=2)$m('mSearchWorld').click();});
  $m('mSearchWorld').addEventListener('click',()=>{const q=$m('mSearch').value.trim();if(q.length<2)return toast('Enter at least two letters to search worldwide');view='browse';query='';country='';genre='';browseRb(rbNameQuery(q)).then(()=>drawBrowser());});
  $m('mTest').addEventListener('click',()=>{const s=$m('mColumns')._shown||[];const urls=testUrlsFor(s.slice(0,25));if(urls.length)queueTests(urls);else toast('These stations are already checked');});
  root.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b)return;
    if(b.dataset.action){const a=b.dataset.action;if(a==='settings'){openNav(false);openSettings();}else if(a==='home'){openBrowser(false);openNav(false);}else if(a==='stations')setView('browse');else setView(a);return;}
    if(b.dataset.addList!==undefined)return openAddDialog();
    if(b.dataset.list!==undefined){
      if(b.dataset.list==='__recent__'){setView('recent');return scrollColumns(1);}
      if(b.dataset.list==='__browse__'){view='browse';country='';genre='';drawBrowser();return scrollColumns(1);}
      chooseList(b.dataset.list);return scrollColumns(1);
    }
    if(b.dataset.country!==undefined){country=b.dataset.country;genre='';drawBrowser();return scrollColumns(2);}
    if(b.dataset.genre!==undefined){genre=b.dataset.genre;drawBrowser();return scrollColumns(3);}
    if(b.dataset.st!==undefined){const st=$m('mColumns')._shown[+b.dataset.st];if(st){playStation(st);if(!dual)openBrowser(false);}return;}
    if(b.dataset.recent!==undefined){const r=S.recent[+b.dataset.recent];if(r)playStation(stationFor(r));return;}
    if(b.dataset.preset!==undefined){clearTimeout(holdTimer);if(held){held=false;return;}const i=+b.dataset.preset,p=Presets.all()[i];if(p){chosenPreset=i;playStation(stationFor(p));paintPresets(true);}else toast('Long-press to assign the playing station');}
  });
  const presetsEl=$m('mPresets');
  presetsEl.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-preset]');if(!b)return;downKey=+b.dataset.preset;held=false;clearTimeout(holdTimer);holdTimer=setTimeout(()=>{held=true;assign(downKey);navigator.vibrate?.(30)},650);});
  ['pointerup','pointercancel','pointerleave'].forEach(t=>presetsEl.addEventListener(t,()=>clearTimeout(holdTimer)));
  presetsEl.addEventListener('contextmenu',e=>{if(e.target.closest('[data-preset]'))e.preventDefault();});
  root.addEventListener('keydown',e=>{const b=e.target.closest('[data-preset]');if(!b)return;if(e.key==='Enter'&&e.shiftKey){e.preventDefault();assign(+b.dataset.preset);}});
  /* ---------- devices: folds, rail, keyboard; nothing here reloads or interrupts the audio ---------- */
  // Folding screens report two segments (Chrome/Edge: window.viewport.segments). Each pane gets its own
  // screen and nothing is placed under the hinge.
  function readSegments() {
    const segs = window.viewport?.segments || window.visualViewport?.segments;
    return segs && segs.length === 2 ? [...segs].sort((a, b) => a.x - b.x || a.y - b.y) : null;
  }
  function layout() {
    const segs = readSegments();
    const mode = segs ? (Math.abs(segs[0].y - segs[1].y) < 2 ? 'h' : 'v') : '';
    if (mode !== dual) {
      const was = dual;
      dual = mode;
      root.classList.toggle('m-dual-h', mode === 'h');
      root.classList.toggle('m-dual-v', mode === 'v');
      if (mode && !was) { openNav(false); openBrowser(true, true); }
      // Folded back to one screen: the picker goes back to how you last left it.
      if (!mode && was) openBrowser(pickerChoice, true);
    }
    if (segs) {
      const shell = root.querySelector('.m-shell').getBoundingClientRect(), [a, b] = segs;
      const first = mode === 'h' ? a.x + a.width - shell.left : a.y + a.height - shell.top;
      const hinge = mode === 'h' ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
      root.style.setProperty('--seg-first', Math.max(0, Math.round(first)) + 'px');
      root.style.setProperty('--seg-hinge', Math.max(0, Math.round(hinge)) + 'px');
    }
    const rail = railMode();
    if (root.classList.contains('m-rail') !== rail) root.classList.toggle('m-rail', rail);
    if (!navOverlay()) openNav(false);
    syncInert();
    if (browserOpen) fitMergedNames();
  }
  addEventListener('resize', layout);
  addEventListener('orientationchange', layout);
  window.viewport?.addEventListener?.('segmentschange', layout);
  for (const q of [WIDE, RAIL, '(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)']) matchMedia(q).addEventListener?.('change', layout);
  navigator.devicePosture?.addEventListener?.('change', layout); // folded / continuous / half-open
  // The on-screen keyboard: how much of the page it covers (iOS doesn't shrink the page for it),
  // so dialogs and the toast stay above it.
  const vv = window.visualViewport;
  function keyboardInset() {
    const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    document.documentElement.style.setProperty('--kb', kb + 'px');
  }
  vv?.addEventListener('resize', keyboardInset);
  vv?.addEventListener('scroll', keyboardInset);
  // Keep what you were doing if the page reloads (some phones reload a tab after folding or in the background):
  // the picker's collection, filters, search and scroll, and the page scroll. Worldwide searches aren't kept.
  const SAVE_KEY = 'radio-screen';
  function saveState() {
    try {
      const cols = [...$m('mColumns').children].map(c => c.scrollTop);
      sessionStorage.setItem(SAVE_KEY, JSON.stringify({ view: view === 'recent' ? 'recent' : 'browse', country, genre, query, browserOpen: pickerChoice,
        left: $m('mColumns').scrollLeft, cols, page: root.querySelector('.m-center-scroll').scrollTop }));
    } catch (_) { /* private mode or storage blocked */ }
  }
  let restore = null;
  try { restore = JSON.parse(sessionStorage.getItem(SAVE_KEY) || 'null'); } catch (_) { restore = null; }
  if (restore) {
    view = restore.view === 'recent' ? 'recent' : 'browse';
    country = restore.country || ''; genre = restore.genre || ''; query = restore.query || '';
    $m('mSearch').value = query;
    if (typeof restore.browserOpen === 'boolean') pickerChoice = browserOpen = restore.browserOpen || matchMedia(WIDE).matches;
  }
  // Scroll positions come back once the stations are there to scroll.
  function restoreScroll() {
    if (!restore || !($m('mColumns')._shown || []).length) return;
    const r = restore;
    restore = null;
    requestAnimationFrame(() => {
      const holder = $m('mColumns');
      holder.scrollLeft = r.left || 0;
      [...holder.children].forEach((c, i) => { c.scrollTop = r.cols?.[i] || 0; });
      root.querySelector('.m-center-scroll').scrollTop = r.page || 0;
    });
  }
  addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });
  setInterval(saveState, 5000);
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(navOpen){e.preventDefault();openNav(false);$m('mNavToggle').focus({preventScroll:true});}
    else if(browserOpen&&overlayMode()){e.preventDefault();openBrowser(false);}
  });
  root.classList.toggle('m-browser-open',browserOpen);
  $m('mStationToggle').setAttribute('aria-expanded',String(browserOpen));
  layout();
  keyboardInset();
  setInterval(refresh,900);
  refresh();
  return {refresh,openBrowser};
})();
