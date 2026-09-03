import {
  ArrowRight,
  Cable,
  FlaskConical,
  ListChecks,
  Lock,
  Package,
  Repeat2,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CopyBlock } from './CopyBlock';
import { HeroFigure } from './HeroFigure';
import { LogoMark, SiteHeader } from './SiteHeader';

const STEPS: { n: string; title: string; body: ReactNode }[] = [
  {
    n: '1',
    title: 'Draw',
    body: (
      <>
        Phases, steps, decisions, references, scripts, guardrails, an output template. Each is a
        node on a canvas, so the shape prose hides is in plain sight: the dead branch, the reference
        nothing reads, the step with no why.
      </>
    ),
  },
  {
    n: '2',
    title: 'Compile',
    body: (
      <>
        <code className="mk-mono text-[13px]">SKILL.graph.json</code> is canonical. The compiler
        emits a spec-compliant <code className="mk-mono text-[13px]">SKILL.md</code> plus{' '}
        <code className="mk-mono text-[13px]">references/</code>,{' '}
        <code className="mk-mono text-[13px]">scripts/</code> and{' '}
        <code className="mk-mono text-[13px]">assets/</code>, lints the result, and refuses to
        overwrite a hand edit it did not make.
      </>
    ),
  },
  {
    n: '3',
    title: 'Ship',
    body: (
      <>
        Export a Claude Code plugin, a <code className="mk-mono text-[13px]">.skill</code> for
        claude.ai, a <code className="mk-mono text-[13px]">skills/</code> repo, or publish to the
        Skills API. Or run the local bridge and write straight into{' '}
        <code className="mk-mono text-[13px]">~/.claude/skills</code>.
      </>
    ),
  },
];

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Repeat2 size={18} />,
    title: 'Round-trip import',
    body: 'Import any existing SKILL.md into a graph and compile it back byte for byte. Unrecognized prose is kept verbatim; the fidelity report says what was recognized, guessed, or left raw.',
  },
  {
    icon: <ListChecks size={18} />,
    title: 'Lint against the spec',
    body: "Findings against the Agent Skills specification and Anthropic's authoring practices, pinned to the node that caused them: frontmatter, description length, orphan references, missing whys.",
  },
  {
    icon: <Sparkles size={18} />,
    title: 'AI proposes, you decide',
    body: 'Critique, describe, copilot, interview, transcript-to-skill. Every result is a validated patch you accept or reject, and undo like any other edit.',
  },
  {
    icon: <FlaskConical size={18} />,
    title: 'Trigger evals that run for real',
    body: 'Trigger and task evals run the actual claude CLI with your Claude Code login, in a throwaway project that contains only the compiled skill. Traces tint the canvas by how often each node was visited.',
  },
  {
    icon: <Cable size={18} />,
    title: 'MCP server and meta-skill',
    body: 'skillgraph mcp serves the graph over stdio, so Claude Code authors skills with the same patch contract the editor uses. The companion skill teaches it the vocabulary.',
  },
  {
    icon: <Package size={18} />,
    title: 'Export anywhere',
    body: 'Zip, .skill, Claude Code plugin with a marketplace manifest, skills/ repo for npx skills add, or skillgraph publish to the Anthropic Skills API. Two profiles: universal and claude-code.',
  },
];

const CLI_LINES = [
  'skillgraph import ~/.claude/skills/my-skill   # graph next to SKILL.md, plus a fidelity report',
  'skillgraph lint ~/.claude/skills/my-skill',
  'skillgraph compile ~/.claude/skills/my-skill  # re-emits SKILL.md byte for byte',
  'skillgraph eval triggers ~/.claude/skills/my-skill --runs 3',
  'skillgraph export ~/.claude/skills/my-skill --format plugin --out-dir ./my-plugin',
];

