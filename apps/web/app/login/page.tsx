import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';
import { SiteHeader } from '@/components/marketing/SiteHeader';

export const metadata: Metadata = {
  title: 'Sign in — SkillGraph',
  description: 'Sign in or create a SkillGraph account, or keep working locally in this browser.',
};

export default function LoginPage() {
  return (
    <div className="mk flex min-h-screen flex-col">
      <SiteHeader />
      <main className="flex flex-1 items-start justify-center px-5 py-14 md:py-20">
        <Suspense
          fallback={
            <div
              aria-busy="true"
              className="h-[420px] w-full max-w-[420px] rounded-xl border border-[var(--line)] bg-[var(--panel)]"
            />
          }
        >
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
