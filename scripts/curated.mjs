// Builds lists/curated.json: the public station collections offered under "Curated collections"
// in the Add-list dialog. Each entry is a playlist the browser can load directly (GitHub raw and
// GitHub Pages allow it). Run by the daily GitHub Action after mirror-lists.mjs.
//   node scripts/curated.mjs
import { writeFile } from 'node:fs/promises';

const UA = { 'user-agent': 'radio.sala.company curated-lists' };
const get = async (url) => { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r; };
const title = (s) => s.replace(/\.m3u$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const groups = [];

// IPRD — International Public Radio Directory (MIT): 24k stations by country, served from GitHub Pages.
try {
  const base = 'https://iprd-org.github.io/iprd/site_data/';
  const summary = await (await get(base + 'summary.json')).json();
  const items = summary.countries.filter((c) => c.count > 0).map((c) => ({
    name: c.code.toUpperCase(), country: c.code.toLowerCase(), count: c.count, url: `${base}by_country/${c.code.toLowerCase()}.m3u`,
  }));
  groups.push({ id: 'iprd', name: 'IPRD · International Public Radio Directory', home: 'https://github.com/iprd-org/iprd',
    blurb: `${summary.total_stations.toLocaleString('en')} stations in ${summary.total_countries} countries, curated by country and broadcaster, with logos and genres.`,
    byCountry: true, items });
  console.log(`ok   iprd: ${items.length} countries`);
} catch (e) { console.error('fail iprd:', e.message); }

// dderry2/radio-playlists (CC0): Radio Browser repackaged weekly into clean genre and top files.
try {
  const base = 'https://raw.githubusercontent.com/dderry2/radio-playlists/main/';
  const api = await (await get('https://api.github.com/repos/dderry2/radio-playlists/contents/genres')).json();
  const items = api.filter((f) => f.name.endsWith('.m3u')).map((f) => ({ name: title(f.name), url: base + 'genres/' + f.name, size: f.size }));
  items.unshift({ name: 'Top 500 worldwide', url: base + 'top/top-500.m3u' });
  groups.push({ id: 'rp', name: 'Radio Playlists · by genre (weekly)', home: 'https://github.com/dderry2/radio-playlists',
    blurb: 'Working stations from the Radio Browser directory, rebuilt every week into one file per genre, plus a worldwide top 500.', items });
  console.log(`ok   rp: ${items.length} files`);
} catch (e) { console.error('fail rp:', e.message); }

// deroverda/recommended-radio-streams (CC0): one listener's picks, 16 genre playlists.
try {
  const base = 'https://raw.githubusercontent.com/deroverda/recommended-radio-streams/main/playlists/';
  const api = await (await get('https://api.github.com/repos/deroverda/recommended-radio-streams/contents/playlists')).json();
  const items = api.filter((f) => f.name.endsWith('.m3u')).map((f) => ({ name: title(f.name), url: base + f.name }));
  groups.push({ id: 'rec', name: 'Recommended Radio Streams · hand-picked', home: 'https://github.com/deroverda/recommended-radio-streams',
    blurb: 'About 470 stations one listener actually listens to: underground electronic, freeform, jazz, ambient, campus radio and the odd and wonderful.', items });
  console.log(`ok   rec: ${items.length} files`);
} catch (e) { console.error('fail rec:', e.message); }

// mikepierce/internet-radio-streams (CC0): 67 small themed playlists; offered as one combined list and the themes.
try {
  const base = 'https://raw.githubusercontent.com/mikepierce/internet-radio-streams/main/';
  const api = await (await get('https://api.github.com/repos/mikepierce/internet-radio-streams/contents/')).json();
  const files = api.filter((f) => f.type === 'file' && f.name.endsWith('.m3u'));
  const items = files.map((f) => ({ name: f.name.replace(/\.m3u$/, '').replace(/-/g, ' '), url: base + encodeURIComponent(f.name) }));
  // one combined file, served from this site (lists/ is regenerated daily, never committed)
  const all = ['#EXTM3U'];
  for (const f of files) {
    const theme = f.name.replace(/\.m3u$/, '').replace(/-/g, ' ');
    const lines = (await (await get(base + encodeURIComponent(f.name))).text()).split(/\r?\n/);
    let genre = '';
    for (const l of lines) {
      if (/^#EXTGENRE:/i.test(l)) { genre = l.slice(10).trim(); continue; }
      if (/^#EXTINF/i.test(l)) { const c = l.indexOf(','); all.push(`#EXTINF:-1 group-title="${theme}"${genre ? ` tvg-genre="${genre.replace(/"/g, '')}"` : ''},${l.slice(c + 1).trim()}`); genre = ''; }
      else if (/^https?:\/\//i.test(l.trim())) all.push(l.trim());
    }
  }
  await writeFile('lists/curated-mikepierce.m3u', all.join('\n') + '\n');
  groups.push({ id: 'mp', name: 'Internet Radio Streams · curated themes', home: 'https://github.com/mikepierce/internet-radio-streams',
    blurb: 'About 250 streams in small themed playlists: BBC, SomaFM, ambient, jazz, college and community radio.', all: 'curated-mikepierce.m3u', items });
  console.log(`ok   mp: ${items.length} files`);
} catch (e) { console.error('fail mp:', e.message); }

// The committed curated.json is the fallback: only replace it when every collection answered.
if (groups.length === 4) await writeFile('lists/curated.json', JSON.stringify({ updated: new Date().toISOString(), groups }, null, 1) + '\n');
else { console.error(`only ${groups.length}/4 collections answered; keeping the committed catalogue`); process.exit(1); }
