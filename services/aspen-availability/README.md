# aspen-availability

Server-side proxy for Aspen's partner availability API. The booking page ([`ghl/aspen-slot-filter.html`](../../ghl/aspen-slot-filter.html)) calls this with a ZIP (+ optional product), and only shows calendar times that are open in **both** the GHL calendar and Aspen's schedule.

The Aspen key stays here. It's never in the page.

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/availability?zip=17601&product=Windows` | `product` optional (Windows, Doors, Siding, Roofing, Gutters, or a comma list). |
| `GET` | `/health` | Railway healthcheck. |

Response (just what the page needs):

```json
{ "zip": "17601", "serviced": true, "slots": ["2026-10-24T09:00:00-04:00"], "window": { "from": "2026-10-24", "through": "2026-11-01" }, "partial": false, "reason": null }
```

- Empty `slots` → `reason` is one of `out_of_area`, `product_not_offered`, `schedule_not_loaded`, `nothing_in_window` (straight from Aspen).
- `400` bad ZIP / unknown product, `429` rate limited (`retryAfter` seconds), `503` Aspen down or our key is off. The page shows no times on anything but a 200.

## Rate limits (read this)

Aspen's key is **10 req/min and 500/day for everyone combined**. So:
- Same ZIP + product lookups are cached for `CACHE_SECONDS` (60).
- Each visitor IP gets `PER_IP_PER_MIN` (6) lookups a minute.
- Matthew asked: no polling, no pre-running lead lists. If this page gets real traffic, tell him before it goes live.

Multi-product lists (e.g. `Windows,Doors`) return times where one rep can do **all** of them, so they come back with fewer slots than either product alone.

## Railway setup

Same as `ghl-sf-optout`:
1. New service from this repo. **Root Directory**: `/services/aspen-availability`, **Railway Config File**: `/services/aspen-availability/railway.json`.
2. Variables: `ASPEN_API_KEY`, `ALLOWED_ORIGINS` (the page's origin, e.g. `https://vip.aspenwindows.com`, plus the staging domain), see `.env.example`.
3. Generate Domain, then put `https://<domain>/availability` into `CONFIG.api` in the page snippet.

Test: `npm test`
