import http from 'node:http';
import { createClient, cleanZip, cleanProduct, AspenError } from './aspen.js';

const PORT = Number(process.env.PORT) || 3000;
// Pages allowed to call us from the browser, e.g. "https://vip.aspenwindows.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
// Per-visitor cap so one person mashing the ZIP box can't burn the shared Aspen key
const PER_IP_PER_MIN = Number(process.env.PER_IP_PER_MIN || 6);

const lookup = createClient();
const hitsByIp = new Map(); // ip -> [timestamps]

const log = (level, msg, extra = {}) =>
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

function send(req, res, status, body, extra = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req), ...extra });
  res.end(JSON.stringify(body));
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

// Returns seconds to wait, or 0 if the visitor is under the cap
function overLimit(ip) {
  const now = Date.now();
  const recent = (hitsByIp.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= PER_IP_PER_MIN) {
    hitsByIp.set(ip, recent);
    return Math.ceil((60_000 - (now - recent[0])) / 1000);
  }
  recent.push(now);
  hitsByIp.set(ip, recent);
  return 0;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hitsByIp) if (!list.some((t) => now - t < 60_000)) hitsByIp.delete(ip);
}, 60_000).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' });
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/health') return send(req, res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/availability') {
    const zip = cleanZip(url.searchParams.get('zip'));
    const product = cleanProduct(url.searchParams.get('product'));
    if (!zip) return send(req, res, 400, { error: 'bad_zip', message: 'Enter a 5-digit ZIP code.' });
    if (product === null) return send(req, res, 400, { error: 'bad_product', message: 'Unknown product.' });

    const wait = overLimit(clientIp(req));
    if (wait) return send(req, res, 429, { error: 'rate_limited', retryAfter: wait }, { 'Retry-After': String(wait) });

    try {
      const result = await lookup(zip, product);
      return send(req, res, 200, result);
    } catch (err) {
      const status = err instanceof AspenError ? err.status : 500;
      log('error', 'lookup failed', { zip, product, status, err: err.message });
      if (status === 429) {
        return send(req, res, 429, { error: 'rate_limited', retryAfter: err.retryAfter }, { 'Retry-After': String(err.retryAfter) });
      }
      if (status === 400) return send(req, res, 400, { error: 'bad_zip', message: 'Enter a 5-digit ZIP code.' });
      return send(req, res, 503, { error: 'unavailable', message: "Couldn't check availability, try again in a minute." });
    }
  }

  send(req, res, 404, { error: 'not_found' });
});

server.listen(PORT, () => log('info', 'listening', { port: PORT, allowedOrigins: ALLOWED_ORIGINS }));
