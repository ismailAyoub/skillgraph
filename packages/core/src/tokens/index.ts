/**
 * Heuristic token estimator. Prose runs ~3.8 chars/token, code/fenced blocks ~3.0.
 * Calibrate against `count_tokens` when exact numbers matter (CLI `--exact`).
 */
export function estimateTokens(markdown: string): number {
  let tokens = 0;
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      tokens += 2;
      continue;
    }
    const len = line.length;
    if (len === 0) {
      tokens += 1;
      continue;
    }
    tokens += Math.ceil(len / (inFence ? 3.0 : 3.8));
  }
  return tokens;
}

export function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.replace(/\n$/, '').split('\n').length;
}
