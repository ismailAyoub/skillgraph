'use client';

import { useEffect, useState } from 'react';
import { setBridgeAiAvailable } from './ai';
import { bridgeHealth, getBridgeUrl } from './bridge';
import {
  type AiBackend,
  getAiBackend,
  getAiModel,
  getAnthropicKey,
  onSettingsChange,
} from './settings';

export interface AiSettings {
  key: string;
  model: string;
  backend: AiBackend;
  /** The local bridge answered /api/health and offers AI (`skillgraph dev` is running). */
  bridgeAi: boolean;
  /** Which backend a call would use right now, or null when nothing is available. */
  effective: 'api' | 'bridge' | null;
}

export function resolveBackend(
  backend: AiBackend,
  key: string,
  bridgeAi: boolean,
): 'api' | 'bridge' | null {
  if (backend === 'api') return key ? 'api' : null;
  if (backend === 'bridge') return bridgeAi ? 'bridge' : null;
  if (key) return 'api';
  return bridgeAi ? 'bridge' : null;
}

/** Reactive view of the AI settings plus bridge availability. Safe during SSR: starts empty. */
export function useAiSettings(): AiSettings {
  const [state, setState] = useState<AiSettings>({
    key: '',
    model: '',
    backend: 'auto',
    bridgeAi: false,
    effective: null,
  });
  useEffect(() => {
    let alive = true;
    let bridgeAi = false;
    const sync = () => {
      const key = getAnthropicKey();
      const backend = getAiBackend();
      setState({
        key,
        model: getAiModel(),
        backend,
        bridgeAi,
        effective: resolveBackend(backend, key, bridgeAi),
      });
    };
    sync();
    const probe = async () => {
      const h = await bridgeHealth(getBridgeUrl());
      if (!alive) return;
      bridgeAi = !!h && (h as { ai?: string }).ai === 'claude-cli';
      setBridgeAiAvailable(bridgeAi);
      sync();
    };
    void probe();
    const timer = setInterval(() => void probe(), 15_000);
    const off = onSettingsChange(() => {
      sync();
      void probe();
    });
    return () => {
      alive = false;
      clearInterval(timer);
      off();
    };
  }, []);
  return state;
}
