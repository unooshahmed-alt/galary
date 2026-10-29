import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until .env.local provides the Supabase URL and public anon key. */
export const isConfigured = Boolean(url && anonKey && !String(url).includes('YOUR-PROJECT-REF'));
export const allowSignup = String(import.meta.env.VITE_ALLOW_SIGNUP ?? 'true') !== 'false';

// Only the public anon key is used in the browser. Every table is protected by
// row-level security; privileged work runs in edge functions / SQL functions.
export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'public-anon-key-missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const DOCUMENTS_BUCKET = 'documents';
