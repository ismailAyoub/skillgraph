'use client';

import { useEffect, useState } from 'react';
import { getAiModel, getAnthropicKey, onSettingsChange } from './settings';

export interface AiSettings {
  key: string;
  model: string;
}

/** Reactive view of the AI settings (key + model). Safe during SSR: starts empty. */
export function useAiSettings(): AiSettings {
  const [state, setState] = useState<AiSettings>({ key: '', model: '' });
  useEffect(() => {
    const sync = () => setState({ key: getAnthropicKey(), model: getAiModel() });
    sync();
    return onSettingsChange(sync);
  }, []);
  return state;
}
