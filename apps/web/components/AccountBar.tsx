'use client';

import { LogIn, LogOut, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { ACCOUNTS_ENABLED, signOut, useSession } from '@/lib/auth';

/** Top strip of the dashboard: site link + who is signed in. */
export function AccountBar() {
  const { loading, user } = useSession();
  const router = useRouter();
  return (
    <div className="mb-6 flex items-center gap-3 text-[12px] text-[var(--muted)]">
      <Link href="/" className="font-semibold text-[var(--ink)] hover:underline">
        SkillGraph
      </Link>
      <span className="text-[var(--line)]">/</span>
      <span>Dashboard</span>
      <span className="ml-auto" />
      {ACCOUNTS_ENABLED && !loading && user && (
        <>
          <span className="flex items-center gap-1" title={user.email ?? user.id}>
            <UserRound size={13} /> {user.email ?? 'Signed in'}
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
  );
}
