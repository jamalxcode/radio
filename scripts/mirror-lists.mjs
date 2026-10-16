// Copies station lists whose servers don't allow browsers to load them (no CORS)
// into lists/, so the web app can read them from this site. Run by the daily GitHub Action.
//   node scripts/mirror-lists.mjs
import { readFile, writeFile } from 'node:fs/promises';

const sources = JSON.parse(await readFile('lists/sources.json', 'utf8'));
const index = [];
let failed = 0;

for (const s of sources) {
  const file = `${s.id}.m3u`;
  try {
    const res = await fetch(s.url, { signal: AbortSignal.timeout(60_000), headers: { 'user-agent': 'm3u-radio-mirror' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const count = text.split(/\r?\n/).filter(l => /^(https?|icy):\/\//i.test(l.trim())).length;
    if (!count) throw new Error('no stream URLs in the file');
    await writeFile(`lists/${file}`, text);
    index.push({ id: s.id, name: s.name, file, count, source: s.url, home: s.home || '', updated: new Date().toISOString() });
    console.log(`ok   ${s.id}: ${count} streams`);
  } catch (e) {
    failed++;
    console.error(`fail ${s.id}: ${e.message}`);
    // Keep yesterday's copy listed if we have one.
    try {
      const old = JSON.parse(await readFile('lists/index.json', 'utf8')).find(i => i.id === s.id);
      if (old) index.push(old);
    } catch { /* first run */ }
  }
}

await writeFile('lists/index.json', JSON.stringify(index, null, 2) + '\n');
if (failed === sources.length) process.exit(1);
