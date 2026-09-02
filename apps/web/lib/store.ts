'use client';

import {
  applyPatch,
  type CompileResult,
  compile,
  type GraphPatchT,
  type LintResult,
  lint,
  type NodeKind,
  newId,
  type Profile,
  type SkillDoc,
  type SkillFile,
  type SkillNode,
} from '@skillgraph/core';
import { create } from 'zustand';
import { type BridgeOrigin, bridgeOpen, bridgeSave, bridgeTraces, type HeatCell } from './bridge';
import { saveCloudSkill } from './cloud';
import { getSkillEntry, loadSkill, saveSkill, setSkillCloudId, setSkillOrigin } from './db';
import { autoLayout, type Box } from './layout';
import { preserveLayout } from './layoutPreserve';
import { ATTACH_KINDS_SET, CONTAINER_KINDS_SET, defaultNodeData, FILE_KINDS_SET } from './nodeMeta';

interface HistoryEntry {
  inverse: GraphPatchT;
  key?: string;
  at: number;
}

export interface EditorState {
  skillId: string | null;
  file: SkillFile | null;
  compiled: CompileResult | null;
  lintResult: LintResult | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selectedId: string | null;
  saving: boolean;
  layoutPending: boolean;
  /** Incremented after an auto-layout so the canvas refits the viewport. */
  fitRequest: number;
  error: string | null;
  /** Set when the skill is linked to a folder through the local bridge. */
  origin: BridgeOrigin | null;
  /** Cloud row id when the skill is synced to the signed-in account. */
  cloudId: string | null;
  cloudStatus: 'idle' | 'saving' | 'saved' | 'error';
  cloudMessage: string | null;
  bridgeStatus: 'idle' | 'saving' | 'saved' | 'drift' | 'error';
  bridgeMessage: string | null;
  /** Per-node visit ratios from eval traces (bridge only); null until loaded. */
  heatmap: Record<string, HeatCell> | null;
  showHeatmap: boolean;

