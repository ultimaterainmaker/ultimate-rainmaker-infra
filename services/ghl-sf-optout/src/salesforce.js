// Tiny Salesforce REST client: OAuth auth, query, search, update.
//
// Two ways to auth, first one set wins:
//   SF_AUTH_URL  - refresh token from `sf org display --verbose` (Sfdx Auth Url).
//                  force://<clientId>:<clientSecret>:<refreshToken>@<instance>
//                  No connected app needed, it rides on the CLI's built-in one.
//   SF_LOGIN_URL + SF_CLIENT_ID + SF_CLIENT_SECRET - client credentials flow.

const API_VERSION = process.env.SF_API_VERSION || '64.0';

let cachedToken = null; // { accessToken, instanceUrl }

export function parseAuthUrl(raw) {
  const m = /^force:\/\/([^:]*):([^:]*):(.+)@([^@]+)$/.exec(String(raw).trim());
  if (!m) throw new Error('SF_AUTH_URL should look like force://<clientId>:<secret>:<refreshToken>@<instance>');
  const [, clientId, clientSecret, refreshToken, host] = m;
  const instanceUrl = (host.startsWith('http') ? host : `https://${host}`).replace(/\/+$/, '');
  return { clientId, clientSecret, refreshToken, instanceUrl };
}

function tokenRequest() {
  if (process.env.SF_AUTH_URL) {
    const { clientId, clientSecret, refreshToken, instanceUrl } = parseAuthUrl(process.env.SF_AUTH_URL);
    const params = { grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken };
    if (clientSecret) params.client_secret = clientSecret;
    return { url: `${instanceUrl}/services/oauth2/token`, params };
  }

  const loginUrl = (process.env.SF_LOGIN_URL || '').replace(/\/+$/, '');
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  if (!loginUrl || !clientId || !clientSecret) {
    throw new Error('Set SF_AUTH_URL, or SF_LOGIN_URL + SF_CLIENT_ID + SF_CLIENT_SECRET');
  }
  return {
    url: `${loginUrl}/services/oauth2/token`,
    params: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
  };
}

async function authenticate() {
  const { url, params } = tokenRequest();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Salesforce auth failed (${res.status}): ${json.error || ''} ${json.error_description || ''}`.trim());
  }
  cachedToken = { accessToken: json.access_token, instanceUrl: json.instance_url };
  return cachedToken;
}

async function sfFetch(path, init = {}, retried = false) {
  const token = cachedToken || (await authenticate());
  const res = await fetch(`${token.instanceUrl}/services/data/v${API_VERSION}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  // Token expired / revoked: grab a fresh one and retry once
  if (res.status === 401 && !retried) {
    cachedToken = null;
    return sfFetch(path, init, true);
  }
  if (res.status === 204) return null;

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(json) ? json.map((e) => `${e.errorCode}: ${e.message}`).join('; ') : text;
    throw new Error(`Salesforce ${init.method || 'GET'} ${path.split('?')[0]} failed (${res.status}): ${msg}`);
  }
  return json;
}

const soqlString = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

export async function query(soql) {
  const json = await sfFetch(`/query?q=${encodeURIComponent(soql)}`);
  return json.records || [];
}

export async function findContactIdsByEmail(email) {
  const rows = await query(`SELECT Id FROM Contact WHERE Email = ${soqlString(email)} ORDER BY LastModifiedDate DESC LIMIT 50`);
  return rows.map((r) => r.Id);
}

// Exact match on the usual formats first (no index lag), then SOSL which
// normalizes phone formats but can lag a bit behind brand new records.
export async function findContactIdsByPhone(variants, digits) {
  if (variants.length) {
    const list = variants.map(soqlString).join(', ');
    const rows = await query(
      `SELECT Id FROM Contact WHERE Phone IN (${list}) OR MobilePhone IN (${list}) ORDER BY LastModifiedDate DESC LIMIT 50`,
    );
    if (rows.length) return rows.map((r) => r.Id);
  }
  if (!digits) return [];
  const sosl = `FIND {${digits}} IN PHONE FIELDS RETURNING Contact(Id ORDER BY LastModifiedDate DESC) LIMIT 50`;
  const json = await sfFetch(`/search?q=${encodeURIComponent(sosl)}`);
  return (json.searchRecords || []).map((r) => r.Id);
}

export async function updateContact(id, fields) {
  await sfFetch(`/sobjects/Contact/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
}

export async function ping() {
  await sfFetch('/limits');
}
