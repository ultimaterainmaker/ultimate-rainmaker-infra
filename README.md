# ultimate-rainmaker-infra

Small services that replace Zapier zaps. Each one lives in `services/<name>` and deploys as its own Railway service (set Root Directory to `/services/<name>` and Railway Config File to `/services/<name>/railway.json`).

| Service | What it does | Replaces |
| --- | --- | --- |
| [`ghl-sf-optout`](services/ghl-sf-optout) | GHL webhook → find Salesforce Contact (email, then phone) → set Email Opt Out / Do Not Call | GHL opt-out zap (Zapier) |
| [`aspen-availability`](services/aspen-availability) | Holds the Aspen partner key, returns Aspen's open times for a ZIP/product (cached, rate capped) | nothing, new |

## GHL snippets

Code that runs inside GHL itself (workflow Custom Code actions), not on Railway.

| Snippet | What it does |
| --- | --- |
| [`ghl/zip-gate-workflow.js`](ghl/zip-gate-workflow.js) | Service-area ZIP gate for workflows. Same ZIP list as the website form gate. Pulls the ZIP off the end of `address`, outputs `inServiceArea` / `reason` / `zip` / `county` for an If/Else. Test: `node --test ghl/zip-gate-workflow.test.mjs` |
| [`ghl/aspen-slot-filter.html`](ghl/aspen-slot-filter.html) | Funnel step head code. Adds a ZIP field + product dropdown above the calendar element and filters its free slots down to times Aspen also has open (via `aspen-availability`). |
