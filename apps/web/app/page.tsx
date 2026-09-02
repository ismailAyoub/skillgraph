import type { Metadata } from 'next';
import { Landing } from '@/components/marketing/Landing';

export const metadata: Metadata = {
  title: 'SkillGraph — See the skill',
  description:
    'Draw an Agent Skill as a graph, compile it deterministically to a spec-compliant SKILL.md, lint it, and import any existing skill back without losing a line.',
};

export default function Page() {
  return <Landing />;
}
