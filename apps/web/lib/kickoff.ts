import type { InterviewStep, InterviewTurn } from '@skillgraph/ai';

/**
 * The dashboard chat hands its conversation to the editor through sessionStorage (survives the
 * navigation and a reload, dies with the tab), so the chat continues where it left off.
 */
const PREFIX = 'skillgraph:kickoff:';

export interface Kickoff {
  turns: InterviewTurn[];
  step: InterviewStep | null;
}

export function setKickoff(skillId: string, kickoff: Kickoff): void {
  try {
    sessionStorage.setItem(PREFIX + skillId, JSON.stringify(kickoff));
  } catch {
    // storage unavailable; the editor simply opens without the conversation
  }
}

/** Read and clear the pending conversation for a skill, if any. */
export function takeKickoff(skillId: string): Kickoff | null {
  try {
    const v = sessionStorage.getItem(PREFIX + skillId);
    if (v === null) return null;
    sessionStorage.removeItem(PREFIX + skillId);
    const parsed = JSON.parse(v) as Kickoff;
    return Array.isArray(parsed.turns) ? parsed : null;
  } catch {
    return null;
  }
}
