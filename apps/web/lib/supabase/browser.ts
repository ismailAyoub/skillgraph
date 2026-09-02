'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNTS_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

let client: SupabaseClient | null = null;

/** Singleton browser client (cookie-based session, shared with the server helpers). */
export function supabaseBrowser(): SupabaseClient | null {
  if (!ACCOUNTS_ENABLED) return null;
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}
