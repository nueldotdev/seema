# Seema

A quiet place for curious minds: save a thought in a few seconds, then get a researched digest by email the next morning.

## Architecture

- **Vercel** hosts the Vite PWA and Node.js API functions in `api/`.
- **Supabase** provides Postgres, Auth, and row-level security. No Supabase Edge Functions are required by the current app.
- **Tavily Search** supplies research sources, **Gemini** writes explanations, and the **Gmail API** sends digests/reminders.
- Signed-out visitors see a public landing page; sign-in and account creation use the same passwordless email link flow.

## Local development

1. Install Node.js 20.19+ and run `npm install`.
2. Copy `.env.example` to `.env.local`; fill in the client variables and server-only variables described below.
3. Run `npx vercel login` and `npx vercel link` once, then use `npm run dev:vercel` to run the PWA and Vercel API functions together locally. `npm run dev` starts only Vite, so `/api/*` backend routes will not be available in that mode.
4. In Supabase **Authentication → URL Configuration**, allow your local Vercel dev URL (usually `http://localhost:3000`) and the deployed app URL.

The browser only receives `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use a `VITE_` prefix for the Supabase secret key or any provider credentials.

### Local demo without sign-in

For a UI demo without Supabase credentials, set `VITE_LOCAL_DEMO=true` in `.env.local` and run `npm run dev` (Vite). Open `/` for the public landing page and choose **Explore local demo** to enter the capture flow. This works only on `localhost`/`127.0.0.1` in development mode; it is disabled in production builds and on deployed hosts. Demo captures, settings, and sample digests are stored only in that browser's local storage. Research previews are illustrative and do not call AI providers or send emails. Remove the setting or set it to `false` to return to normal sign-in.

## Supabase setup

Apply the migrations in order. If the initial schema was already run in the Dashboard, make sure the CLI migration history is repaired before pushing new migrations:

```sh
npx supabase link --project-ref <project-ref>
npx supabase migration list --remote
# Only if the initial schema was already run in SQL Editor but is missing from remote history:
npx supabase migration repair --status applied 20261114000000 --remote
npx supabase db push
```

`20261115090000_disable_supabase_cron.sql` disables the old Supabase `pg_cron` dispatcher, so it does not continue calling the retired Edge Functions. Apply this migration **before enabling the replacement external schedule** to avoid duplicate digest emails. The existing schema migration creates the tables and owner-scoped RLS policies.

Create a Supabase **secret API key** in Project Settings → API Keys. It is a backend credential, not a browser key.

## Vercel environment variables

Add these in **Vercel → Project → Settings → Environment Variables**. For local `vercel dev`, put them in the ignored `.env.local` file.

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL used by the PWA |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the PWA |
| `SUPABASE_URL` | Same project URL, for server API functions |
| `SUPABASE_SECRET_KEY` | Supabase secret API key; server-only. `SUPABASE_SERVICE_ROLE_KEY` is accepted as a legacy alternative |
| `TAVILY_API_KEY` | Tavily web search |
| `GEMINI_API_KEY` | Gemini text generation |
| `GEMINI_MODEL` | Model identifier, e.g. `gemini-2.5-flash` |
| `GOOGLE_CLIENT_ID` | OAuth client for the Gmail account that sends Seema mail |
| `GOOGLE_CLIENT_SECRET` | Secret for that OAuth client |
| `GOOGLE_REFRESH_TOKEN` | Offline OAuth token with `gmail.send` scope |
| `CRON_SECRET` | Random bearer secret protecting the scheduled endpoint |
| `MARK_READ_SECRET` | Separate random HMAC key for signed read links |
| `APP_URL` | Public app origin, e.g. `https://your-project.vercel.app`, without a trailing slash |

Generate separate values for `CRON_SECRET` and `MARK_READ_SECRET`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set `APP_URL` to the Vercel deployment origin and add that origin to Supabase Auth's allowed redirect URLs. Gmail API sends as the Google account that authorized the `gmail.send` scope. OAuth apps left in Testing can have refresh tokens expire after seven days.

## Deploy and schedule

Connect the repository to Vercel and deploy. Vercel builds the Vite app and automatically deploys the Node API functions from `api/`. Deploy again after changing environment variables.

Vercel's Hobby plan only allows a cron to run once per day, but Seema checks individual time zones and delivery times every 15 minutes. Configure an external scheduler (for example cron-job.org) to call:

```text
GET https://YOUR_APP_URL/api/cron/run-daily
```

Set its `Authorization` header to `Bearer <the same CRON_SECRET from Vercel>` and run every 15 minutes. The endpoint processes due digests and reminders; requests without the matching secret are rejected. An eligible digest sends an actual email.

## Product notes

- The PWA shell is cached for quick opens; capture submission requires a network connection.
- Android Share Target prefills the capture field.
- The Topics page lists topics from ready digests and supports searching topic text and explanations.
- A light/dark appearance preference is available in Settings and saved in the current browser.
- The Queue page keeps pending thoughts available across visits and lets each thought be researched independently through the authenticated `/api/research-capture` endpoint. Standalone results appear in Topics.
- The scheduled digest is dated for the current local day and researches pending captures saved before that day's configured delivery time. Captures saved after the digest has been sent remain pending and are included in the next digest. The external scheduler must call `/api/cron/run-daily` every 15 minutes.
- “Research … now” researches today's pending captures and opens the digest in-app without sending an email.
- Research is limited to three captures at a time to avoid exhausting provider quotas and function resources.
- Tavily supplies search results; Gemini uses their snippets to write explanations. Resource links are always mapped to Tavily-returned URLs.
- The scheduled function researches the current local day's eligible captures, sends one email digest, and reminds unopened digests after 24 hours.
- The `/api/research-now` route validates the signed-in Supabase user before accessing their data. `/api/mark-read` validates its HMAC link before marking the digest opened.

## Checks

Run `npm run typecheck` and `npm run build`.
