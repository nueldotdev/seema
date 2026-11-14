# Seema

A quiet, mobile-first study companion: save a thought in a few seconds, then get a researched digest by email the next morning.

## Run the PWA

1. Install Node.js 20.19+ and run `npm install`.
2. Create a Supabase project. In **Authentication → URL Configuration**, set the site URL to your deployed app origin and add your local URL (for example `http://localhost:5173`) to the redirect allow list.
3. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the Supabase project's API keys.
4. Apply `supabase/migrations/20261114000000_initial_schema.sql` to the project, then run `npm run dev`.

The client uses only the Supabase publishable key. Never put `VITE_SUPABASE_SECRET_KEY` or the service-role key in the client environment; secret keys belong only in Supabase Edge Function secrets. All application tables have RLS enabled; authenticated users can only read or modify their own rows. Email magic links require email delivery to be configured in Supabase Auth.

## Edge Function secrets and deployment

Link the Supabase CLI to the project, apply the migration, then deploy the functions:

```sh
supabase link --project-ref <project-ref>
supabase db push
supabase functions deploy run-daily
supabase functions deploy send-reminders
supabase functions deploy mark-read
supabase functions deploy research-now
```

Get the project ref from the Supabase project URL (`https://<project-ref>.supabase.co`); the ref is the subdomain, not a key. Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside Edge Functions, so do not create or upload your own copies.

Set these Edge Function secrets in **Supabase Dashboard → Edge Functions → Secrets**. For `CRON_SECRET` and `MARK_READ_SECRET`, generate separate random values locally (run the command twice in PowerShell; keep the output private):

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

| Secret | Purpose |
| --- | --- |
| `CRON_SECRET` | Bearer token used only by scheduled function calls |
| `MARK_READ_SECRET` | HMAC key for signed email mark-as-read links |
| `GEMINI_API_KEY` | Create an API key in Google AI Studio |
| `GEMINI_MODEL` | Model identifier supported by your Gemini API project, for example `gemini-2.5-flash` |
| `GOOGLE_CLIENT_ID` | OAuth client ID for the Google account that will send Seema emails |
| `GOOGLE_CLIENT_SECRET` | Secret for that OAuth client |
| `GOOGLE_REFRESH_TOKEN` | Offline OAuth refresh token authorized for the `gmail.send` scope |
| `APP_URL` | Public origin where the PWA is hosted, without a trailing slash; `mark-read` redirects here |

### Set up Google email sending (no custom domain needed)

Seema sends digest and reminder mail with the Gmail API over HTTPS, using the Google account authorized by the refresh token. It does not use SMTP or Resend. Enable the **Gmail API** in a Google Cloud project, configure the OAuth consent screen, and create a **Web application** OAuth client with `https://developers.google.com/oauthplayground` as an authorized redirect URI. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), open its settings, enable **Use your own OAuth credentials**, and enter that client ID and secret. Authorize `https://www.googleapis.com/auth/gmail.send`, exchange the authorization code, and copy the returned refresh token. Add the client ID, client secret, and refresh token as the three `GOOGLE_*` Edge Function secrets above. The sending address will be the Google account that granted consent.

Keep all Google OAuth values in Edge Function secrets, never in `.env.local` or `VITE_` variables. Google OAuth consent/testing configuration can cause a refresh token to expire (for external apps left in Testing, tokens typically expire after seven days); publish/configure the consent screen appropriately for ongoing use. Google may also impose Gmail sending quotas. The email's mark-read link calls the Supabase Edge Function URL; the function then redirects to `APP_URL`.

The migration installs `pg_cron` and `pg_net` and schedules a 15-minute dispatcher. Add two Supabase Vault secrets before relying on the schedule:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<same-value-as-CRON_SECRET>', 'cron_secret');
```

The job checks each account's IANA timezone and configured local delivery time, gathers the previous local calendar day's pending captures, researches each independently, and sends one digest. Empty days are skipped. The unique `(user_id, digest_date)` constraint prevents concurrent scheduled runs from creating multiple digests for a day.

## Product notes

- The PWA shell is cached for quick opens. Browser storage is not used to queue captures offline; a failed network save is surfaced rather than appearing successful.
- Share Target uses Android's GET text/title/url parameters to prefill the capture field.
- The capture screen offers “Research … now” when pending captures exist. It researches and opens the digest in-app without sending an immediate email; the scheduled morning run still emails that day's digest.
- `research-now` has gateway JWT verification disabled so browser CORS preflight can reach the handler; the function itself validates the Supabase access token with `auth.getUser` before accessing user data.
- Resources are retained only when Gemini Search grounding metadata supplies a real HTTP(S) URL. Research failures are recorded individually and are shown in the digest.
- Reminder emails are sent at least 24 hours after delivery for unopened digests. Reminder send claims are reset after a provider failure, so an unsuccessful attempt can be retried.
- `mark-read` validates an HMAC-signed digest ID, records `opened_at`, and redirects to the in-app reader.

## Checks

Run `npm run typecheck` and `npm run build`.
