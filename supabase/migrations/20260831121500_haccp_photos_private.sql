-- Privacy hardening 2026-08-31 — make the `haccp-photos` bucket private.
--
-- Context: `20260519090844_create_haccp_photos_bucket.sql` created this bucket
-- with `public = true` and a blanket `FOR SELECT USING (bucket_id =
-- 'haccp-photos')` policy, so any object was retrievable by anyone holding
-- only its URL. HACCP photos include delivery / incident / kitchen-assessment
-- images and staff certificate scans (a named individual + their
-- qualification), so public read is not appropriate.
--
-- The currently shipped app stores every one of these images as a base64
-- data URL inside `haccp_records.records` (JSONB) and the profile logo inside
-- `profiles.logo` — no application code path uploads to, or reads a public
-- URL from, this bucket today. Flipping it private therefore has no UI
-- impact. The authenticated, tenant-scoped SELECT policy below is added so
-- that if the app later moves these images to real object storage, reads are
-- already owner-scoped (same predicate as the existing INSERT/DELETE
-- policies) rather than world-readable.
--
-- Effect on any existing objects: setting `public = false` immediately stops
-- anonymous retrieval via the public object URL. Any previously issued
-- public URL / stored `public_url` value becomes non-resolving for
-- unauthenticated callers; authenticated owners can still fetch their own
-- files via a signed URL or an authenticated download. No files are deleted.

UPDATE storage.buckets
SET public = false
WHERE id = 'haccp-photos';

DROP POLICY IF EXISTS "public can read photos" ON storage.objects;

CREATE POLICY "users can read own haccp photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'haccp-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
