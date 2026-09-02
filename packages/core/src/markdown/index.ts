import type { PhrasingContent, Root, RootContent } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify, { type Options as StringifyOptions } from 'remark-stringify';
import { unified } from 'unified';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** Frozen serialization options: the single source of "what normalized markdown looks like". */
export const STRINGIFY_OPTIONS: StringifyOptions = {
  bullet: '-',
  bulletOther: '*',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fences: true,
  incrementListMarker: true,
  listItemIndent: 'one',
  rule: '-',
  ruleSpaces: false,
  setext: false,
  tightDefinitions: true,
};

const parser = unified().use(remarkParse).use(remarkFrontmatter, ['yaml']).use(remarkGfm);
const printer = unified()
  .use(remarkStringify, STRINGIFY_OPTIONS)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm);

/** Parse markdown (with optional YAML frontmatter) into an mdast root. */
export function parseMarkdown(text: string): Root {
  return parser.parse(text) as Root;
}

/** Serialize an mdast root with the frozen options; LF endings, single trailing newline. */
export function stringifyMarkdown(root: Root): string {
  const out = printer.stringify(root as Root);
  return normalizeTrailing(out.replace(/\r\n/g, '\n'));
}

function normalizeTrailing(text: string): string {
  return `${text.replace(/\s+$/g, '')}\n`;
}

/** Parse a markdown fragment into block nodes (no frontmatter handling). */
export function mdBlocks(text: string): RootContent[] {
  if (!text?.trim()) return [];
  const root = parseMarkdown(text);
  return root.children.filter((c) => c.type !== 'yaml');
}

/** Parse a one-line markdown fragment into phrasing content (inline nodes). */
export function mdInline(text: string): PhrasingContent[] {
  const blocks = mdBlocks(text);
  const first = blocks[0];
  if (!first) return [];
  if (first.type === 'paragraph') return first.children;
  return [{ type: 'text', value: text }];
}

/** Serialize block nodes to a markdown fragment (no trailing newline). */
export function blocksToMarkdown(blocks: RootContent[]): string {
  if (blocks.length === 0) return '';
  const root: Root = { type: 'root', children: blocks };
  return stringifyMarkdown(root).replace(/\n$/, '');
}

/** Serialize phrasing content to a single-line markdown fragment. */
export function inlineToMarkdown(children: PhrasingContent[]): string {
  if (children.length === 0) return '';
  return blocksToMarkdown([{ type: 'paragraph', children }]);
}

export const YAML_OPTIONS = { lineWidth: 0, indent: 2 } as const;

export function toYaml(obj: Record<string, unknown>): string {
  return stringifyYaml(obj, YAML_OPTIONS).replace(/\n$/, '');
}

export function fromYaml(text: string): Record<string, unknown> {
  const v = parseYaml(text);
  if (v === null || v === undefined) return {};
  if (typeof v !== 'object' || Array.isArray(v))
    throw new Error('Frontmatter must be a YAML mapping');
  return v as Record<string, unknown>;
}

/**
 * Canonical form of a markdown document: parse + re-serialize with the frozen options,
 * with frontmatter re-serialized through the same YAML printer the compiler uses.
 * `compile(decompile(md))` is expected to equal `normalizeMd(md)`.
 */
export function normalizeMd(text: string): string {
  const root = parseMarkdown(text);
  for (const child of root.children) {
    if (child.type === 'yaml') {
      child.value = toYaml(fromYaml(child.value));
    }
  }
  return stringifyMarkdown(root);
}

/** Plain text of phrasing content (strips formatting). */
export function plainText(nodes: PhrasingContent[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'inlineCode':
        out += n.value;
        break;
      case 'break':
        out += '\n';
        break;
      default:
        if ('children' in n && Array.isArray(n.children))
          out += plainText(n.children as PhrasingContent[]);
        else if ('value' in n && typeof n.value === 'string') out += n.value;
    }
  }
  return out;
}
