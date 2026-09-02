import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Privacy — SkillGraph' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="September 2, 2026">
      <p>
        SkillGraph is a local-first editor for Agent Skills. This page explains what data the hosted
        app touches and what it does not.
      </p>
      <h2>Without an account</h2>
      <p>
        Skills you draw are stored in your browser (IndexedDB) and never leave it unless you export
        them or press "Save to cloud". The optional AI features send the skill you are editing to
        Anthropic's API using an API key you supply; the key is kept in your browser's localStorage,
        travels to this app's server only inside each request, and is never logged or stored there.
      </p>
      <h2>With an account</h2>
      <p>
        Signing in (email and password, email link, GitHub or Google) creates an account in our
        authentication provider, Supabase. We store your email address, the sign-in method, and the
        skills you choose to save to the cloud: their graph, name and description. Skills are
        private to you unless you turn on sharing, which makes that one skill readable by anyone
        with its link until you turn sharing off.
      </p>
      <h2>Third parties</h2>
      <ul>
        <li>
          Supabase hosts authentication and the cloud-saved skills (United States, us-east-1).
        </li>
        <li>Vercel hosts the web app and processes standard request logs.</li>
        <li>Anthropic processes AI requests you initiate with your own API key.</li>
        <li>
          GitHub and Google act as sign-in providers only when you choose them; we receive your
          email address and basic profile from them, nothing else.
        </li>
      </ul>
      <h2>What we do not do</h2>
      <ul>
        <li>No advertising, no tracking pixels, no sale of data.</li>
        <li>No analytics beyond hosting logs.</li>
        <li>
          No access to your Claude Code login or subscription; the local bridge runs entirely on
          your machine.
        </li>
      </ul>
      <h2>Your choices</h2>
      <p>
        Delete a cloud skill from the dashboard at any time. To delete your account and everything
        attached to it, email the address below and we will remove it within 30 days.
      </p>
      <h2>Contact</h2>
      <p>ismail.marwan.a@gmail.com</p>
    </LegalPage>
  );
}
