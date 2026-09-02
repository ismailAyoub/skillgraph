import type { Metadata } from 'next';
import { SharedSkill } from '@/components/SharedSkill';

export const metadata: Metadata = { title: 'Shared skill · SkillGraph' };

export default async function SharedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <SharedSkill slug={slug} />;
}
