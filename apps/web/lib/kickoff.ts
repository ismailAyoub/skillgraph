/**
 * The dashboard's "build a skill by chatting" card creates a skill and hands the first message to
 * the editor through sessionStorage (survives the navigation and a reload, dies with the tab).
 */
const PREFIX = 'skillgraph:kickoff:';

export function setKickoff(skillId: string, message: string): void {
  try {
    sessionStorage.setItem(PREFIX + skillId, message);
  } catch {
    // storage unavailable; the editor simply opens without the first message
  }
}

/** Read and clear the pending first message for a skill, if any. */
export function takeKickoff(skillId: string): string | null {
  try {
    const v = sessionStorage.getItem(PREFIX + skillId);
    if (v !== null) sessionStorage.removeItem(PREFIX + skillId);
    return v;
  } catch {
    return null;
  }
}
