import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const ui = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ui',
});
const code = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-code' });
const display = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500'],
  style: ['normal', 'italic'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'SkillGraph',
  description: 'Draw Agent Skills as graphs; compile them to SKILL.md.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${ui.variable} ${code.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
