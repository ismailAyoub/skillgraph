import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

const URL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const KEY_ENV = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Keeps the Supabase session cookie fresh on every navigation (no auth gating: the app is local-first). */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!URL_ENV || !KEY_ENV) return response;
  const supabase = createServerClient(URL_ENV, KEY_ENV, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // Touching the user refreshes an expiring token and writes the new cookie.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
