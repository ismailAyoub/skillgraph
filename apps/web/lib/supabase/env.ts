/** Public Supabase config. Both values are safe to ship to the browser (RLS guards the data). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Accounts are optional: without these env vars the app stays local-first and hides sign-in. */
export const ACCOUNTS_ENABLED = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/**
 * OAuth buttons to show on /login, e.g. `github,google`. Each one must also be enabled in
 * Supabase (Authentication -> Sign In / Providers) with its client id and secret, or it 400s.
 */
export const OAUTH_PROVIDERS: ('github' | 'google')[] = (
  process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? ''
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s): s is 'github' | 'google' => s === 'github' || s === 'google');
