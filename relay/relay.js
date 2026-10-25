// radio-relay — a pass-through for radio streams that browsers refuse to play directly
// (plain-http streams on an https page, and servers without CORS headers).
// Use: https://radio-relay.<account>.workers.dev/?u=http://station.example/stream
// It only passes audio (and playlist files), only from public hosts, and never caches.

const AUDIO = /^(audio\/|application\/(ogg|octet-stream|x-mpegurl|vnd\.apple\.mpegurl|pls\+xml|x-scpls)|video\/mp2t|text\/plain)/i;
const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|169\.254\.)/i;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Icy-MetaData, Range',
  'Access-Control-Expose-Headers': 'icy-name, icy-genre, icy-br, icy-metaint, icy-description, icy-url, content-type',
};

export default {
  async fetch(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply('Only GET', 405);

    const u = new URL(req.url).searchParams.get('u');
    if (!u) return reply('Give a stream address as ?u=', 400);
    let target;
    try { target = new URL(u); } catch { return reply('Bad address', 400); }
    if (!/^https?:$/.test(target.protocol)) return reply('Only http and https', 400);
    if (PRIVATE.test(target.hostname) || /workers\.dev$/i.test(target.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(target.hostname) && PRIVATE.test(target.hostname)) return reply('Not allowed', 403);

    // Ask the station the way a player would. Icy-MetaData lets song titles through.
    const headers = new Headers({ 'User-Agent': 'radio.sala.company relay', Accept: '*/*' });
    if (req.headers.get('Icy-MetaData')) headers.set('Icy-MetaData', '1');

    let res;
    try {
      res = await fetch(target.toString(), { method: req.method, headers, redirect: 'follow', signal: AbortSignal.timeout(15000), cf: { cacheTtl: 0 } });
    } catch (e) {
      return reply('Station not reachable: ' + (e.name === 'TimeoutError' ? 'timed out' : e.message), 502);
    }
    if (!res.ok) return reply('Station answered ' + res.status, 502);

    const type = res.headers.get('content-type') || 'audio/mpeg';
    if (!AUDIO.test(type)) return reply('Not an audio stream (' + type + ')', 415);

    const out = new Headers(CORS);
    out.set('Content-Type', type);
    out.set('Cache-Control', 'no-store');
    for (const [k, v] of res.headers) if (/^icy-/i.test(k)) out.set(k, v);
    return new Response(req.method === 'HEAD' ? null : res.body, { status: 200, headers: out });
  },
};

function reply(text, status) {
  return new Response(text, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}
