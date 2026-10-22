// Aspen partner availability API client, with a short cache.
//
// The key is limited to 10 req/min + 500/day across EVERYONE using the page,
// so identical lookups (same zip + product) share one call for CACHE_MS.

const API_URL = process.env.ASPEN_AVAILABILITY_URL || 'https://leadboard-mu.vercel.app/api/partner/availability';
const CACHE_MS = Number(process.env.CACHE_SECONDS || 60) * 1000;

export const PRODUCTS = ['Windows', 'Doors', 'Siding', 'Roofing', 'Gutters'];

export class AspenError extends Error {
  constructor(status, message, retryAfter = null) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export function cleanZip(value) {
  const v = String(value ?? '').trim();
  return /^\d{5}$/.test(v) ? v : null;
}

// "windows, doors" -> "Doors,Windows". Blank -> "" (any product).
// Returns null if anything in the list isn't one of Aspen's products.
export function cleanProduct(value) {
  const parts = String(value ?? '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const out = [];
  for (const p of parts) {
    const match = PRODUCTS.find((name) => name.toLowerCase() === p);
    if (!match) return null;
    if (!out.includes(match)) out.push(match);
  }
  return out.sort().join(',');
}

// What the page needs, nothing else (no rep or engine details).
export function shapeResponse(json) {
  return {
    zip: json.zip,
    serviced: Boolean(json.serviced),
    slots: (json.slots || []).map((s) => s.start).filter(Boolean),
    window: json.window || null,
    partial: Boolean(json.partial),
    reason: json.reason || null,
  };
}

export function createClient({ apiKey = process.env.ASPEN_API_KEY, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map(); // key -> { at, promise }

  async function call(zip, product) {
    if (!apiKey) throw new AspenError(500, 'ASPEN_API_KEY is not set');
    const url = new URL(API_URL);
    url.searchParams.set('zip', zip);
    if (product) url.searchParams.set('product', product);

    let res;
    try {
      res = await fetchImpl(url, { headers: { 'x-api-key': apiKey } });
    } catch (err) {
      throw new AspenError(503, `Aspen unreachable: ${err.message}`);
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok) return shapeResponse(json);

    if (res.status === 429) {
      throw new AspenError(429, 'Aspen rate limit hit', Number(res.headers.get('retry-after')) || 60);
    }
    // 401/403 are our key's problem, not the visitor's. Everything else is "try again".
    const status = res.status === 400 ? 400 : 503;
    throw new AspenError(status, `Aspen ${res.status}: ${json.message || json.error || 'error'}`);
  }

  return function lookup(zip, product) {
    const key = `${zip}|${product}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.promise;

    const promise = call(zip, product);
    cache.set(key, { at: now(), promise });
    // Don't cache failures, the next visitor should get a fresh try
    promise.catch(() => cache.delete(key));

    // Keep the map from growing forever
    if (cache.size > 500) {
      for (const [k, v] of cache) if (now() - v.at >= CACHE_MS) cache.delete(k);
    }
    return promise;
  };
}
