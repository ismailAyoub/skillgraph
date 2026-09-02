'use client';

import Link from 'next/link';
import { ACCOUNTS_ENABLED, useSession } from '@/lib/auth';

export function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="shrink-0"
      role="img"
    >
      <path
        d="M10 6v4M10 10l-5 4.5M10 10l5 4.5"
        stroke="var(--muted)"
        strokeWidth="1.4"
        fill="none"
      />
      <rect x="6" y="1.5" width="8" height="5.5" rx="1.6" fill="var(--n-entry)" />
      <circle cx="4.5" cy="15.5" r="2.8" fill="var(--n-step)" />
      <path d="M15.5 12.4l3.1 3.1-3.1 3.1-3.1-3.1z" fill="var(--n-decision)" />
    </svg>
  );
}

const NAV = [
  { href: '/#how', label: 'How it works' },
  { href: '/#features', label: 'Features' },
  { href: '/#cli', label: 'CLI' },
];

export function SiteHeader() {
  const { loading, user } = useSession();
  const signedIn = !loading && user !== null;

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_86%,transparent)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <Link href="/" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <LogoMark />
          SkillGraph
        </Link>

        <nav aria-label="Site" className="hidden items-center gap-6 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {ACCOUNTS_ENABLED &&
            (signedIn ? (
              <Link
                href="/app"
                className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--ink)] transition hover:bg-neutral-200/60"
              >
                Dashboard
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-[var(--ink)] transition hover:bg-neutral-200/60"
              >
                Sign in
              </Link>
            ))}
          <Link
            href="/app"
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white transition hover:opacity-90"
          >
            Open the editor
          </Link>
        </div>
      </div>
    </header>
  );
}
