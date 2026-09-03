'use client';

import { useEffect, useState } from 'react';
import { setAiAvailability } from './ai';
import { bridgeHealth, getBridgeUrl } from './bridge';
import {
  type ClaudeAuthReport,
  type ClaudeStatus,
  claudeStep,
  mergeClaudeStatus,
  NO_CLAUDE,
} from './claudeStatus';
import {
  type AiBackend,
  getAiBackend,
  getAiModel,
  getAnthropicKey,
  onSettingsChange,
} from './settings';

/**
 * Where a call goes. `api`: this app's `/api/ai/*` with your key. `local`: the same routes, but the
 * server runs on your machine and uses `claude -p` with your Claude Code login (no key). `bridge`:
 * the `skillgraph dev` bridge, which does the same from a separate process.
 */
export type AiTarget = 'api' | 'local' | 'bridge';

export interface AiSettings {
  key: string;
  model: string;
  backend: AiBackend;
  /** This app's server runs on your machine and `claude` there is installed and logged in. */
  localAi: boolean;
  /** The bridge answered /api/health and `claude` there is installed and logged in. */
  bridgeAi: boolean;
  /** The subscription path in detail: which relay, is the CLI installed, is it logged in, as whom. */
  claude: ClaudeStatus;
  /** Which target a call would use right now, or null when nothing is available. */
  effective: AiTarget | null;
}

export function resolveBackend(
  backend: AiBackend,
  key: string,
  bridgeAi: boolean,
  localAi = false,
): AiTarget | null {
  // "Your Claude subscription" means claude -p on this machine; the app's own server is one process
  // fewer than the bridge, so it wins when both are there.
  const subscription: AiTarget | null = localAi ? 'local' : bridgeAi ? 'bridge' : null;
  if (backend === 'api') return key ? 'api' : null;
  if (backend === 'bridge') return subscription;
  return key ? 'api' : subscription;
}

interface LocalStatus {
  local: boolean;
  ai: string | null;
  claude: ClaudeAuthReport | null;
}

async function probeLocalAi(): Promise<LocalStatus | null> {
  try {
    const res = await fetch('/api/ai/status', { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return (await res.json()) as LocalStatus;
  } catch {
    return null;
  }
}

/** Reactive view of the AI settings plus what is reachable. Safe during SSR: starts empty. */
export function useAiSettings(): AiSettings {
  const [state, setState] = useState<AiSettings>({
    key: '',
    model: '',
    backend: 'auto',
    localAi: false,
    bridgeAi: false,
    claude: NO_CLAUDE,
    effective: null,
  });
  useEffect(() => {
    let alive = true;
    let bridgeAi = false;
    let localAi = false;
    let claude: ClaudeStatus = NO_CLAUDE;
    const sync = () => {
      const key = getAnthropicKey();
      const backend = getAiBackend();
      setState({
        key,
        model: getAiModel(),
        backend,
        localAi,
        bridgeAi,
        claude,
        effective: resolveBackend(backend, key, bridgeAi, localAi),
      });
    };
    sync();
    const probe = async () => {
      const [h, local] = await Promise.all([bridgeHealth(getBridgeUrl()), probeLocalAi()]);
      if (!alive) return;
      const bridge = h as { ai?: string | null; claude?: ClaudeAuthReport | null } | null;
      bridgeAi = bridge?.ai === 'claude-cli';
      localAi = local?.ai === 'claude-cli';
      claude = mergeClaudeStatus(
        local ? { enabled: local.local, claude: local.claude } : null,
        bridge,
      );
      setAiAvailability({ bridge: bridgeAi, local: localAi, step: claudeStep(claude) });
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
