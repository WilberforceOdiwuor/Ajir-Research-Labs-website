# AskNoema signup notifications

The public form continues to call `waitlist-signup`. A database trigger adds private jobs after a signup is saved. The `waitlist-brevo` Edge Function processes them in the background, so email provider failures do not block the form.

## Daily use

In Brevo, open Contacts, then Lists, then the **Ajir Research Labs** folder:

- **AskNoema Waitlist** contains eligible access requests.
- **Ajir Newsletter** contains people who also checked the newsletter box.

Contact attributes include `AJIR_SIGNED_UP_AT`, `AJIR_SOURCE`, `AJIR_STATUS`, and `AJIR_NEWSLETTER`. Use the newsletter list for newsletter campaigns. Brevo's campaign unsubscribe controls must remain enabled. Changing access status in Supabase syncs to Brevo; editing that attribute in Brevo does not change product access.

Each new signup queues one subscriber confirmation and separate alerts for the configured staff recipients. Repeat form submissions show an already-registered screen and leave the original request, preferences, and notification jobs unchanged. Email addresses are trimmed and lowercased before the database enforces uniqueness, including concurrent requests. Existing signups are imported with sync-only jobs.

Notifications are normally processed within a minute. A daily summary is queued at **08:00 Africa/Nairobi**, covering the previous Nairobi calendar day, including zero-signup days. It reports signup totals, sources, and pending or failed integration jobs.

The sender and reply-to address are `contact@ajirresearch.com`. Subscriber confirmations explain how to request removal from either list by replying. Brevo unsubscribe, complaint, and permanent bounce webhooks update the stored preferences/status. The integration never clears Brevo blocklist flags.

## Secrets and authentication

The primary Edge Function secret is `BREVO_API_KEY`. This installation also accepts the existing spelling `BREVO_APU_KEY`; the correctly spelled name takes precedence if both exist. The API key's display name inside Brevo has no effect. Never put its value in this repository.

The worker uses `SUPABASE_SERVICE_ROLE_KEY` inside the Edge Function only. Staff recipients and Brevo list IDs are held in `waitlist_ops.config`, not in browser code or the published repository. The initial schema file intentionally has an empty recipient list; configure recipients privately before activating a fresh installation.

The worker's Supabase JWT gateway check is disabled because scheduled requests and Brevo callbacks use custom authentication:

- Scheduled/admin calls require a random `X-Worker-Token`, stored only in Supabase Vault; the database config contains its SHA-256 hash.
- Brevo events require a separate `X-Brevo-Webhook-Token`, derived with HMAC from the Brevo secret. Run setup again after rotating the Brevo key so webhook headers are updated.
- All public RPCs with the `waitlist_brevo_` prefix are restricted to `service_role`. The private schema has no anonymous/authenticated access, and both private tables have RLS enabled.

No email-open or click events are subscribed to by this integration.

## Operations

Run these with an administrative SQL connection, never from the browser:

```sql
-- Queue health (no subscriber emails in the result).
select public.waitlist_brevo_status();

-- Pause processing while retaining incoming signup jobs.
select public.waitlist_brevo_save_config('{"active":false}'::jsonb);

-- Resume.
select public.waitlist_brevo_save_config('{"active":true}'::jsonb);

-- Invoke a protected worker operation. Returns a pg_net request ID.
select waitlist_ops.invoke('status');
-- Other operations: inspect, setup, process, digest, delivery-check.

-- Read the response using the returned ID.
select status_code, content from net._http_response where id = 123;
```

Do not select or print Vault's decrypted worker token or any API key.

The worker retries temporary failures with backoff and defers sends for 24 hours if Brevo reports insufficient credits. Permanent errors appear in failed-job counts. Email jobs use a stable Brevo idempotency key. If an ambiguous send remains unresolved beyond 14 minutes, it is held for manual review rather than resent after Brevo's 15-minute deduplication window. Check Brevo email logs before retrying any such job.

Brevo Free currently allows 300 email sends per day across the account. With two staff recipients, each signup uses three sends; the daily summary uses another two. Campaigns share the available allowance. Delivered events mean the recipient's mail server accepted the email; they do not confirm inbox placement or reading.

## Files and verification

- `supabase/sql/waitlist_brevo.sql`: initial schema and restricted RPCs.
- `supabase/sql/waitlist_brevo_serial_claim.sql`: serializes processing to prevent overlapping consent updates.
- `supabase/sql/waitlist_brevo_schedule.sql`: named worker and digest cron jobs (GMT/UTC).
- `supabase/functions/waitlist-brevo/`: deployed Edge Function source.
- `tests/waitlist-brevo.test.mjs`: authorization, list preferences, suppression, retries, and email content checks.

Run `node --test tests/waitlist-brevo.test.mjs` locally. Production migrations are applied through the Supabase migration API. These SQL files record the changes; do not re-run the initial schema on an existing installation.

References: [Brevo contact API](https://developers.brevo.com/reference/create-contact), [transactional email API](https://developers.brevo.com/reference/send-transac-email), [idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails), [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Brevo pricing](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans).
