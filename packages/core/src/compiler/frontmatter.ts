import type { EntryNodeT, Profile } from '../schema/graph';
import type { Ctx } from './context';

/** camelCase graph field -> YAML key, in the fixed emission order for the claude-code profile. */
export const CLAUDE_CODE_KEYS: Array<[string, string]> = [
  ['argumentHint', 'argument-hint'],
  ['arguments', 'arguments'],
  ['whenToUse', 'when_to_use'],
  ['disableModelInvocation', 'disable-model-invocation'],
  ['userInvocable', 'user-invocable'],
  ['model', 'model'],
  ['effort', 'effort'],
  ['context', 'context'],
  ['agent', 'agent'],
  ['background', 'background'],
  ['hidden', 'hidden'],
  ['disallowedTools', 'disallowed-tools'],
  ['maxTurns', 'max-turns'],
  ['memory', 'memory'],
  ['isolation', 'isolation'],
  ['skills', 'skills'],
  ['hooks', 'hooks'],
  ['paths', 'paths'],
  ['shell', 'shell'],
];

export const SPEC_KEYS = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

export const YAML_TO_FIELD = new Map(CLAUDE_CODE_KEYS.map(([f, k]) => [k, f]));
export const FIELD_TO_YAML = new Map(CLAUDE_CODE_KEYS);

/** The description as emitted: negative triggers become a trailing sentence (portable). */
export function compiledDescription(ctx: Ctx, entry: EntryNodeT): string {
  let d = entry.description.trim();
  if (entry.negativeTriggers.length > 0) {
    const list = entry.negativeTriggers.join(', ');
    d = `${d} ${ctx.text(entry, 'description:negative', `Do not use for ${list}.`)}`;
  }
  return d;
}

function allowedToolsValue(
  entry: EntryNodeT,
  profile: Profile,
  derived: string[],
): string | undefined {
  const raw = (entry as { allowedToolsRaw?: string }).allowedToolsRaw;
  const tools = [...entry.allowedTools, ...derived.filter((t) => !entry.allowedTools.includes(t))];
  if (tools.length === 0) return raw;
  if (raw && derived.length === 0) return raw;
  return profile === 'universal' ? tools.join(' ') : tools.join(', ');
}

/** Build the ordered frontmatter object for the given profile. */
export function buildFrontmatter(ctx: Ctx, derivedTools: string[]): Record<string, unknown> {
  const entry = ctx.entry;
  const profile = ctx.profile;
  const values = new Map<string, unknown>();
  values.set('name', entry.name);
  values.set('description', compiledDescription(ctx, entry));
  if (entry.license) values.set('license', entry.license);
  if (entry.compatibility) values.set('compatibility', entry.compatibility);
  if (entry.metadata && Object.keys(entry.metadata).length > 0)
    values.set('metadata', entry.metadata);
  const at = allowedToolsValue(entry, profile, derivedTools);
  if (at) values.set('allowed-tools', at);

  const dropped: string[] = [];
  const cc = (entry.claudeCode ?? {}) as Record<string, unknown>;
  const ccKeys: string[] = [];
  for (const [field, key] of CLAUDE_CODE_KEYS) {
    const v = cc[field];
    if (v === undefined) continue;
    if (profile === 'universal') {
      dropped.push(key);
      continue;
    }
    values.set(key, v);
    ccKeys.push(key);
  }
  for (const [k, v] of Object.entries(cc)) {
    if (FIELD_TO_YAML.has(k) || v === undefined) continue;
    if (profile === 'universal') {
      dropped.push(k);
      continue;
    }
    values.set(k, v);
    ccKeys.push(k);
  }
  if (dropped.length > 0) {
    ctx.diag(
      'profile/dropped-fields',
      'warning',
      `Universal profile dropped non-spec frontmatter: ${dropped.join(', ')}`,
      entry.id,
    );
  }

  // Ordering: imported key order first, then spec order, then claude-code fixed order, then extras sorted.
  const orderedKeys: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (values.has(k) && !seen.has(k)) {
      seen.add(k);
      orderedKeys.push(k);
    }
  };
  for (const k of entry.frontmatterOrder ?? []) push(k);
  for (const k of SPEC_KEYS) push(k);
  for (const [, k] of CLAUDE_CODE_KEYS) push(k);
  for (const k of [...values.keys()].sort()) push(k);

  const out: Record<string, unknown> = {};
  for (const k of orderedKeys) out[k] = values.get(k);
  return out;
}
