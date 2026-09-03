/** Per-browser settings (localStorage). Every access is wrapped: storage may be unavailable. */

export const DEFAULT_AI_MODEL = 'claude-opus-5';
export const AI_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const AI_BACKENDS = ['auto', 'api', 'bridge'] as const;
export type AiBackend = (typeof AI_BACKENDS)[number];

const KEY_KEY = 'skillgraph:anthropicKey';
const BACKEND_KEY = 'skillgraph:aiBackend';
const MODEL_KEY = 'skillgraph:anthropicModel';
const EVENT = 'skillgraph:settings';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode, disabled); keep going without persistence
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // not in a browser
  }
}

export function getAnthropicKey(): string {
  return read(KEY_KEY) ?? '';
}

export function setAnthropicKey(key: string): void {
  write(KEY_KEY, key.trim());
}

export function getAiModel(): string {
  return read(MODEL_KEY) || DEFAULT_AI_MODEL;
}

export function setAiModel(model: string): void {
  write(MODEL_KEY, model || DEFAULT_AI_MODEL);
}

/**
 * `api`: hosted /api/ai routes with your key. `bridge`: the local `skillgraph dev` bridge, which
 * runs `claude -p` with your Claude Code login (no key). `auto`: api when a key is set, else bridge.
 */
export function getAiBackend(): AiBackend {
  const v = read(BACKEND_KEY);
  return (AI_BACKENDS as readonly string[]).includes(v ?? '') ? (v as AiBackend) : 'auto';
}

export function setAiBackend(backend: AiBackend): void {
  write(BACKEND_KEY, backend === 'auto' ? null : backend);
}

export function hasAnthropicKey(): boolean {
  return getAnthropicKey().length > 0;
}

/** Wake every `onSettingsChange` listener (they re-probe what is reachable). */
export function notifySettingsChange(): void {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // not in a browser
  }
}

/** Subscribe to settings changes made in this tab. Returns an unsubscribe function. */
export function onSettingsChange(cb: () => void): () => void {
  try {
    window.addEventListener(EVENT, cb);
    window.addEventListener('storage', cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener('storage', cb);
    };
  } catch {
    return () => {};
  }
}
