import type { SkillFile } from '@skillgraph/core';

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:4321';

/**
 * How to start the local bridge. The CLI is not on npm yet, so the bridge runs from a checkout of
 * the repo; collapse this to `npx skillgraph dev` once it is published.
 */
export const BRIDGE_REPO_URL = 'https://github.com/ismailAyoub/skillgraph';
export const BRIDGE_START_COMMANDS = [
  'git clone https://github.com/ismailAyoub/skillgraph.git && cd skillgraph',
  'pnpm install',
  'pnpm --filter skillgraph dev dev',
] as const;
const KEY = 'skillgraph:bridgeUrl';

export interface BridgeSkill {
  name: string;
  hasGraph: boolean;
  hasSkillMd: boolean;
  description: string;
  updatedAt: number;
}

export interface BridgeOrigin {
  type: 'bridge';
  url: string;
  name: string;
  diskHashes: Record<string, string>;
}

export function getBridgeUrl(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_BRIDGE_URL;
  } catch {
    return DEFAULT_BRIDGE_URL;
  }
}

export function setBridgeUrl(url: string): void {
  try {
    localStorage.setItem(KEY, url);
  } catch {
    // ignore
  }
}

async function request<T>(url: string, init?: RequestInit, timeoutMs = 4000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = (await res.json()) as T & { error?: string; drifted?: string[] };
    if (!res.ok) {
      const err = new Error(body.error ?? `HTTP ${res.status}`) as Error & {
        status?: number;
        drifted?: string[];
      };
      err.status = res.status;
      err.drifted = body.drifted;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

export async function bridgeHealth(
  url = getBridgeUrl(),
): Promise<{ ok: boolean; dir: string; version: string } | null> {
  try {
    return await request(`${url}/api/health`, undefined, 1500);
  } catch {
    return null;
  }
}

export function bridgeList(url = getBridgeUrl()): Promise<BridgeSkill[]> {
  return request(`${url}/api/skills`);
}

export function bridgeOpen(
  url: string,
  name: string,
): Promise<{
  name: string;
  graph: SkillFile;
  coverage?: number;
  diskHashes: Record<string, string>;
  source: 'graph' | 'skill.md';
}> {
  return request(`${url}/api/skills/${encodeURIComponent(name)}`);
}

export function bridgeSave(
  url: string,
  name: string,
  file: SkillFile,
  diskHashes: Record<string, string>,
  force = false,
): Promise<{ ok: true; written: string[]; diskHashes: Record<string, string> }> {
  return request(`${url}/api/skills/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, diskHashes, force }),
  });
}

export interface HeatCell {
  visits: number;
  runs: number;
  ratio: number;
}

/** Traces collected by `skillgraph eval run --trace`, plus a per-node visit heatmap. */
export function bridgeTraces(
  url: string,
  name: string,
): Promise<{ traces: unknown[]; heatmap: Record<string, HeatCell> }> {
  return request(`${url}/api/skills/${encodeURIComponent(name)}/traces`);
}
