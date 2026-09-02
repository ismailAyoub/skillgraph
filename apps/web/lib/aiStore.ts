'use client';

import type {
  CritiqueResult,
  DescribeResult,
  InterviewStep,
  InterviewTurn,
  Proposal,
  TriggerQuery,
} from '@skillgraph/ai';
import { create } from 'zustand';

export type AiMode = 'critique' | 'describe' | 'copilot' | 'interview' | 'import';

export interface AiPanelState {
  mode: AiMode;
  /** Skill the current proposals belong to; the editor resets the panel when it changes. */
  forSkill: string | null;
  /** Findings whose id the user dismissed; keyed by `${rule}:${nodeId}:${message}`. */
  dismissed: string[];
  critique: CritiqueResult | null;
  describe: DescribeResult | null;
  /** Trigger queries fetched on their own (the Describe sub-mode also fills this). */
  triggerQueries: TriggerQuery[] | null;
  copilot: Proposal | null;
  /** The node the current copilot proposal was made for. */
  copilotNodeId: string | null;
  interviewTurns: InterviewTurn[];
  interviewStep: InterviewStep | null;
  interviewDraft: string;
  /** A first user turn is queued (from the dashboard card) and should be sent as soon as AI is available. */
  interviewPending: boolean;
  transcript: string;
  importProposal: Proposal | null;
  recovery: Proposal | null;

  setMode(m: AiMode): void;
  set<K extends keyof AiPanelState>(key: K, value: AiPanelState[K]): void;
  dismiss(key: string): void;
  reset(): void;
}

const EMPTY = {
  dismissed: [] as string[],
  critique: null,
  describe: null,
  triggerQueries: null,
  copilot: null,
  copilotNodeId: null,
  interviewTurns: [] as InterviewTurn[],
  interviewStep: null,
  interviewDraft: '',
  interviewPending: false,
  transcript: '',
  importProposal: null,
  recovery: null,
};

/**
 * Proposals live here rather than in component state so switching preview tabs (or AI sub-modes)
 * keeps them. Nothing here is applied to the graph; Apply goes through `useEditor.dispatch`.
 */
export const useAiPanel = create<AiPanelState>((set) => ({
  mode: 'interview',
  forSkill: null,
  ...EMPTY,
  setMode: (mode) => set({ mode }),
  set: (key, value) => set({ [key]: value } as Partial<AiPanelState>),
  dismiss: (key) => set((s) => ({ dismissed: [...s.dismissed, key] })),
  reset: () => set({ ...EMPTY }),
}));
