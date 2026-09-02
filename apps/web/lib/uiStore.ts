'use client';

import { create } from 'zustand';

export type PreviewTab = 'rendered' | 'raw' | 'files' | 'lint' | 'diagram' | 'ai';

interface UiState {
  /** Active tab of the right-hand preview panel; lifted so the header can open the AI tab. */
  previewTab: PreviewTab;
  setPreviewTab(tab: PreviewTab): void;
  /** The "Connect AI" dialog is opened from several places (header, AI panel, dashboard). */
  aiSetupOpen: boolean;
  setAiSetupOpen(open: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  previewTab: 'rendered',
  setPreviewTab: (previewTab) => set({ previewTab }),
  aiSetupOpen: false,
  setAiSetupOpen: (aiSetupOpen) => set({ aiSetupOpen }),
}));
