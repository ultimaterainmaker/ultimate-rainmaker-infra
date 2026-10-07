// Turns the raw GHL webhook body into what we need for Salesforce.
// Mirrors the old Zapier "Run Javascript" step, plus real boolean parsing.

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'on', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'off', 'unchecked']);

// Returns true/false, or null when the value is missing/unrecognized
// (null means "leave the Salesforce field alone").
export function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

export function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v.includes('@') ? v : null;
}

// Last 10 digits of a NANP number, or null if there aren't enough digits.
export function phoneDigits(value) {
  if (value == null) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

// Common ways the same number ends up stored in Salesforce.
export function phoneVariants(value) {
  const d = phoneDigits(value);
  if (!d) return [];
  const [a, b, c] = [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
  const variants = [
    String(value).trim(),
    d,
    `1${d}`,
    `+1${d}`,
    `(${a}) ${b}-${c}`,
    `${a}-${b}-${c}`,
    `${a}.${b}.${c}`,
    `+1 (${a}) ${b}-${c}`,
    `+1 ${a}-${b}-${c}`,
  ];
  return [...new Set(variants.filter(Boolean))];
}

export function parseGhlPayload(body) {
  const data = typeof body === 'string' ? JSON.parse(body) : body;
  if (!data || typeof data !== 'object') throw new Error('payload is not a JSON object');
  const custom = data.customData || data.custom_data || {};

  return {
    contactId: data.contact_id ?? null,
    fullName: data.full_name ?? null,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    email: cleanEmail(data.email),
    phone: data.phone ?? null,
    // Zap mapping: Email Opt Out <- customData.emails, Do Not Call <- customData.call
    emailOptOut: toBool(custom.emails),
    doNotCall: toBool(custom.call),
    // Not synced (the zap didn't either), kept for logs
    sms: toBool(custom.sms),
  };
}

// Salesforce field updates, skipping anything we couldn't parse.
export function buildContactUpdate(parsed) {
  const update = {};
  if (parsed.emailOptOut !== null) update.HasOptedOutOfEmail = parsed.emailOptOut;
  if (parsed.doNotCall !== null) update.DoNotCall = parsed.doNotCall;
  return update;
}
