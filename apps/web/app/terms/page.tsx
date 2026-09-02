import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Terms — SkillGraph' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="September 2, 2026">
      <p>
        These terms cover the hosted SkillGraph app at skillgraph-olive.vercel.app, currently
        offered free of charge as an early-access preview.
      </p>
      <h2>The service</h2>
      <p>
        SkillGraph lets you draw Agent Skills as graphs, compile them to SKILL.md, and optionally
        store and share them through an account. It is provided as is, without warranty, and may
        change or be discontinued. If the hosted service ends, your skills remain exportable and the
        compiled files are plain Markdown you already own.
      </p>
      <h2>Your content</h2>
      <p>
        You keep all rights to the skills you create. You grant us only the permission needed to
        store and display them to you and, for skills you share, to anyone with the link. You are
        responsible for what you publish through a share link and for having the right to use any
        content you import.
      </p>
      <h2>Acceptable use</h2>
      <ul>
        <li>
          Do not use the service to distribute malware, harassment, or content that is illegal where
          you or your audience live.
        </li>
        <li>Do not attempt to access other users' private skills or to disrupt the service.</li>
        <li>
          AI features run on your own Anthropic API key or your own Claude Code login; their use is
          also subject to Anthropic's terms.
        </li>
      </ul>
      <h2>Accounts</h2>
      <p>
        You may close your account at any time by contacting us. We may suspend accounts that
        violate these terms.
      </p>
      <h2>Liability</h2>
      <p>
        To the extent permitted by law, we are not liable for indirect or consequential damages
        arising from the use of the hosted service. Our total liability is limited to the amount you
        paid for it, which today is nothing.
      </p>
      <h2>Contact</h2>
      <p>ismail.marwan.a@gmail.com</p>
    </LegalPage>
  );
}
