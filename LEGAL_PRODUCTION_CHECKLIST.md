# Legal production checklist — INTERNAL

Not public. Served as `404` in production by the existing `*.md` route in `vercel.json`
(`{ "src": "/.*\\.md", "status": 404 }`). Do **not** link this from any page.

This tracks the operational / admin actions that must be completed alongside the
public legal pages (`/privacy`, `/terms`, `/cookies`, `/data-processing`). The
published pages are written to be accurate without these being resolved; the
items below make the underlying position concrete and are internal-only.

**Do not record secrets, credentials, API keys, or confidential contract text in
this file.** Reference where a document lives, not its contents.

---

## Data protection registration

- [ ] Check whether **Side Order Catering Ltd** must pay the **ICO data-protection fee**
      (controller processing personal data; likely Tier 1 for a micro business).
      Assess against the ICO self-assessment.
- [ ] If required, **register / pay** the fee.
- [ ] Record the **ICO registration reference internally**. Only add a registration
      number to `/privacy` once it is confirmed — the page currently makes **no**
      status claim and shows no number.

## Hosting / data location

- [ ] Confirm the **Supabase project region** (dashboard → Project Settings → region).
      `/privacy` and `/data-processing` currently make **no** location claim — update
      only if a claim is wanted and the region is confirmed.
- [ ] Confirm the **Vercel Functions region** actually in use (`iad1`/US observed on
      preview) and decide whether to pin `regions` in `vercel.json`.

## International transfers / provider DPAs

- [ ] Obtain and file the **data-processing agreement / DPA** and sub-processor list for
      each provider: **Supabase, Vercel, Stripe, Resend, OpenAI, Google (Analytics),
      PostHog**.
- [ ] Record, per provider, the **transfer mechanism** relied on (UK adequacy / UK IDTA /
      UK Addendum to the EU SCCs) and any transfer risk assessment.
- [ ] Keep the internal record aligned with the general wording on `/privacy` §11 and
      `/data-processing` §7 (which stay deliberately general).

## Analytics (PostHog / GA4)

- [ ] Confirm **PostHog project settings**: whether **autocapture** is on, and whether
      **session recording** is enabled. `/cookies` currently describes only identified
      account/product-usage events and makes **no** claim either way about session
      recording — update the page only if settings are confirmed and change what is
      collected.
- [ ] Confirm **GA4** configuration (data-retention setting, IP handling, Google
      signals off) and that it only loads post-consent (already implemented).
- [ ] Do a **real-browser consent QA**: fresh profile → no GA4/PostHog request, no
      `_ga`/PostHog cookie; "Necessary only" → still none; "Allow analytics" → both
      load; switch back → capture stops and known cookies/identifiers are removed;
      Supabase session untouched.

## Retention

- [ ] Record each provider's **backup / security-log retention window** internally.
      `/privacy` §12 stays general ("limited periods … normal retention cycle").
- [ ] Confirm the `stripe_events` 90-day purge job is live (`pg_cron`
      `purge-old-stripe-events`) — `/privacy` states 90 days.

## OpenAI

- [ ] Confirm the **OpenAI account / API data controls** for the API key Veriqo uses:
      training opt-out status (default is opted out), any **Modified Abuse Monitoring**
      or **Zero Data Retention** approval, and the retention that applies to the
      endpoints actually called. `/privacy` §9 stays general ("not used to train …
      by default"; retention "depends on the endpoint used and the account settings").
- [ ] Source checked 31 Aug 2026: <https://developers.openai.com/api/docs/guides/your-data>.

## haccp-photos storage migration

- [ ] The migration `supabase/migrations/20260831121500_haccp_photos_private.sql` is
      **pending and not applied**. Before applying:
  - [ ] Run read-only `select policyname, roles, cmd, qual from pg_policies
        where schemaname='storage' and tablename='objects' and qual ilike
        '%haccp-photos%';` to confirm the live public-read policy name.
  - [ ] Adjust the `DROP POLICY IF EXISTS "public can read photos"` line if the live
        name differs.
  - [ ] Apply the migration.
  - [ ] Re-run the `pg_policies` query and confirm the **only** SELECT policy left on
        the bucket is the authenticated, owner-folder-scoped one, and that `public`
        is `false` on the bucket.

## Account deletion (delete-account Edge Function v2)

- [ ] On a Supabase preview/staging deploy, run a **disposable-account delete test**:
      create a throwaway account, add data + at least one storage object, run the
      deletion, and confirm DB rows, auth user, storage objects and the Stripe
      subscription are all removed, and that a simulated storage failure returns
      `storage_cleanup_failed` (HTTP 500) with **no** partial deletion.
- [ ] Confirm `supabase.storage.listBuckets()` is permitted with the service-role
      key configuration the function uses.

## Ongoing

- [ ] Re-review `/privacy`, `/terms`, `/data-processing` and `/cookies` after any
      **material product change, new provider, pricing change, or change in customer
      type mix**, and update the "Last updated" date.
- [ ] Keep `terms.html` §23 (liability cap) under review before material pricing or
      customer-type changes (internal HTML comment marks the spot).
