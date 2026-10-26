'use strict';
/* =========================================================================
   Share links: your favorites, or a list, carried inside a link (after the #), no account needed.
   The link holds the stations themselves (compressed) or, for lists that come from a URL or
   Radio Browser, just where to get them. Opening the link offers to add them to this browser.
   ========================================================================= */
const Share = (() => {
  const MAX_CHARS = 60000; // longer links break in chats and browsers
  const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  async function pack(obj) {
    const json = JSON.stringify(obj);
    if (typeof CompressionStream === 'function') {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + b64(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'j' + b64(new TextEncoder().encode(json));
  }
  async function unpack(s) {
    const bytes = unb64(s.slice(1));
    if (s[0] === 'z') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return JSON.parse(await new Response(stream).text());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const attr = (k, v) => (v ? ` ${k}="${String(v).replace(/"/g, '')}"` : '');
  // The stations as an M3U, the format both this site and most players read.
  function toM3u(stations) {
    const lines = ['#EXTM3U'];
    for (const st of stations) for (const s of st.sources || []) {
      lines.push(`#EXTINF:-1${attr('tvg-logo', st.logo)}${attr('group-title', st.group)}${attr('tvg-country', (st.country || '').toUpperCase())}${attr('tvg-language', st.lang)},${st.name}`);
      lines.push(s.url);
    }
    return lines.join('\n');
  }
  const link = payload => `${location.origin}${location.pathname}#share=${payload}`;
  async function offer(url, what) {
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
      try { await navigator.share({ title: what, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast(`Link copied: ${what}`); }
    catch { prompt('Copy this link:', url); }
  }
  async function shareFavorites() {
    const favs = [...S.favs.values()];
    if (!favs.length) return toast('No favorites to share yet');
    const payload = await pack({ t: 'fav', m3u: toM3u(favs) });
    if (payload.length > MAX_CHARS) return toast('Too many favorites for one link. Use Export backup instead.');
    offer(link(payload), `${favs.length} favorite station${favs.length > 1 ? 's' : ''}`);
  }
  async function shareList() {
    const p = S.lists.find(x => x.id === S.ui.currentId);
    if (!p) return toast('Pick a list first');
    let obj;
    if (p.kind === 'rb') obj = { t: 'list', kind: 'rb', name: p.name, query: p.query };
    else if (p.kind === 'soma') obj = { t: 'list', kind: 'soma', name: p.name };
    else if (p.url) obj = { t: 'list', kind: 'm3u', name: p.name, url: p.url, genre: p.genre || '' };
    else obj = { t: 'list', kind: 'm3u', name: p.name, m3u: toM3u(S.stations) };
    const payload = await pack(obj);
    if (payload.length > MAX_CHARS) return toast('This list is too big for one link. Share its source URL or a backup instead.');
    offer(link(payload), p.name);
  }
  // Opening a shared link: offer to add what it carries.
  async function receive() {
    const m = location.hash.match(/^#share=([A-Za-z0-9_\-]+)/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    let obj;
    try { obj = await unpack(m[1]); } catch { return toast('This share link is damaged'); }
    if (obj.t === 'fav' && obj.m3u) {
      const sts = mergeStations(parseM3U(obj.m3u));
      if (!sts.length) return toast('The link had no stations');
      if (!confirm(`Add ${sts.length} shared favorite station${sts.length > 1 ? 's' : ''} to yours?`)) return;
      let added = 0;
      for (const st of sts) {
        if (S.favs.has(st.key)) continue;
        const f = favRecord(st); S.favs.set(st.key, f); DB.put('favs', f); added++;
      }
      indexUrls(sts, false);
      toast(added ? `Added ${added} favorite${added > 1 ? 's' : ''} (Show: ★ Favorites)` : 'You already had all of them');
      if (S.ui.status === 'fav') { rebuildGroups(); applyFilters(true); } else scheduleRender();
    } else if (obj.t === 'list') {
      if (!confirm(`Add the shared list “${obj.name || 'Shared list'}”?`)) return;
      if (obj.m3u) { try { await addList({ kind: 'm3u', name: obj.name || 'Shared list' }, parseM3U(obj.m3u)); } catch (e) { toast(e.message); } }
      else loadWithSpinner({ kind: obj.kind, name: obj.name, query: obj.query, url: obj.url, genre: obj.genre });
    }
  }
  return { shareFavorites, shareList, receive };
})();
