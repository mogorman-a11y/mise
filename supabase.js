// supabase.js — Supabase client initialisation
// ─────────────────────────────────────────────
// The URL and anon key are SAFE to include in client-side code.
// Supabase Row Level Security controls what each user can read/write.
// Never put your service role key here — that stays server-side only.
//
// Find these values in:
//   Supabase dashboard → Project Settings → API → Project URL / anon key

const SUPABASE_URL  = 'https://yixrwyfodipfcbhjcszp.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpeHJ3eWZvZGlwZmNiaGpjc3pwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwODg3MDIsImV4cCI6MjA5MTY2NDcwMn0.nXbnQ5iOxFEM5xWUP-p1a9hNyIlVe0xex0wQxZ9L4UE';

// supabaseClient is used by auth.js, sync.js, and subscription.js.
// No flowType override — uses the Supabase JS v2 default (pkce).
// Magic links and password resets use verifyOtp({token_hash}) directly,
// which is flow-type independent and works cross-browser without a code verifier.
// Google OAuth uses PKCE in the same browser tab, which is always correct.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
