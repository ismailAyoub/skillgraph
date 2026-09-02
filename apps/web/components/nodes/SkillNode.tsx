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
      background: '#ececea',
      color: '#8a8a90',
      title: 'Never visited in eval traces',
      dashed: true,
    };
  }
  const alpha = 0.18 + 0.72 * heat.ratio;
  const pct = Math.round(heat.ratio * 100);
  return {
    background: `rgba(31, 138, 76, ${alpha.toFixed(2)})`,
    color: heat.ratio > 0.5 ? '#ffffff' : '#145c33',
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
      style={{ borderLeft: `4px solid ${hs ? (hs.dashed ? '#c8c8c4' : '#1f8a4c') : meta.color}` }}
      title={hs?.title}
    >
      {!isEntry && !isFile && (
        <Handle
          id="in"
          type="target"
          position={Position.Top}
          style={{ background: '#495057', width: 8, height: 8 }}
        />
      )}
      {isFile && (
        <Handle
          id="side-in"
          type="target"
          position={Position.Left}
          style={{ background: '#1c7ed6', width: 8, height: 8 }}
        />
      )}
      {!isEntry && !isFile && !isAttach && (
        <Handle
          id="side-in"
          type="target"
          position={Position.Left}
          style={{ background: '#c53030', width: 6, height: 6, top: '70%' }}
        />
      )}
      <div
        className="sg-node-head"
        style={
          hs
            ? { background: hs.background, color: hs.color }
            : { background: meta.bg, color: meta.color }
        }
      >
        <span>{meta.short}</span>
        {hs && (
          <span className="normal-case tracking-normal opacity-90">
            {heat && heat.visits > 0 ? `${Math.round(heat.ratio * 100)}%` : 'never visited'}
          </span>
        )}
        {issues > 0 && (
          <span
            className={`ml-auto rounded-full px-1.5 text-[10px] ${severity === 'error' ? 'bg-red-600 text-white' : severity === 'warning' ? 'bg-amber-500 text-white' : 'bg-neutral-300 text-neutral-800'}`}
          >
            {issues}
          </span>
        )}
      </div>
      <div className="sg-node-body">
        <div className="font-semibold">{nodeTitle(node)}</div>
        {summary && (
          <div className="mt-0.5 line-clamp-3 text-[11px] text-[var(--muted)]">{summary}</div>
        )}
      </div>
      {!isFile && (
        <Handle
          id="out"
          type="source"
          position={Position.Bottom}
          style={{
            background: node.kind === 'decision' ? '#b7791f' : '#495057',
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
          style={{ background: isAttach ? '#c53030' : '#1c7ed6', width: 8, height: 8 }}
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
        borderColor: selected ? undefined : hs ? (hs.dashed ? '#c8c8c4' : '#1f8a4c') : meta.color,
      }}
      title={hs?.title}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Top}
        style={{ background: '#495057', width: 8, height: 8 }}
      />
      <Handle
        id="side-in"
        type="target"
        position={Position.Left}
        style={{ background: '#c53030', width: 6, height: 6 }}
      />
      <div className="sg-group-title" style={{ color: meta.color }}>
        {meta.short}: {title}
        {issues > 0 && (
          <span
            className={`ml-2 rounded-full px-1.5 ${severity === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-white'}`}
          >
            {issues}
          </span>
        )}
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Bottom}
        style={{ background: '#495057', width: 8, height: 8 }}
      />
      <Handle
        id="side-out"
        type="source"
        position={Position.Right}
        style={{ background: '#1c7ed6', width: 8, height: 8 }}
      />
    </div>
  );
}

export const GroupNode = memo(GroupNodeComponent);