  load(id: string): Promise<void>;
  setFile(id: string, file: SkillFile): void;
  dispatch(patch: GraphPatchT, opts?: { coalesceKey?: string }): void;
  update(id: string, data: Record<string, unknown>, coalesceKey?: string): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  setLayout(boxes: Record<string, Box>): void;
  setViewport(v: { x: number; y: number; zoom: number }): void;
  setProfile(p: Profile): void;
  addNode(
    kind: NodeKind,
    opts?: { parentId?: string | null; position?: { x: number; y: number }; after?: string },
  ): string;
  connect(sourceId: string, targetId: string): void;
  removeNode(id: string): void;
  removeEdge(id: string): void;
  relayout(): Promise<void>;
  reparent(id: string, parentId: string | null, position: { x: number; y: number }): void;
  reorderSiblings(parentId: string | null): void;
  /** Write the compiled skill back to its folder through the bridge. Returns drifted files on conflict. */
  saveToBridge(force?: boolean): Promise<{ ok: boolean; drifted?: string[] }>;
  unlinkBridge(): Promise<void>;
  /** Create the cloud row for this skill (signed-in users); later edits sync automatically. */
  saveToCloud(): Promise<void>;
  unlinkCloud(): Promise<void>;
  /** Re-read the skill from its folder, keeping layout positions for nodes that still exist. */
  reimportFromBridge(): Promise<void>;
  /** Fetch eval traces through the bridge (no-op without a bridge origin). */
  loadHeatmap(): Promise<void>;
  setShowHeatmap(v: boolean): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function recompute(doc: SkillDoc): { compiled: CompileResult; lintResult: LintResult } {
  const compiled = compile(doc);
  const lintResult = lint(doc, { compiled });
  return { compiled, lintResult };
}

function nextOrder(doc: SkillDoc, parentId: string | null): number {
  let max = 0;
  for (const n of doc.nodes) if ((n.parentId ?? null) === parentId && n.order > max) max = n.order;
  return max + 1;
}

export const useEditor = create<EditorState>((set, get) => ({
  skillId: null,
  file: null,
  compiled: null,
  lintResult: null,
  past: [],
  future: [],
  selectedId: null,
  saving: false,
  layoutPending: false,
  fitRequest: 0,
  error: null,
  origin: null,
  cloudId: null,
  cloudStatus: 'idle',
  cloudMessage: null,
  bridgeStatus: 'idle',
  bridgeMessage: null,
  heatmap: null,
  showHeatmap: false,

  async load(id) {
    const file = await loadSkill(id);
    if (!file) {
      set({ skillId: id, file: null, error: 'Skill not found' });
      return;
    }
    get().setFile(id, file);
    const entry = await getSkillEntry(id);
    set({
      origin: entry?.origin ?? null,
      cloudId: entry?.cloudId ?? null,
      cloudStatus: 'idle',
      cloudMessage: null,
      bridgeStatus: 'idle',
      bridgeMessage: null,
      heatmap: null,
      showHeatmap: false,
    });
    if (Object.keys(file.layout.nodes).length === 0) await get().relayout();
    if (entry?.origin) void get().loadHeatmap();
  },

  setFile(id, file) {
    set({
      skillId: id,
      file,
      ...recompute(file.doc),
      past: [],
      future: [],
      selectedId: null,
      error: null,
    });
  },

  dispatch(patch, opts) {
    const { file, past } = get();
    if (!file) return;
    const { doc, inverse } = applyPatch(file.doc, patch);
    const now = Date.now();
    const last = past[past.length - 1];
    let nextPast: HistoryEntry[];
    if (opts?.coalesceKey && last && last.key === opts.coalesceKey && now - last.at < 1200) {
      nextPast = [...past.slice(0, -1), { ...last, at: now }];
    } else {
      nextPast = [...past.slice(-200), { inverse, key: opts?.coalesceKey, at: now }];
    }
    const nextFile = { ...file, doc };
    set({ file: nextFile, ...recompute(doc), past: nextPast, future: [] });
    schedulePersist();
  },

  update(id, data, coalesceKey) {
    get().dispatch(
      { ops: [{ op: 'update', id, data }] },
      { coalesceKey: coalesceKey ?? `update:${id}:${Object.keys(data).join(',')}` },
    );
  },

  undo() {
    const { file, past, future } = get();
    const last = past[past.length - 1];
    if (!file || !last) return;
    const { doc, inverse } = applyPatch(file.doc, last.inverse);
    set({
      file: { ...file, doc },
      ...recompute(doc),
      past: past.slice(0, -1),
      future: [...future, { inverse, at: Date.now() }],
    });
    schedulePersist();
  },

  redo() {
    const { file, past, future } = get();
    const next = future[future.length - 1];
    if (!file || !next) return;
    const { doc, inverse } = applyPatch(file.doc, next.inverse);
    set({
      file: { ...file, doc },
      ...recompute(doc),
      future: future.slice(0, -1),
      past: [...past, { inverse, at: Date.now() }],
    });
    schedulePersist();
  },

  select(id) {
    set({ selectedId: id });
  },

  setLayout(boxes) {
    const { file } = get();
    if (!file) return;
    const nodes = { ...file.layout.nodes };
    for (const [id, b] of Object.entries(boxes)) nodes[id] = { ...nodes[id], ...b };
    set({ file: { ...file, layout: { ...file.layout, nodes } } });
    schedulePersist();
  },

  setViewport(viewport) {
    const { file } = get();
    if (!file) return;
    set({ file: { ...file, layout: { ...file.layout, viewport } } });
    schedulePersist();
  },

  setProfile(profile) {
    get().dispatch({ ops: [{ op: 'setProfile', profile }] });
  },

  addNode(kind, opts = {}) {
    const { file } = get();
    if (!file) throw new Error('No skill loaded');
    const id = newId(kind);
    const parentId = opts.parentId ?? null;
    let order = nextOrder(file.doc, parentId);
    const ops: GraphPatchT['ops'] = [];
    if (opts.after) {
      const after = file.doc.nodes.find((n) => n.id === opts.after);
      if (after) {
        order = after.order + 1;
        for (const n of file.doc.nodes) {
          if ((n.parentId ?? null) === (after.parentId ?? null) && n.order > after.order) {
            ops.push({ op: 'move', id: n.id, parentId: n.parentId ?? null, order: n.order + 1 });
          }
        }
      }
    }
    const node = defaultNodeData(kind, id, parentId, order);
    ops.push({ op: 'add', node });
    if (opts.after) {
      const after = file.doc.nodes.find((n) => n.id === opts.after);
      if (
        after &&
        !FILE_KINDS_SET.has(kind) &&
        !ATTACH_KINDS_SET.has(kind) &&
        !FILE_KINDS_SET.has(after.kind)
      ) {
        if (after.kind === 'decision') {
          ops.push({
            op: 'addEdge',
            edge: {
              id: newId('edge'),
              kind: 'branch',
              source: after.id,
              target: id,
              label: 'Case',
            },
          });
        } else {
          // Splice into the chain: after -> new -> (what after pointed to before).
          const outgoing = file.doc.edges.filter((e) => e.kind === 'next' && e.source === after.id);
          if (outgoing.length === 1)
            ops.push({
              op: 'updateEdge',
              id: (outgoing[0] as { id: string }).id,
              data: { source: id },
            });
          ops.push({
            op: 'addEdge',
            edge: { id: newId('edge'), kind: 'next', source: after.id, target: id },
          });
        }
      }
    }
    get().dispatch({ ops });
    if (opts.position) get().setLayout({ [id]: { x: opts.position.x, y: opts.position.y } });
    set({ selectedId: id });
    return id;
  },

  connect(sourceId, targetId) {
    const { file } = get();
    if (!file || sourceId === targetId) return;
    const source = file.doc.nodes.find((n) => n.id === sourceId);
    const target = file.doc.nodes.find((n) => n.id === targetId);
    if (!source || !target) return;
    let kind: 'next' | 'branch' | 'reads' | 'runs' | 'attaches';
    if (FILE_KINDS_SET.has(target.kind)) kind = target.kind === 'script' ? 'runs' : 'reads';
    else if (ATTACH_KINDS_SET.has(source.kind)) kind = 'attaches';
    else if (source.kind === 'decision') kind = 'branch';
    else kind = 'next';
    if (
      file.doc.edges.some((e) => e.source === sourceId && e.target === targetId && e.kind === kind)
    )
      return;
    const edge = {
      id: newId('edge'),
      kind,
      source: sourceId,
      target: targetId,
      label: kind === 'branch' ? 'Case' : undefined,
    };
    get().dispatch({ ops: [{ op: 'addEdge', edge }] });
  },

  removeNode(id) {
    const { file } = get();
    if (!file) return;
    const node = file.doc.nodes.find((n) => n.id === id);
    if (!node || node.kind === 'entry') return;
    const ops: GraphPatchT['ops'] = [];
    // Remove descendants first (containers), deepest first.
    const descendants: SkillNode[] = [];
    const collect = (pid: string) => {
      for (const n of file.doc.nodes) {
        if (n.parentId === pid) {
          collect(n.id);
          descendants.push(n);
        }
      }
    };
    collect(id);
    for (const d of descendants) ops.push({ op: 'remove', id: d.id });
    ops.push({ op: 'remove', id });
    get().dispatch({ ops });
    set({ selectedId: null });
  },

  removeEdge(id) {
    get().dispatch({ ops: [{ op: 'removeEdge', id }] });
  },

  async relayout() {
    const { file } = get();
    if (!file) return;
    set({ layoutPending: true });
    try {
      const boxes = await autoLayout(file.doc, file.layout.nodes);
      const current = get().file;
      if (!current) return;
      set({
        file: { ...current, layout: { ...current.layout, nodes: boxes } },
        layoutPending: false,
        fitRequest: get().fitRequest + 1,
      });
      schedulePersist();
    } catch (e) {
      set({ layoutPending: false, error: (e as Error).message });
    }
  },

  reparent(id, parentId, position) {
    const { file } = get();
    if (!file) return;
    const node = file.doc.nodes.find((n) => n.id === id);
    if (!node) return;
    if (
      parentId &&
      !CONTAINER_KINDS_SET.has(file.doc.nodes.find((n) => n.id === parentId)?.kind ?? '')
    )
      return;
    if ((node.parentId ?? null) !== parentId) {
      get().dispatch({ ops: [{ op: 'move', id, parentId, order: nextOrder(file.doc, parentId) }] });
    }
    get().setLayout({ [id]: { x: position.x, y: position.y } });
    get().reorderSiblings(parentId);
  },

  async saveToBridge(force = false) {
    const { file, origin, skillId } = get();
    if (!file || !origin || !skillId) return { ok: false };
    set({ bridgeStatus: 'saving', bridgeMessage: null });
    try {
      const res = await bridgeSave(origin.url, origin.name, file, origin.diskHashes, force);
      const nextOrigin = { ...origin, diskHashes: res.diskHashes };
      await setSkillOrigin(skillId, nextOrigin);
      set({
        origin: nextOrigin,
        bridgeStatus: 'saved',
        bridgeMessage: `Wrote ${res.written.length} file(s) to ${origin.name}/`,
      });
      return { ok: true };
    } catch (e) {
      const err = e as Error & { status?: number; drifted?: string[] };
      if (err.status === 409 && err.drifted) {
        set({
          bridgeStatus: 'drift',
          bridgeMessage: `Changed on disk since you opened it: ${err.drifted.join(', ')}`,
        });
        return { ok: false, drifted: err.drifted };
      }
      set({ bridgeStatus: 'error', bridgeMessage: err.message });
      return { ok: false };
    }
  },

  async saveToCloud() {
    const { file, skillId, cloudId } = get();
    if (!file || !skillId) return;
    set({ cloudStatus: 'saving', cloudMessage: null });
    try {
      const id = await saveCloudSkill(file, cloudId ?? undefined);
      await setSkillCloudId(skillId, id);
      set({ cloudId: id, cloudStatus: 'saved', cloudMessage: null });
    } catch (e) {
      set({ cloudStatus: 'error', cloudMessage: (e as Error).message });
    }
  },

  async unlinkCloud() {
    const { skillId } = get();
    if (!skillId) return;
    await setSkillCloudId(skillId, undefined);
    set({ cloudId: null, cloudStatus: 'idle', cloudMessage: null });
  },

  async unlinkBridge() {
    const { skillId } = get();
    if (!skillId) return;
    await setSkillOrigin(skillId, undefined);
    set({
      origin: null,
      bridgeStatus: 'idle',
      bridgeMessage: null,
      heatmap: null,
      showHeatmap: false,
    });
  },

  async reimportFromBridge() {
    const { file, origin, skillId } = get();
    if (!file || !origin || !skillId) return;
    set({ bridgeStatus: 'saving', bridgeMessage: null });
    try {
      const res = await bridgeOpen(origin.url, origin.name);
      const layout = preserveLayout(file.doc, file.layout, res.graph.doc);
      const fresh: SkillFile = { ...res.graph, layout };
      get().setFile(skillId, fresh);
      const nextOrigin = { ...origin, diskHashes: res.diskHashes };
      await saveSkill(skillId, fresh, nextOrigin);
      set({
        origin: nextOrigin,
        bridgeStatus: 'saved',
        bridgeMessage: `Re-imported ${origin.name}/ from disk`,
      });
      if (fresh.doc.nodes.some((n) => !layout.nodes[n.id])) await get().relayout();
    } catch (e) {
      set({ bridgeStatus: 'error', bridgeMessage: (e as Error).message });
    }
  },

  async loadHeatmap() {
    const { origin } = get();
    if (!origin) {
      set({ heatmap: null });
      return;
    }
    try {
      const res = await bridgeTraces(origin.url, origin.name);
      const heatmap = res.heatmap ?? {};
      set({ heatmap: Object.keys(heatmap).length ? heatmap : null });
    } catch {
      set({ heatmap: null });
    }
  },

  setShowHeatmap(v) {
    set({ showHeatmap: v });
  },

  reorderSiblings(parentId) {
    const { file } = get();
    if (!file) return;
    const siblings = file.doc.nodes
      .filter(
        (n) =>
          (n.parentId ?? null) === parentId && n.kind !== 'entry' && !FILE_KINDS_SET.has(n.kind),
      )
      .map((n) => ({ n, y: file.layout.nodes[n.id]?.y ?? 0, x: file.layout.nodes[n.id]?.x ?? 0 }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const ops: GraphPatchT['ops'] = [];
    siblings.forEach(({ n }, i) => {
      if (n.order !== i + 1) ops.push({ op: 'move', id: n.id, parentId, order: i + 1 });
    });
    if (ops.length) get().dispatch({ ops }, { coalesceKey: `reorder:${parentId}` });
  },
}));

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { skillId, file } = useEditor.getState();
    if (!skillId || !file) return;
    useEditor.setState({ saving: true });
    await saveSkill(skillId, file);
    useEditor.setState({ saving: false });
    if (useEditor.getState().cloudId) scheduleCloudSave();
  }, 400);
}

let cloudTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced push of the current file to the cloud row (only when the skill is linked). */
function scheduleCloudSave() {
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(async () => {
    const { file, cloudId } = useEditor.getState();
    if (!file || !cloudId) return;
    useEditor.setState({ cloudStatus: 'saving' });
    try {
      await saveCloudSkill(file, cloudId);
      useEditor.setState({ cloudStatus: 'saved', cloudMessage: null });
    } catch (e) {
      useEditor.setState({ cloudStatus: 'error', cloudMessage: (e as Error).message });
    }
  }, 1500);
}
