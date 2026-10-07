import { parseGhlPayload, buildContactUpdate, phoneVariants, phoneDigits } from './payload.js';
import * as sf from './salesforce.js';

// Same flow as the zap: find Contact by email, fall back to phone, update opt-out flags.
// Differences from the zap: updates every matching Contact (not just the first),
// and never writes a flag that GHL didn't actually send.
export async function syncOptOut(body, client = sf) {
  const parsed = parseGhlPayload(body);
  const fields = buildContactUpdate(parsed);

  const result = {
    ghlContactId: parsed.contactId,
    matchedBy: null,
    salesforceIds: [],
    fields,
    updated: [],
    failed: [],
  };

  if (!Object.keys(fields).length) {
    result.skipped = 'no usable customData.emails / customData.call values';
    return result;
  }

  let ids = [];
  if (parsed.email) {
    ids = await client.findContactIdsByEmail(parsed.email);
    if (ids.length) result.matchedBy = 'email';
  }
  if (!ids.length && parsed.phone) {
    ids = await client.findContactIdsByPhone(phoneVariants(parsed.phone), phoneDigits(parsed.phone));
    if (ids.length) result.matchedBy = 'phone';
  }
  result.salesforceIds = ids;

  for (const id of ids) {
    try {
      await client.updateContact(id, fields);
      result.updated.push(id);
    } catch (err) {
      result.failed.push({ id, error: err.message });
    }
  }
  return result;
}
