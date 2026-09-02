import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nano = customAlphabet(alphabet, 8);

/** Opaque, stable node/edge id: `${kind}_${8 base36 chars}`. */
export function newId(kind: string): string {
  return `${kind}_${nano()}`;
}

/** Deterministic id generator for tests and imports (sequential per prefix). */
export function sequentialIds(): (kind: string) => string {
  const counters = new Map<string, number>();
  return (kind) => {
    const n = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, n);
    return `${kind}_${String(n).padStart(4, '0')}`;
  };
}
