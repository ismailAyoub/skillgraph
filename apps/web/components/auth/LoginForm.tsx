'use client';

import { Eye, EyeOff, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { LogoMark } from '@/components/marketing/SiteHeader';
import { Button, Field, Input, Tabs } from '@/components/ui';
import {
  ACCOUNTS_ENABLED,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  resendConfirmation,
  signInWithMagicLink,
  signInWithOAuth,
  signInWithPassword,
  signUpWithPassword,
  useSession,
} from '@/lib/auth';

type Mode = 'signin' | 'signup' | 'magic';
type Notice = { tone: 'ok' | 'err'; text: string } | null;

const TABS: { id: Mode; label: string }[] = [
  { id: 'signin', label: 'Sign in' },
  { id: 'signup', label: 'Create account' },
  { id: 'magic', label: 'Email link' },
];

const MIN_PASSWORD = 8;

/** Only same-origin paths are honoured, so `?next=` cannot bounce to another site. */
function safeNext(raw: string | null): string {
  if (!raw) return '/app';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/app';
  return raw;
}

function GitHubMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="login-card"
      className="w-full max-w-[420px] rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_40px_-24px_rgb(0_0_0/0.25)]"
    >
      {children}
    </div>
  );
}

function ContinueLocally() {
  return (
    <div className="border-t border-[var(--line)] px-6 py-4 text-center">
      <Link
        href="/app"
        className="text-[13px] font-medium text-[var(--ink)] underline decoration-[var(--line)] underline-offset-4 transition hover:decoration-[var(--ink)]"
      >
        Continue without an account
      </Link>
      <p className="mt-1 text-[12px] text-[var(--muted)]">
        Skills stay in this browser's storage. You can export them any time.
      </p>
    </div>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { loading, user } = useSession();

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<'form' | OAuthProvider | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const noticeId = useId();

  // Already signed in: go where the caller wanted.
  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setNotice(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (mode === 'signup' && password.length < MIN_PASSWORD) {
      setNotice({ tone: 'err', text: `Use at least ${MIN_PASSWORD} characters for the password.` });
      return;
    }
    setBusy('form');
    setNotice(null);
    try {
      if (mode === 'signin') {
        const r = await signInWithPassword(trimmed, password);
        if (r.ok) {
          router.replace(next);
          return;
        }
        setNotice({ tone: 'err', text: r.message ?? 'Sign-in failed.' });
      } else if (mode === 'signup') {
        const r = await signUpWithPassword(trimmed, password, next);
        if (r.ok && !r.message) {
          router.replace(next);
          return;
        }
        setNotice({ tone: r.ok ? 'ok' : 'err', text: r.message ?? 'Sign-up failed.' });
      } else {
        const r = await signInWithMagicLink(trimmed, next);
        setNotice({
          tone: r.ok ? 'ok' : 'err',
          text: r.message ?? (r.ok ? 'Check your email.' : 'Could not send the link.'),
        });
      }
    } finally {
      setBusy(null);
    }
  };

  const oauth = async (provider: OAuthProvider) => {
    if (busy) return;
    setBusy(provider);
    setNotice(null);
    const r = await signInWithOAuth(provider, next);
    if (!r.ok) {
      setNotice({ tone: 'err', text: r.message ?? `Could not start ${provider} sign-in.` });
      setBusy(null);
    }
    // On success the browser is leaving the page; keep the button busy.
  };

  if (!ACCOUNTS_ENABLED) {
    return (
      <Card>
        <div className="px-6 pt-6 pb-5" data-testid="accounts-disabled">
          <LogoMark size={22} />
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Accounts coming soon</h1>
          <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--muted)]">
            This deployment has no account service configured, so there is nothing to sign in to
            yet. SkillGraph is local-first: skills live in this browser, the editor works fully
            offline, and export gives you a plain skill folder whenever you want one.
          </p>
        </div>
        <div className="border-t border-[var(--line)] px-6 py-5">
          <Link
            href="/app"
            className="inline-flex w-full items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90"
          >
            Continue without an account
          </Link>
          <p className="mt-2 text-center text-[12px] text-[var(--muted)]">
            Skills stay in this browser's storage.
          </p>
        </div>
      </Card>
    );
  }

  if (user) {
    return (
      <Card>
        <div className="flex items-center gap-2 px-6 py-8 text-[13px] text-[var(--muted)]">
          <LoaderCircle size={14} className="animate-spin" />
          Signed in, taking you to {next}…
        </div>
      </Card>
    );
  }

  const title =
    mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create your account' : 'Email me a link';

  return (
    <Card>
      <div className="px-6 pt-6 pb-2">
        <LogoMark size={22} />
        <h1 className="mt-4 text-[20px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          {mode === 'magic'
            ? 'No password. We send a one-time link to your inbox.'
            : 'Sync skills across devices and share them by link.'}
        </p>
        <p className="mt-2 text-[12px] leading-[1.5] text-[var(--muted)]">
          This is your SkillGraph account, not a Claude account. To let the AI use your Claude
          subscription or an API key, open &ldquo;Connect AI&rdquo; inside the editor.
        </p>
      </div>

      <div data-testid="login-tabs">
        <Tabs tabs={TABS} value={mode} onChange={switchMode} />
      </div>

      <form onSubmit={submit} className="space-y-4 px-6 pt-5 pb-2" noValidate>
        <Field label="Email">
          <Input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={busy !== null}
          />
        </Field>

        {mode !== 'magic' && (
          <Field
            label="Password"
            hint={mode === 'signup' ? `at least ${MIN_PASSWORD} characters` : undefined}
          >
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy !== null}
                style={{ paddingRight: 34 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-[var(--muted)] hover:text-[var(--ink)]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </Field>
        )}

        {notice && (
          <p
            id={noticeId}
            role={notice.tone === 'err' ? 'alert' : 'status'}
            className={`rounded-md border px-3 py-2 text-[12.5px] ${
              notice.tone === 'err'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-green-200 bg-green-50 text-green-700'
            }`}
          >
            {notice.text}
            {/not confirmed/i.test(notice.text) && (
              <button
                type="button"
                className="ml-2 underline"
                onClick={async () => {
                  const r = await resendConfirmation(email.trim(), next);
                  setNotice({ tone: r.ok ? 'ok' : 'err', text: r.message ?? '' });
                }}
              >
                Resend confirmation email
              </button>
            )}
          </p>
        )}

        <Button
          variant="primary"
          type="submit"
          disabled={busy !== null}
          className="w-full justify-center py-2.5 text-[13.5px]"
          aria-describedby={notice ? noticeId : undefined}
        >
          {busy === 'form' && <LoaderCircle size={14} className="animate-spin" />}
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send link'}
        </Button>
      </form>

      {OAUTH_PROVIDERS.length > 0 && (
        <div className="px-6 pt-3 pb-5">
          <div className="mb-3 flex items-center gap-3 text-[11px] text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--line)]" />
            or continue with
            <span className="h-px flex-1 bg-[var(--line)]" />
          </div>
          <div
            className={`grid gap-2 ${OAUTH_PROVIDERS.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            {OAUTH_PROVIDERS.includes('github') && (
              <Button
                onClick={() => oauth('github')}
                disabled={busy !== null}
                className="justify-center py-2 text-[13px]"
              >
                {busy === 'github' ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <GitHubMark />
                )}
                GitHub
              </Button>
            )}
            {OAUTH_PROVIDERS.includes('google') && (
              <Button
                onClick={() => oauth('google')}
                disabled={busy !== null}
                className="justify-center py-2 text-[13px]"
              >
                {busy === 'google' ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <GoogleMark />
                )}
                Google
              </Button>
            )}
          </div>
        </div>
      )}

      <ContinueLocally />
    </Card>
  );
}