function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
  className = '',
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-20 ${className}`}>
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-10 max-w-2xl">
          <p className="mk-eyebrow mb-3">{eyebrow}</p>
          <h2 className="mk-h2">{title}</h2>
          {lede && <p className="mt-3 text-[16px] text-[var(--muted)]">{lede}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Landing() {
  return (
    <div className="mk min-h-screen">
      <SiteHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-5 pt-16 pb-14 md:pt-24">
          <div className="grid grid-cols-1 items-end gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div>
              <p className="mk-eyebrow mb-5">A compiler for Agent Skills</p>
              <h1 className="mk-display">
                See the skill. <span className="text-[var(--muted)]">Ship the prose.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-[1.55] text-[var(--ink)]">
                An Agent Skill is a procedure graph flattened into prose, and once it is prose you
                cannot see its shape. SkillGraph makes the graph the source of truth: draw it,
                compile it deterministically to a spec-compliant{' '}
                <code className="mk-mono text-[15px]">SKILL.md</code>, lint it, and import any
                existing skill back without losing a line.
              </p>
            </div>
            <div className="lg:pb-2">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/app"
                  className="inline-flex items-center gap-2 rounded-md bg-[var(--accent)] px-4 py-2.5 text-[14px] font-medium text-white transition hover:opacity-90"
                >
                  Open the editor
                  <ArrowRight size={15} />
                </Link>
                <a
                  href="#how"
                  className="inline-flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 text-[14px] font-medium transition hover:bg-[var(--panel)]"
                >
                  How it works
                </a>
              </div>
              <p className="mk-mono mt-5 text-[11.5px] text-[var(--muted)]">
                Free while in preview · runs in your browser · Claude Code, Claude.ai, Codex,
                Cursor, Gemini CLI
              </p>
            </div>
          </div>
          <div className="mt-12">
            <HeroFigure />
          </div>
        </section>

        {/* How it works: a real sequence, so the numbers carry meaning. */}
        <Section
          id="how"
          eyebrow="How it works"
          title="Draw the graph. Compile the file. Ship it."
          lede="Nothing executes on the canvas. The agent reads the compiled Markdown, exactly as it would any hand-written skill."
          className="border-t border-[var(--line)] bg-[var(--panel)]"
        >
          <ol className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--line)] md:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-[var(--panel)] p-6">
                <div className="mk-mono mb-4 flex items-center gap-3 text-[11px] text-[var(--muted)]">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ink)]">
                    {s.n}
                  </span>
                  step {s.n} of 3
                </div>
                <h3 className="text-[19px] font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[14px] leading-[1.6] text-[var(--muted)]">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Features */}
        <Section
          id="features"
          eyebrow="What it does"
          title="A design-time compiler, not a workflow engine."
          lede="Everything is a patch to the graph. The compiler, the linter, the AI and the MCP server all speak the same one."
          className="border-t border-[var(--line)]"
        >
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li
                key={f.title}
                className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5"
              >
                <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
                  {f.icon}
                </div>
                <h3 className="text-[15px] font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-[1.6] text-[var(--muted)]">{f.body}</p>
              </li>
            ))}
          </ul>
        </Section>

        {/* CLI */}
        <Section
          id="cli"
          eyebrow="CLI"
          title="The same compiler, from a terminal."
          lede="Every command the editor runs is also a command. Point it at a skill folder; it writes SKILL.graph.json beside the SKILL.md and keeps both honest."
          className="border-t border-[var(--line)] bg-[var(--panel)]"
        >
          <CopyBlock lines={CLI_LINES} label="SkillGraph CLI commands" />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-5">
              <p className="mk-eyebrow mb-2">Edit ~/.claude/skills directly</p>
              <p className="text-[13.5px] leading-[1.6] text-[var(--muted)]">
                <code className="mk-mono text-[var(--ink)]">skillgraph dev</code> runs a bridge on
                127.0.0.1. The editor lists the folder, opens any skill, and writes it back with
                drift protection: a save is refused when the file changed on disk since you opened
                it.
              </p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-5">
              <p className="mk-eyebrow mb-2">Let Claude Code author graphs</p>
              <p className="text-[13.5px] leading-[1.6] text-[var(--muted)]">
                <code className="mk-mono text-[var(--ink)]">skillgraph mcp</code> exposes{' '}
                <code className="mk-mono">graph_get</code>,{' '}
                <code className="mk-mono">graph_apply_patch</code>,{' '}
                <code className="mk-mono">graph_compile</code> and{' '}
                <code className="mk-mono">graph_lint</code> over stdio, with the same drift
                protection as the CLI.
              </p>
            </div>
          </div>
        </Section>

        {/* Trust */}
        <section className="border-t border-[var(--line)]">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <div className="flex flex-col gap-5 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6 md:flex-row md:items-start md:gap-8">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--ok)]">
                <Lock size={17} />
              </div>
              <div className="max-w-3xl">
                <h2 className="text-[17px] font-semibold tracking-tight">
                  Local-first. Your keys stay with you.
                </h2>
                <p className="mt-2 text-[14px] leading-[1.65] text-[var(--muted)]">
                  Skills live in this browser until you export them or link a folder. An Anthropic
                  API key, if you set one, stays in localStorage and is sent only to this app's{' '}
                  <code className="mk-mono">/api/ai/*</code> routes one request at a time; the
                  server never stores or logs it. Or set no key at all: with{' '}
                  <code className="mk-mono">skillgraph dev</code> running, the AI tab and the evals
                  use your Claude Code login on your own machine. SkillGraph never runs imported
                  scripts or injected commands.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--line)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-[13px] text-[var(--muted)] md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2">
            <LogoMark size={16} />
            <span className="font-medium text-[var(--ink)]">SkillGraph</span>
            <span aria-hidden="true">·</span>
            <span>Early access</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/privacy" className="transition hover:text-[var(--ink)]">
              Privacy
            </a>
            <a href="/terms" className="transition hover:text-[var(--ink)]">
              Terms
            </a>
            <a href="#how" className="transition hover:text-[var(--ink)]">
              How it works
            </a>
            <a href="#features" className="transition hover:text-[var(--ink)]">
              Features
            </a>
            <a href="#cli" className="transition hover:text-[var(--ink)]">
              CLI
            </a>
            <a
              href="https://agentskills.io/specification"
              className="transition hover:text-[var(--ink)]"
              rel="noreferrer"
            >
              Agent Skills spec
            </a>
            <Link href="/app" className="transition hover:text-[var(--ink)]">
              Open the editor
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
