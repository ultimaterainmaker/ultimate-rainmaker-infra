import http from 'node:http';
import crypto from 'node:crypto';
import { syncOptOut } from './sync.js';
import { ping } from './salesforce.js';

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const MAX_BODY = 1024 * 1024;

const log = (level, msg, extra = {}) =>
  console[level === 'error' ? 'error' : 'log'](JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra }));

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function authorized(req, url) {
  if (!SECRET) return true;
  const given = req.headers['x-webhook-secret'] || url.searchParams.get('key') || '';
  const a = Buffer.from(String(given));
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true });

  if (req.method === 'GET' && url.pathname === '/health/salesforce') {
    if (!authorized(req, url)) return send(res, 401, { error: 'unauthorized' });
    try {
      await ping();
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 502, { ok: false, error: err.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/webhooks/ghl/opt-out') {
    if (!authorized(req, url)) return send(res, 401, { error: 'unauthorized' });

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      return send(res, err.status || 400, { error: err.status ? err.message : 'invalid JSON' });
    }

    try {
      const result = await syncOptOut(body);
      log(result.failed.length ? 'error' : 'info', 'opt-out sync', result);
      if (result.failed.length) return send(res, 502, result);
      // No match is a normal outcome (the zap would just stop), so still 200 to avoid GHL retries
      return send(res, 200, result);
    } catch (err) {
      log('error', 'opt-out sync crashed', { error: err.message, ghlContactId: body?.contact_id });
      return send(res, 500, { error: err.message });
    }
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => log('info', `listening on ${PORT}`, { auth: SECRET ? 'on' : 'OFF' }));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
