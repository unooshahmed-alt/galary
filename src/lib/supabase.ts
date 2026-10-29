import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createDemoClient } from './demoClient';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False until .env.local provides the Supabase URL and public anon key. */
export const isConfigured = Boolean(url && anonKey && !String(url).includes('YOUR-PROJECT-REF'));

/**
 * Demo mode: no database configured (or VITE_DEMO=true). The app runs on
 * built-in sample data so it can be explored; nothing is saved.
 */
export const isDemo = !isConfigured || String(import.meta.env.VITE_DEMO ?? '') === 'true';
export const allowSignup = String(import.meta.env.VITE_ALLOW_SIGNUP ?? 'true') !== 'false';

// Only the public anon key is used in the browser. Every table is protected by
// row-level security; privileged work runs in edge functions / SQL functions.
export const supabase = isDemo
  ? (createDemoClient() as unknown as SupabaseClient)
  : createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

export const DOCUMENTS_BUCKET = 'documents';
