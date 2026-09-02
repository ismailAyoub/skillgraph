import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/** Only same-origin paths are allowed as a post-login destination. */
function safeNext(v: string | null): string {
  return v?.startsWith('/') && !v.startsWith('//') ? v : '/app';
}

/** OAuth and magic-link landing: exchanges the PKCE code for a session cookie, then redirects. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  const sb = await supabaseServer();
  if (!sb) return NextResponse.redirect(new URL('/login?error=accounts-disabled', url.origin));
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }
  const desc = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  return NextResponse.redirect(
    new URL(desc ? `/login?error=${encodeURIComponent(desc)}` : '/login', url.origin),
  );
}
