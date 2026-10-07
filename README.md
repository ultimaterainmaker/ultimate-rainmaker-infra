# ultimate-rainmaker-infra

Small services that replace Zapier zaps. Each one lives in `services/<name>` and deploys as its own Railway service (set Root Directory to `/services/<name>` and Railway Config File to `/services/<name>/railway.json`).

| Service | What it does | Replaces |
| --- | --- | --- |
| [`ghl-sf-optout`](services/ghl-sf-optout) | GHL webhook → find Salesforce Contact (email, then phone) → set Email Opt Out / Do Not Call | GHL opt-out zap (Zapier) |
