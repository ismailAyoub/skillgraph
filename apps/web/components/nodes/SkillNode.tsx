'use client';

import type { NodeKind } from '@skillgraph/core';
import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import type { SkillRFNode } from '@/lib/adapter';
import {
  ATTACH_KINDS_SET,
  FILE_KINDS_SET,
  KIND_META,
  nodeSummary,
  nodeTitle,
} from '@/lib/nodeMeta';

function SkillNodeComponent({ data, selected }: NodeProps<SkillRFNode>) {
  const { node, issues, severity } = data;
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
  return (
    <div
      className={`sg-node ${selected ? 'selected' : ''}`}
      style={{ borderLeft: `4px solid ${meta.color}` }}
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
      <div className="sg-node-head" style={{ background: meta.bg, color: meta.color }}>
        <span>{meta.short}</span>
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
  const { node, issues, severity } = data;
  const meta = KIND_META[node.kind as NodeKind];
  const title =
    node.kind === 'loop'
      ? `Repeat until ${(node as { until: string }).until || '…'}`
      : nodeTitle(node);
  return (
    <div
      className={`sg-group h-full w-full ${selected ? 'selected' : ''}`}
      style={{ borderColor: selected ? undefined : meta.color }}
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
