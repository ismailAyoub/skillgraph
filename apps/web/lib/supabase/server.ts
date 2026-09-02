import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { ACCOUNTS_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/** Server-side client for route handlers and server components (reads the session cookie). */
export async function supabaseServer(): Promise<SupabaseClient | null> {
  if (!ACCOUNTS_ENABLED) return null;
  const store = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components cannot set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}
