import type { Metadata } from 'next';
import { Home } from '@/components/Home';

export const metadata: Metadata = { title: 'Your skills · SkillGraph' };

export default function AppPage() {
  return <Home />;
}
