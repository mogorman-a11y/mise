-- Reconciled from prod on 2026-07-25 — applied directly to the live database
-- (dashboard/SQL editor), never captured as a local migration file until now.
-- Recovered verbatim from supabase_migrations.schema_migrations.statements
-- via `supabase db query --linked` (read-only). See README_DRIFT.md.

-- Create the bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('haccp-photos', 'haccp-photos', true, 5242880, ARRAY['image/jpeg','image/png','image/webp']);

-- RLS: authenticated users can upload to their own path prefix
CREATE POLICY "users can upload own photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'haccp-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: authenticated users can delete their own photos
CREATE POLICY "users can delete own photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'haccp-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read (public bucket — anyone with URL can view)
CREATE POLICY "public can read photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'haccp-photos');
