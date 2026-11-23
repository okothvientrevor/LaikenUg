# Laiken Logistics backend

The API behind `logistics.html` (public tracking, news, quote requests), `logistics-tracker.html` (staff dashboard) and `logistics-news.html`. It runs on Neon: Postgres database, Managed Auth for staff sign-in, a Function for the API, and a cron trigger that refreshes the news every 2 hours.

The website itself stays on GitHub Pages. Nothing in this folder is served by Pages.

## One-time setup

```bash
cd backend
npm install
neon init --project-name laiken-logistics --region-id aws-eu-central-1 -y   # or `neon link` to an existing project
cp .env.example .env                 # then `neon env pull` adds the Neon values
npm run db:seed                      # creates tables + 5 LKL-DEMO-* sample shipments
neon deploy --env .env               # deploys auth, the `api` function and the news cron
neon functions get api               # copy `invocation_url`
neon neon-auth status                # copy the Auth URL (NEON_AUTH_BASE_URL in .env also has it)
neon neon-auth domain add https://laikenug.com
neon neon-auth domain add https://www.laikenug.com
```

Then put both URLs into [`../js/logistics-config.js`](../js/logistics-config.js), commit and push the site.

Fill the news feed straight away, rather than waiting for the cron:

```bash
curl -X POST "$(neon functions get api -o json | jq -r .invocation_url)/staff/news/refresh" -H "authorization: Bearer <admin token>"
# or just click "Refresh news" in the dashboard as an admin
```

## Staff access

Only verified emails on the `staff` list can open the dashboard:

```bash
npm run staff:add -- ops@laikenug.com "Operations" admin
npm run staff:add -- clearing@laikenug.com "Clearing Desk" agent
```

Staff sign in with a one-time code sent to their email. In the Neon Console, open **Auth → Settings** and make sure **Email OTP** is enabled. Before going live, set up custom SMTP so codes come from your own domain (see https://neon.com/docs/auth/production-checklist.md).

## Daily commands

```bash
neon dev                                      # run the API locally (http://localhost:8787)
neon deploy --env .env                        # deploy changes
neon logs query --source function --since 1h  # check for errors
```

Remove the sample shipments once real data is in:

```sql
DELETE FROM shipments WHERE tracking_no LIKE 'LKL-DEMO-%';
```

## API

| Route | Who | What |
| --- | --- | --- |
| `GET /track/:no` | public | Status, route, ETA and public updates. Accepts a tracking, container or BL/AWB number. Never returns client details. |
| `GET /news?category=&q=&limit=` | public | Latest news (categories: `ura`, `ports`, `eac`, `transport`, `trade`) |
| `POST /quotes` | public | Quote request from the website |
| `POST /cron/refresh-news` | Neon trigger | Refreshes the news (verified with `parseTriggerDelivery`) |
| `GET /staff/me`, `/staff/stats` | staff | Profile and dashboard numbers |
| `GET/POST /staff/shipments`, `GET/PATCH /staff/shipments/:id` | staff | List, create, view, edit |
| `POST /staff/shipments/:id/events` | staff | Add a tracking update (also moves the shipment's status) |
| `GET /staff/quotes`, `PATCH /staff/quotes/:id` | staff | Quote inbox |
| `POST /staff/news/refresh` | admin | Refresh news now |

## News sources

[`src/news.ts`](src/news.ts) combines Google News searches (URA, Mombasa/Dar ports, EAC, Northern Corridor) with The Independent and Nile Post feeds, keeping only trade, tax and transport stories. Google's RSS terms describe its feeds as being for personal, non-commercial use. If that's a concern, set `USE_GOOGLE_NEWS = false` and add more publisher feeds to `PUBLISHER_FEEDS`.
