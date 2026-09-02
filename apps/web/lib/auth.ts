'use client';

/**
 * Auth contract used by the login page, headers and the cloud sync layer. Everything goes
 * through Supabase Auth; when accounts are disabled (no env vars) every call resolves to
 * "signed out" so the UI can hide itself.
 */
import type { Session, User } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase/browser';
import { ACCOUNTS_ENABLED } from './supabase/env';

export type OAuthProvider = 'github' | 'google';

export interface AuthResult {
  ok: boolean;
  /** Human-readable message for the form (error, or e.g. "Check your email"). */
  message?: string;
}

export { ACCOUNTS_ENABLED };

function siteUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3210';
}

/** Where auth emails and OAuth send the browser back to; `next` is the in-app destination. */
function callbackUrl(next = '/app'): string {
  return `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Accounts are not enabled on this deployment.' };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signUpWithPassword(
  email: string,
  password: string,
  next = '/app',
): Promise<AuthResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Accounts are not enabled on this deployment.' };
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: callbackUrl(next) },
  });
  if (error) return { ok: false, message: error.message };
  if (data.session) return { ok: true };
  return { ok: true, message: 'Check your email to confirm your account, then sign in.' };
}

export async function signInWithMagicLink(email: string, next = '/app'): Promise<AuthResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Accounts are not enabled on this deployment.' };
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl(next) },
  });
  return error
    ? { ok: false, message: error.message }
    : { ok: true, message: 'Check your email for a sign-in link.' };
}

/** Starts the OAuth redirect; the browser leaves the page on success. */
export async function signInWithOAuth(provider: OAuthProvider, next = '/app'): Promise<AuthResult> {
  const sb = supabaseBrowser();
  if (!sb) return { ok: false, message: 'Accounts are not enabled on this deployment.' };
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: { redirectTo: callbackUrl(next) },
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function signOut(): Promise<void> {
  const sb = supabaseBrowser();
  if (sb) await sb.auth.signOut();
}

export async function getUser(): Promise<User | null> {
  const sb = supabaseBrowser();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

export interface SessionState {
  /** `true` until the first auth check resolves; render neutral UI meanwhile. */
  loading: boolean;
  user: User | null;
  session: Session | null;
}

/** Reactive session for client components. Safe during SSR (starts loading, no user). */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ loading: true, user: null, session: null });
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) {
      setState({ loading: false, user: null, session: null });
      return;
    }
    let alive = true;
    void sb.auth.getSession().then(({ data }) => {
      if (alive)
        setState({ loading: false, user: data.session?.user ?? null, session: data.session });
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (alive) setState({ loading: false, user: session?.user ?? null, session });
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return state;
}
