import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/marketing/SiteHeader';

/** Shared shell for the privacy and terms pages: site header plus a narrow prose column. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mb-8 text-[12px] text-[var(--muted)]">Last updated {updated}</p>
        <div className="space-y-5 text-[14px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
    </>
  );
}
