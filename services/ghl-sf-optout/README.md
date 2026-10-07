# ghl-sf-optout

Replaces the old GHL opt-out zap (Webhooks by Zapier → Run Javascript → Salesforce Find Record → Update Record):

| Zap step | Here |
| --- | --- |
| 1. Catch Hook | `POST /webhooks/ghl/opt-out` |
| 2. Run Javascript (parse `rawData`) | `src/payload.js` |
| 3. Salesforce Find Record (email, then phone) | `src/salesforce.js` → `findContactIdsByEmail` / `findContactIdsByPhone` |
| 4. Salesforce Update Record (Contact) | `updateContact` |

Field mapping (same as the zap):

| GHL `customData` | Salesforce Contact field |
| --- | --- |
| `emails` | `HasOptedOutOfEmail` (Email Opt Out) |
| `call` | `DoNotCall` (Do Not Call) |
| `sms` | not synced, logged only |

## What's different from the zap

- **Updates every matching Contact**, not just the first one Zapier happened to find. Opt-outs are a compliance thing, so dupes get updated too.
- **Phone matching actually works across formats.** GHL sends `+16085551234` while Salesforce usually stores `(608) 555-1234`. We try the common formats with SOQL, then fall back to SOSL phone search, which normalizes formatting.
- **Blank/garbage flags are left alone.** If GHL doesn't send `call`, we don't write `DoNotCall`.
- No email in the payload just skips straight to phone (no more `no-match@placeholder.invalid` trick).

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/webhooks/ghl/opt-out` | GHL webhook target. Needs the secret. |
| `GET` | `/health` | Railway healthcheck, no auth. |
| `GET` | `/health/salesforce` | Checks SF auth works. Needs the secret. |

Auth: send `x-webhook-secret: <WEBHOOK_SECRET>` as a header (preferred), or `?key=<WEBHOOK_SECRET>` in the URL.

Responses:
- `200` → processed. Check `matchedBy` / `updated` in the body (`matchedBy: null` means no Contact found, same as the zap stopping at step 3).
- `401` bad secret, `400` bad JSON, `502` a Salesforce update failed, `500` anything else (e.g. SF auth).

## Salesforce setup (one time)

### Option A: log in with the Salesforce CLI (no connected app needed)

Same idea as Zapier's "Connect Salesforce" button. You log in once in the browser and we keep the refresh token. It rides on the CLI's built-in `PlatformCLI` app, so there's no client id/secret to dig up.

```bash
npm install -g @salesforce/cli
sf org login web --instance-url https://improveit360-4020.my.salesforce.com --alias rainmaker
sf org auth show-sfdx-auth-url --target-org rainmaker   # older CLIs: sf org display --verbose
```

Copy that value (`force://PlatformCLI::...@...`) into Railway as `SF_AUTH_URL`. Treat it like a password.

Notes:
- Log in as the user you want the updates to run as (ideally the one the Zapier connection used). Every update shows up as that user.
- The token keeps working until it's revoked: someone clicks Revoke under that user's OAuth Connected Apps, the user is deactivated, or `sf org logout` runs. Changing the password doesn't break it.
- If login says the app is blocked or not approved, the org restricts uninstalled connected apps. An admin has to either install "Salesforce CLI" under Connected Apps OAuth Usage, or give the user the "Approve Uninstalled Connected Apps" permission.

### Option B: your own External Client App (client credentials)

1. Setup → **External Client App Manager** → New External Client App (or a Connected App, same idea).
2. Enable OAuth, callback URL can be anything (e.g. `https://login.salesforce.com/services/oauth2/callback`), scopes: `api`.
3. Enable **Client Credentials Flow**.
4. In the app's policies, set **Run As** to an integration user that can read/edit Contacts (ideally the same user the Zapier connection used, so field-level security matches).
5. Copy the consumer key + secret into Railway as `SF_CLIENT_ID` / `SF_CLIENT_SECRET`.

`SF_LOGIN_URL` must be the org's My Domain (`https://improveit360-4020.my.salesforce.com`), not `login.salesforce.com`. Client credentials won't work against the generic login host.

## Railway setup

1. New service → deploy from this GitHub repo.
2. Settings → Source → **Root Directory**: `/services/ghl-sf-optout`. Then Settings → Config-as-code → **Railway Config File**: `/services/ghl-sf-optout/railway.json` (the config path ignores Root Directory, so it has to be the full path).
3. Variables: `SF_AUTH_URL` (or the Option B trio) + `WEBHOOK_SECRET`, see `.env.example`. Generate the secret with `openssl rand -hex 24`.
4. Settings → Networking → Generate Domain.
5. Hit `https://<domain>/health/salesforce?key=<secret>` and make sure it says `{"ok":true}`.

## Cutover

1. In the GHL workflow, find the Webhook action pointing at the Zapier URL.
2. Change the URL to `https://<domain>/webhooks/ghl/opt-out` and add header `x-webhook-secret: <secret>`. Leave the custom data keys (`call`, `sms`, `emails`) exactly as they are.
3. Trigger it on a test contact and check Railway logs for `"msg":"opt-out sync"` with `updated` filled in.
4. Turn the zap off once a day or two of real traffic looks clean. Delete it after that.

## Local dev

```bash
cp .env.example .env   # fill it in
node --env-file=.env src/server.js
npm test
```

Sample request:

```bash
curl -X POST localhost:3000/webhooks/ghl/opt-out \
  -H "x-webhook-secret: $WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"contact_id":"abc","email":"jane@example.com","phone":"+16085551234","customData":{"call":"true","sms":"false","emails":"false"}}'
```
