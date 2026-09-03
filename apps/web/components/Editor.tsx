'use client';

import {
  ArrowLeft,
  Copy,
  Flame,
  HardDrive,
  LayoutGrid,
  MessageSquareText,
  Redo2,
  Undo2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CloudControls } from '@/components/CloudControls';
import { Canvas } from '@/components/canvas/Canvas';
import { DriftModal } from '@/components/DriftModal';
import { ExportMenu } from '@/components/ExportMenu';
import { Inspector } from '@/components/inspector/Inspector';
import { Palette } from '@/components/Palette';
import { Preview } from '@/components/preview/Preview';
import { SettingsButton } from '@/components/SettingsDialog';
import { Button, Select } from '@/components/ui';
import { useAiPanel } from '@/lib/aiStore';
import { takeKickoff } from '@/lib/kickoff';
import { useEditor } from '@/lib/store';
import { useUi } from '@/lib/uiStore';

export function Editor({ id }: { id: string }) {
  const load = useEditor((s) => s.load);
  const file = useEditor((s) => s.file);
  const compiled = useEditor((s) => s.compiled);
  const lintResult = useEditor((s) => s.lintResult);
  const error = useEditor((s) => s.error);
  const saving = useEditor((s) => s.saving);
  const layoutPending = useEditor((s) => s.layoutPending);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const relayout = useEditor((s) => s.relayout);
  const setProfile = useEditor((s) => s.setProfile);
  const origin = useEditor((s) => s.origin);
  const bridgeStatus = useEditor((s) => s.bridgeStatus);
  const bridgeMessage = useEditor((s) => s.bridgeMessage);
  const saveToBridge = useEditor((s) => s.saveToBridge);
  const reimportFromBridge = useEditor((s) => s.reimportFromBridge);
  const heatmap = useEditor((s) => s.heatmap);
  const showHeatmap = useEditor((s) => s.showHeatmap);
  const setShowHeatmap = useEditor((s) => s.setShowHeatmap);
  const loadHeatmap = useEditor((s) => s.loadHeatmap);
  const previewTab = useUi((s) => s.previewTab);
  const setPreviewTab = useUi((s) => s.setPreviewTab);
  const [drifted, setDrifted] = useState<string[] | null>(null);

  const onSaveToDisk = async () => {
    const res = await saveToBridge(false);
    if (!res.ok && res.drifted) setDrifted(res.drifted);
  };

  const onReimport = async () => {
    await reimportFromBridge();
    setDrifted(null);
    void loadHeatmap();
  };

  const onOverwrite = async () => {
    await saveToBridge(true);
    setDrifted(null);
  };

  useEffect(() => {
    void load(id);
    // AI proposals belong to one skill; never carry them over to the next one. Guarded by the
    // skill id so a double-invoked effect (React strict mode) cannot wipe a queued kickoff.
    const ai = useAiPanel.getState();
    const kickoff = takeKickoff(id);
    if (kickoff) {
      // Arriving from the dashboard chat: continue that conversation in the AI panel.
      ai.reset();
      ai.set('forSkill', id);
      ai.set('interviewTurns', kickoff.turns);
      ai.set('interviewStep', kickoff.step);
      ai.setMode('interview');
      useUi.getState().setPreviewTab('ai');
    } else if (ai.forSkill !== id) {
      ai.reset();
      ai.set('forSkill', id);
      useUi.getState().setPreviewTab('rendered');
    }
    // Debug/test hook: lets e2e tests and the console drive the store.
    (window as unknown as { __skillgraph?: typeof useEditor }).__skillgraph = useEditor;
  }, [id, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('.cm-editor'));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (error) return <div className="p-6 text-sm text-[var(--err)]">{error}</div>;
  if (!file || !compiled) return <div className="p-6 text-sm text-[var(--muted)]">Loading…</div>;
  const entry = file.doc.nodes.find((n) => n.kind === 'entry') as { name: string };
  const { lines, tokens, budget } = compiled.report;
  const lineTone = lines > budget.lines ? 'err' : lines > budget.lines * 0.8 ? 'warn' : 'ok';

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 items-center gap-3 border-b border-[var(--line)] bg-[var(--panel)] px-4">
        <Link
          href="/app"
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={14} /> Skills
        </Link>
        <span className="h-5 w-px bg-[var(--line)]" />
        <span className="font-serif text-[19px] font-medium tracking-[-0.01em]">{entry.name}</span>
        <span className="font-mono text-[11.5px] text-[var(--faint)]">
          <span
            className={
              lineTone === 'err'
                ? 'text-[var(--err)]'
                : lineTone === 'warn'
                  ? 'text-[var(--warn)]'
                  : ''
            }
          >
            {lines} lines
          </span>
          {' · '}
          <span className={tokens > budget.tokens ? 'text-[var(--warn)]' : ''}>
            ~{tokens} tokens
          </span>
          {lintResult && lintResult.errors > 0 && (
            <span className="text-[var(--err)]">
              {' · '}
              {lintResult.errors} {lintResult.errors === 1 ? 'error' : 'errors'}
            </span>
          )}
          {lintResult && lintResult.warnings > 0 && (
            <span className="text-[var(--warn)]">
              {' · '}
              {lintResult.warnings} {lintResult.warnings === 1 ? 'warning' : 'warnings'}
            </span>
          )}
        </span>
        <span className="ml-auto text-[11.5px] text-[var(--faint)]">
          {saving ? 'Saving…' : 'Saved'}
        </span>
        {origin && (
          <Button
            onClick={() => void onSaveToDisk()}
            disabled={bridgeStatus === 'saving'}
            title={`Write to ${origin.name}/ through the local bridge`}
          >
            <HardDrive size={14} /> {bridgeStatus === 'saving' ? 'Writing…' : 'Save to disk'}
          </Button>
        )}
        {bridgeMessage && (
          <span
            className={`text-[11px] ${bridgeStatus === 'error' || bridgeStatus === 'drift' ? 'text-[var(--err)]' : 'text-[var(--muted)]'}`}
          >
            {bridgeMessage}
          </span>
        )}
        <Select
          value={file.doc.profile}
          onChange={(e) => setProfile(e.target.value as 'universal' | 'claude-code')}
          style={{ width: 130 }}
        >
          <option value="claude-code">Claude Code</option>
          <option value="universal">Universal</option>
        </Select>
        <Button onClick={undo} disabled={past === 0} title="Undo (⌘Z)">
          <Undo2 size={14} />
        </Button>
        <Button onClick={redo} disabled={future === 0} title="Redo (⇧⌘Z)">
          <Redo2 size={14} />
        </Button>
        <Button onClick={() => void relayout()} disabled={layoutPending} title="Auto-layout">
          <LayoutGrid size={14} /> Layout
        </Button>
        <Button
          onClick={() => setShowHeatmap(!showHeatmap)}
          disabled={!heatmap}
          aria-pressed={showHeatmap}
          className={showHeatmap ? 'border-[var(--accent)] text-[var(--accent)]' : ''}
          title={
            heatmap
              ? 'Tint nodes by how often eval traces visited them'
              : 'Run `skillgraph eval run --trace` to collect traces'
          }
        >
          <Flame size={14} /> Heatmap
        </Button>
        <Button
          onClick={() => {
            useAiPanel.getState().setMode('interview');
            setPreviewTab('ai');
          }}
          aria-pressed={previewTab === 'ai'}
          aria-label="Open AI chat"
          className={
            previewTab === 'ai'
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : ''
          }
          title="Chat with Claude about this skill (opens the AI panel)"
        >
          <MessageSquareText size={14} /> Chat
        </Button>
        <CloudControls />
        <SettingsButton />
        <Button
          onClick={() => navigator.clipboard.writeText(compiled.skillMd)}
          title="Copy SKILL.md"
        >
          <Copy size={14} /> Copy
        </Button>
        <ExportMenu file={file} />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[216px_1fr_440px]">
        <aside className="min-h-0 border-r border-[var(--line)] bg-[var(--panel)]">
          <Palette />
        </aside>
        <main className="min-h-0">
          <Canvas />
        </main>
        <aside className="grid min-h-0 grid-rows-2 border-l border-[var(--line)] bg-[var(--panel)]">
          <div className="min-h-0 overflow-y-auto border-b border-[var(--line)]">
            <Inspector />
          </div>
          <div className="min-h-0">
            <Preview />
          </div>
        </aside>
      </div>
      {drifted && (
        <DriftModal
          drifted={drifted}
          busy={bridgeStatus === 'saving'}
          onReimport={() => void onReimport()}
          onOverwrite={() => void onOverwrite()}
          onClose={() => setDrifted(null)}
        />
      )}
    </div>
  );
}
