import type { Layout, SkillDoc, SkillNode } from '@skillgraph/core';

/**
 * Carry layout positions over to a re-imported graph. For each new node, reuse the box of the
 * old node with the same id, else the same slug, else the same kind + title. Nodes that match
 * nothing are left unplaced (auto-layout fills them in).
 */
export function preserveLayout(oldDoc: SkillDoc, oldLayout: Layout, newDoc: SkillDoc): Layout {
  const byId = new Map<string, SkillNode>();
  const bySlug = new Map<string, SkillNode>();
  const byKindTitle = new Map<string, SkillNode>();
  for (const n of oldDoc.nodes) {
    byId.set(n.id, n);
    if (n.slug && !bySlug.has(n.slug)) bySlug.set(n.slug, n);
    const kt = `${n.kind} ${n.title ?? ''}`;
    if (n.title && !byKindTitle.has(kt)) byKindTitle.set(kt, n);
  }
  const used = new Set<string>();
  const nodes: Layout['nodes'] = {};
  for (const n of newDoc.nodes) {
    const candidates = [
      byId.get(n.id),
      n.slug ? bySlug.get(n.slug) : undefined,
      n.title ? byKindTitle.get(`${n.kind} ${n.title}`) : undefined,
    ];
    const match = candidates.find((c) => c && !used.has(c.id) && oldLayout.nodes[c.id]);
    const box = match ? oldLayout.nodes[match.id] : undefined;
    if (!match || !box) continue;
    used.add(match.id);
    nodes[n.id] = { ...box };
  }
  return { nodes, viewport: oldLayout.viewport };
}
