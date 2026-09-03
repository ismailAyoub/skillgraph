'use client';

import { Check, LogIn, LogOut, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { ACCOUNTS_ENABLED, signOut, useSession } from '@/lib/auth';
import { useUi } from '@/lib/uiStore';
import { useAiSettings } from '@/lib/useSettings';

export function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path d="M8 7.5 10.5 16M16 7.5 13.5 16M8.5 6h7" />
      </svg>
      <span className="font-serif text-[19px] font-medium tracking-[-0.01em]">SkillGraph</span>
    </span>
  );
}

/** Top bar of the dashboard: wordmark, section links, AI status, account. */
export function AccountBar() {
  const { loading, user } = useSession();
  const router = useRouter();
  const { effective } = useAiSettings();
  const setSetupOpen = useUi((s) => s.setAiSetupOpen);
  return (
    <div className="border-b border-[var(--line)] bg-[var(--panel)]">
      <div className="mx-auto flex max-w-5xl items-center gap-6 px-8 py-4 text-[13px]">
        <Link href="/" className="text-[var(--ink)]">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-5 text-[var(--muted)]" aria-label="Dashboard">
          <span className="font-medium text-[var(--ink)]">Skills</span>
          <a href="#local" className="hover:text-[var(--ink)]">
            Local folder
          </a>
          {ACCOUNTS_ENABLED && (
            <a href="#cloud" className="hover:text-[var(--ink)]">
              Cloud
            </a>
          )}
        </nav>
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() => setSetupOpen(true)}
          className={`flex items-center gap-1.5 text-[12.5px] ${effective ? 'text-[var(--muted)] hover:text-[var(--ink)]' : 'text-[var(--accent)]'}`}
          title="Connect AI"
          data-testid="ai-status"
        >
          {effective ? (
            <>
              <span className="h-[7px] w-[7px] rounded-full bg-[var(--ok)]" />
              {effective === 'bridge' ? 'AI: Claude subscription' : 'AI: API key'}
              <Check size={12} className="text-[var(--ok)]" />
            </>
          ) : (
            <>
              <Sparkles size={13} /> Connect AI
            </>
          )}
        </button>
        {ACCOUNTS_ENABLED && !loading && user && (
          <>
            <span className="text-[12.5px] text-[var(--muted)]" title={user.email ?? user.id}>
              {user.email ?? 'Signed in'}
            </span>
            <Button
              variant="ghost"
              onClick={async () => {
                await signOut();
                router.refresh();
              }}
            >
              <LogOut size={13} /> Sign out
            </Button>
          </>
        )}
        {ACCOUNTS_ENABLED && !loading && !user && (
          <Link href="/login?next=/app">
            <Button variant="primary">
              <LogIn size={13} /> Sign in
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
