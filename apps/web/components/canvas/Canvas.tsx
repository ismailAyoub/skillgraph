'use client';

import type { NodeKind } from '@skillgraph/core';
import {
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnect,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { GroupNode, SkillNode } from '@/components/nodes/SkillNode';
import {
  absolutePosition,
  containerAt,
  type SkillRFEdge,
  type SkillRFNode,
  toFlow,
} from '@/lib/adapter';
import { CONTAINER_KINDS_SET } from '@/lib/nodeMeta';
import { useEditor } from '@/lib/store';

const nodeTypes = { skill: SkillNode, group: GroupNode };

function CanvasInner() {
  const file = useEditor((s) => s.file);
  const selectedId = useEditor((s) => s.selectedId);
  const lintResult = useEditor((s) => s.lintResult);
  const select = useEditor((s) => s.select);
  const setLayout = useEditor((s) => s.setLayout);
  const setViewport = useEditor((s) => s.setViewport);
  const connect = useEditor((s) => s.connect);
  const removeNode = useEditor((s) => s.removeNode);
  const removeEdge = useEditor((s) => s.removeEdge);
  const reparent = useEditor((s) => s.reparent);
  const reorderSiblings = useEditor((s) => s.reorderSiblings);
  const addNode = useEditor((s) => s.addNode);
  const rf = useReactFlow();
  const dragStart = useRef<Map<string, { x: number; y: number }>>(new Map());

  const issuesByNode = useMemo(() => {
    const m = new Map<string, { count: number; severity: 'error' | 'warning' | 'info' }>();
    const rank = { error: 3, warning: 2, info: 1 } as const;
    for (const d of lintResult?.diagnostics ?? []) {
      if (!d.nodeId) continue;
      const cur = m.get(d.nodeId);
      if (!cur) m.set(d.nodeId, { count: 1, severity: d.severity });
      else
        m.set(d.nodeId, {
          count: cur.count + 1,
          severity: rank[d.severity] > rank[cur.severity] ? d.severity : cur.severity,
        });
    }
    return m;
  }, [lintResult]);

  const heatmap = useEditor((s) => s.heatmap);
  const showHeatmap = useEditor((s) => s.showHeatmap);

  const { nodes, edges } = useMemo(() => {
    if (!file) return { nodes: [] as SkillRFNode[], edges: [] as SkillRFEdge[] };
    return toFlow(file.doc, file.layout, selectedId, issuesByNode, showHeatmap ? heatmap : null);
  }, [file, selectedId, issuesByNode, heatmap, showHeatmap]);

  const onNodesChange = useCallback(
    (changes: NodeChange<SkillRFNode>[]) => {
      const boxes: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
      for (const c of changes) {
        if (c.type === 'position' && c.position && c.dragging !== undefined) {
          boxes[c.id] = { ...boxes[c.id], x: c.position.x, y: c.position.y } as {
            x: number;
            y: number;
          };
        } else if (c.type === 'dimensions' && c.dimensions) {
          const node = file?.doc.nodes.find((n) => n.id === c.id);
          if (node && !CONTAINER_KINDS_SET.has(node.kind)) {
            const prev = file?.layout.nodes[c.id];
            if (prev?.h !== c.dimensions.height || prev?.w !== c.dimensions.width) {
              boxes[c.id] = {
                ...(boxes[c.id] ?? { x: prev?.x ?? 0, y: prev?.y ?? 0 }),
                w: c.dimensions.width,
                h: c.dimensions.height,
              };
            }
          }
        } else if (c.type === 'select') {
          if (c.selected) select(c.id);
          else if (selectedId === c.id) select(null);
        } else if (c.type === 'remove') {
          removeNode(c.id);
        }
      }
      if (Object.keys(boxes).length) {
        const withPositions: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
        for (const [id, b] of Object.entries(boxes)) {
          const prev = file?.layout.nodes[id] ?? { x: 0, y: 0 };
          withPositions[id] = {
            x: b.x ?? prev.x,
            y: b.y ?? prev.y,
            w: b.w ?? prev.w,
            h: b.h ?? prev.h,
          };
        }
        setLayout(withPositions);
      }
    },
    [file, select, selectedId, setLayout, removeNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<SkillRFEdge>[]) => {
      for (const c of changes) if (c.type === 'remove') removeEdge(c.id);
    },
    [removeEdge],
  );

  const onConnect: OnConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target) connect(c.source, c.target);
    },
    [connect],
  );

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    dragStart.current.set(node.id, { ...node.position });
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (!file) return;
      const skill = file.doc.nodes.find((n) => n.id === node.id);
      if (!skill || skill.kind === 'entry') return;
      const parentAbs = skill.parentId
        ? absolutePosition(skill.parentId, file.doc, file.layout)
        : { x: 0, y: 0 };
      const abs = { x: parentAbs.x + node.position.x, y: parentAbs.y + node.position.y };
      const center = { x: abs.x + (node.measured?.width ?? 200) / 2, y: abs.y + 20 };
      const target = containerAt(center, file.doc, file.layout, node.id);
      const currentParent = skill.parentId ?? null;
      if (
        target !== currentParent &&
        !CONTAINER_KINDS_SET.has(skill.kind) &&
        skill.kind !== 'reference' &&
        skill.kind !== 'script' &&
        skill.kind !== 'asset'
      ) {
        const targetAbs = target ? absolutePosition(target, file.doc, file.layout) : { x: 0, y: 0 };
        reparent(node.id, target, { x: abs.x - targetAbs.x, y: abs.y - targetAbs.y });
        return;
      }
      if (CONTAINER_KINDS_SET.has(skill.kind) && target !== currentParent) {
        const targetAbs = target ? absolutePosition(target, file.doc, file.layout) : { x: 0, y: 0 };
        reparent(node.id, target, { x: abs.x - targetAbs.x, y: abs.y - targetAbs.y });
        return;
      }
      reorderSiblings(currentParent);
    },
    [file, reparent, reorderSiblings],
  );

  const onDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault();
      const kind = ev.dataTransfer.getData('application/skillgraph-kind') as NodeKind;
      if (!kind || !file) return;
      const point = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const target = containerAt(point, file.doc, file.layout, '');
      const isFile = kind === 'reference' || kind === 'script' || kind === 'asset';
      const parentId = isFile ? null : target;
      const parentAbs = parentId
        ? absolutePosition(parentId, file.doc, file.layout)
        : { x: 0, y: 0 };
      addNode(kind, { parentId, position: { x: point.x - parentAbs.x, y: point.y - parentAbs.y } });
      if (parentId) setTimeout(() => reorderSiblings(parentId), 0);
    },
    [file, rf, addNode, reorderSiblings],
  );

  const fitRequest = useEditor((s) => s.fitRequest);
  useEffect(() => {
    if (fitRequest === 0) return;
    const t = setTimeout(() => rf.fitView({ padding: 0.15, maxZoom: 1, duration: 250 }), 50);
    return () => clearTimeout(t);
  }, [fitRequest, rf]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => select(null)}
      onMoveEnd={(_, vp) => setViewport(vp)}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      deleteKeyCode={['Backspace', 'Delete']}
      fitView
      minZoom={0.2}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
      selectNodesOnDrag={false}
    >
      <Background gap={22} size={1} color="#d9d1c2" />
      <Controls position="bottom-left" />
    </ReactFlow>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
