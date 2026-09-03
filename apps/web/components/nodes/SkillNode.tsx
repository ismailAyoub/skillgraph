'use client';

import type { NodeKind } from '@skillgraph/core';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import type { NodeHeat, SkillRFNode } from '@/lib/adapter';
import {
  ATTACH_KINDS_SET,
  FILE_KINDS_SET,
  KIND_META,
  nodeSummary,
  nodeTitle,
} from '@/lib/nodeMeta';

/** Header tint for the heatmap overlay: grey when never visited, green scaled by visit ratio. */
export function heatStyle(heat: NodeHeat): {
  background: string;
  color: string;
  title: string;
  dashed: boolean;
} {
  if (heat.visits === 0 || heat.ratio <= 0) {
    return {
      background: '#d9d1c2',
      color: '#8a8377',
      title: 'Never visited in eval traces',
      dashed: true,
    };
  }
  const alpha = 0.18 + 0.72 * heat.ratio;
  const pct = Math.round(heat.ratio * 100);
  return {
    background: `rgba(47, 138, 76, ${alpha.toFixed(2)})`,
    color: '#2f5d3a',
    title: `Visited in ${heat.visits} of ${heat.runs} run(s) (${pct}%)`,
    dashed: false,
  };
}

function SkillNodeComponent({ data, selected }: NodeProps<SkillRFNode>) {
  const { node, issues, severity, heat } = data;
  const meta = KIND_META[node.kind as NodeKind] ?? {
    label: node.kind,
    short: node.kind,
    color: '#888',
    bg: '#eee',
  };
  const isFile = FILE_KINDS_SET.has(node.kind);
  const isAttach = ATTACH_KINDS_SET.has(node.kind);
  const isEntry = node.kind === 'entry';
  const summary = nodeSummary(node);
  const hs = heat ? heatStyle(heat) : null;
  return (
    <div
      className={`sg-node ${selected ? 'selected' : ''} ${hs?.dashed ? 'sg-node-cold' : ''}`}
      style={isEntry ? { borderColor: selected ? undefined : '#1f1d1a' } : undefined}
      title={hs?.title}
    >
      {!isEntry && !isFile && (
        <Handle
          id="in"
          type="target"
          position={Position.Top}
          style={{ background: '#8a8377', width: 8, height: 8 }}
        />
      )}
      {isFile && (
        <Handle
          id="side-in"
          type="target"
          position={Position.Left}
          style={{ background: '#3f5f8a', width: 8, height: 8 }}
        />
      )}
      {!isEntry && !isFile && !isAttach && (
        <Handle
          id="side-in"
          type="target"
          position={Position.Left}
          style={{ background: '#b04a3a', width: 6, height: 6, top: '70%' }}
        />
      )}
      <div className="sg-node-head" style={hs ? { color: hs.color } : undefined}>
        <span className="sg-node-dot" style={{ background: hs ? hs.background : meta.color }} />
        <span>{meta.short}</span>
        {hs && (
          <span className="normal-case tracking-normal opacity-90">
            {heat && heat.visits > 0 ? `${Math.round(heat.ratio * 100)}%` : 'never visited'}
          </span>
        )}
        {issues > 0 && (
          <span
            className={`ml-auto rounded-full px-1.5 text-[10px] tracking-normal ${severity === 'error' ? 'bg-[var(--err)] text-white' : severity === 'warning' ? 'bg-[var(--warn)] text-white' : 'bg-[var(--line-strong)] text-[var(--ink)]'}`}
          >
            {issues}
          </span>
        )}
      </div>
      <div className="sg-node-body">
        <div className={isEntry ? 'font-serif text-[15px] font-medium' : 'font-medium'}>
          {nodeTitle(node)}
        </div>
        {summary && (
          <div className="mt-0.5 line-clamp-3 text-[11px] leading-[1.45] text-[var(--muted)]">
            {summary}
          </div>
        )}
      </div>
      {!isFile && (
        <Handle
          id="out"
          type="source"
          position={Position.Bottom}
          style={{
            background: node.kind === 'decision' ? '#a8722a' : '#8a8377',
            width: 8,
            height: 8,
          }}
        />
      )}
      {!isFile && (
        <Handle
          id="side-out"
          type="source"
          position={Position.Right}
          style={{ background: isAttach ? '#b04a3a' : '#3f5f8a', width: 8, height: 8 }}
        />
      )}
    </div>
  );
}

export const SkillNode = memo(SkillNodeComponent);

function GroupNodeComponent({ data, selected }: NodeProps<SkillRFNode>) {
  const { node, issues, severity, heat } = data;
  const meta = KIND_META[node.kind as NodeKind];
  const title =
    node.kind === 'loop'
      ? `Repeat until ${(node as { until: string }).until || '…'}`
      : nodeTitle(node);
  const hs = heat ? heatStyle(heat) : null;
  return (
    <div
      className={`sg-group h-full w-full ${selected ? 'selected' : ''}`}
      style={{
        borderColor: selected ? undefined : hs ? (hs.dashed ? '#c8c8c4' : '#2f8a4c') : undefined,
      }}
      title={hs?.title}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        style={{ background: '#8a8377', width: 8, height: 8 }}
      />
      <Handle
        id="side-in"
        type="target"
        position={Position.Left}
        style={{ background: '#b04a3a', width: 6, height: 6 }}
      />
      <div className="sg-group-title" style={{ color: meta.color }}>
        {meta.short}: {title}
        {issues > 0 && (
          <span
            className={`ml-2 rounded-full px-1.5 tracking-normal ${severity === 'error' ? 'bg-[var(--err)] text-white' : 'bg-[var(--warn)] text-white'}`}
          >
            {issues}
          </span>
        )}
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        style={{ background: '#8a8377', width: 8, height: 8 }}
      />
      <Handle
        id="side-out"
        type="source"
        position={Position.Right}
        style={{ background: '#3f5f8a', width: 8, height: 8 }}
      />
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
