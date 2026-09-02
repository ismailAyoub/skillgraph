/**
 * The hero illustration: a small skill graph and the SKILL.md it compiles to.
 * Nodes and lines share `data-node` / `data-line` ids; globals.css links them on hover.
 */

const NODE_TITLE = 'fill-[var(--ink)]';
const KIND = 'mk-mono uppercase';

function Kind({
  x,
  y,
  color,
  children,
}: {
  x: number;
  y: number;
  color: string;
  children: string;
}) {
  return (
    <text x={x} y={y} fontSize="8.5" letterSpacing="0.08em" fill={color} className={KIND}>
      {children}
    </text>
  );
}

function StepNode({ id, x, y, label }: { id: string; x: number; y: number; label: string }) {
  return (
    <g data-node={id}>
      <rect
        className="mk-nbox"
        x={x}
        y={y}
        width="170"
        height="38"
        rx="7"
        fill="#fff"
        stroke="var(--n-step)"
        strokeWidth="1.25"
      />
      <Kind x={x + 10} y={y + 14} color="var(--n-step)">
        step
      </Kind>
      <text x={x + 10} y={y + 29} fontSize="11.5" fontWeight="600" className={NODE_TITLE}>
        {label}
      </text>
    </g>
  );
}

function PhaseGroup({
  id,
  y,
  height,
  label,
}: {
  id: string;
  y: number;
  height: number;
  label: string;
}) {
  return (
    <g data-node={id}>
      <rect
        className="mk-nbox"
        x="12"
        y={y}
        width="250"
        height={height}
        rx="10"
        fill="rgb(255 255 255 / 0.45)"
        stroke="var(--n-phase)"
        strokeWidth="1.25"
        strokeDasharray="4 3"
      />
      <Kind x={24} y={y + 16} color="var(--n-phase)">
        phase
      </Kind>
      <text x={62} y={y + 16} fontSize="10.5" fontWeight="600" fill="var(--n-phase)">
        {label}
      </text>
    </g>
  );
}

export function SkillGraphFigure() {
  return (
    <svg
      viewBox="0 0 380 400"
      className="h-auto w-full max-w-[520px]"
      role="img"
      aria-label="A skill graph: an entry node, a Diverge phase with two steps and a decision that loops back, a reference file read by one step, and a Converge phase with one step."
      fontFamily="ui-sans-serif, system-ui, sans-serif"
    >
      <title>Skill graph</title>
      <defs>
        <marker
          id="mk-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="#9a9aa0" />
        </marker>
      </defs>

      {/* Phase groups go first so nodes draw on top. */}
      <PhaseGroup id="diverge" y={72} height={222} label="Diverge" />
      <PhaseGroup id="converge" y={312} height={76} label="Converge" />

      {/* Edges */}
      <g fill="none" stroke="#9a9aa0" strokeWidth="1.4" markerEnd="url(#mk-arrow)">
        <path d="M113 52V98" />
        <path d="M113 136V156" />
        <path d="M113 194V214" />
        <path d="M113 274V338" />
        {/* yes: loop back to "Generate ten angles" */}
        <path d="M38 244H20V175H28" />
        {/* reads */}
        <path d="M198 175H272" strokeDasharray="3 3" stroke="var(--n-reference)" />
      </g>
      <text x="119" y="302" fontSize="9" fill="var(--muted)" className={KIND}>
        no
      </text>
      <text x="24" y="208" fontSize="9" fill="var(--muted)" className={KIND}>
        yes
      </text>
      <text x="221" y="169" fontSize="9" fill="var(--n-reference)" className={KIND}>
        reads
      </text>

      {/* Entry */}
      <g data-node="entry">
        <rect
          className="mk-nbox"
          x="20"
          y="14"
          width="186"
          height="38"
          rx="7"
          fill="#fff"
          stroke="var(--n-entry)"
          strokeWidth="1.25"
        />
        <Kind x={30} y={28} color="var(--n-entry)">
          entry
        </Kind>
        <text x="30" y="43" fontSize="11.5" fontWeight="600" className={NODE_TITLE}>
          idea-refine
        </text>
        <text x="130" y="43" fontSize="9" fill="var(--muted)" className={KIND}>
          universal
        </text>
      </g>

      <StepNode id="restate" x={28} y={98} label="Restate as a HMW" />
      <StepNode id="angles" x={28} y={156} label="Generate ten angles" />

      {/* Reference */}
      <g data-node="ref">
        <rect
          className="mk-nbox"
          x="272"
          y="156"
          width="100"
          height="38"
          rx="7"
          fill="#fff"
          stroke="var(--n-reference)"
          strokeWidth="1.25"
        />
        <Kind x={282} y={170} color="var(--n-reference)">
          reference
        </Kind>
        <text x="282" y="185" fontSize="11" fontWeight="600" className={`${NODE_TITLE} mk-mono`}>
          angles.md
        </text>
      </g>

      {/* Decision */}
      <g data-node="alike">
        <path
          className="mk-nbox"
          d="M113 214L188 244L113 274L38 244Z"
          fill="#fff"
          stroke="var(--n-decision)"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        <text
          x="113"
          y="238"
          textAnchor="middle"
          fontSize="8.5"
          letterSpacing="0.08em"
          fill="var(--n-decision)"
          className={KIND}
        >
          decision
        </text>
        <text
          x="113"
          y="254"
          textAnchor="middle"
          fontSize="11.5"
          fontWeight="600"
          className={NODE_TITLE}
        >
          angles alike?
        </text>
      </g>

      <StepNode id="pick" x={28} y={338} label="Pick the three" />
    </svg>
  );
}

export function CompiledSkillMd() {
  return (
    <div className="mk-mono text-[12.5px] leading-[1.6] text-[var(--ink)] whitespace-pre-wrap">
      <div data-line="entry" className="text-[var(--muted)]">
        {'---'}
      </div>
      <div data-line="entry">
        <span className="text-[var(--n-entry)]">name:</span> idea-refine
      </div>
      <div data-line="entry">
        <span className="text-[var(--n-entry)]">description:</span> Refine a raw idea into a sharp
        concept. Use when an idea is still vague or when you need to stress-test a plan before
        committing.
      </div>
      <div data-line="entry" className="text-[var(--muted)]">
        {'---'}
      </div>
      <div className="h-3" />
      <div className="font-bold"># Idea Refine</div>
      <div className="h-3" />
      <div data-line="diverge" className="font-bold">
        ## Diverge
      </div>
      <div className="h-3" />
      <div data-line="restate">
        1. <b>Restate the idea</b> as a crisp "How Might We" statement. This forces clarity before
        any option exists.
      </div>
      <div data-line="angles">
        2. <b>Generate ten angles</b> on the problem. Read{' '}
        <span data-line="ref" className="text-[var(--n-reference)] underline decoration-dotted">
          [references/angles.md](references/angles.md)
        </span>{' '}
        for the prompt set.
      </div>
      <div data-line="alike">
        3. If the angles feel alike, widen the frame and repeat step 2. Otherwise continue.
      </div>
      <div className="h-3" />
      <div data-line="converge" className="font-bold">
        ## Converge
      </div>
      <div className="h-3" />
      <div data-line="pick">
        4. <b>Pick the three</b> that survive the constraints and write one sentence for each.
      </div>
    </div>
  );
}

export function HeroFigure() {
  return (
    <figure className="mk-hero overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-[0_1px_2px_rgb(0_0_0/0.06),0_12px_40px_-24px_rgb(0_0_0/0.25)]">
      <div className="mk-mono flex items-center gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-4 py-2 text-[11px] text-[var(--muted)]">
        <span className="text-[var(--ink)]">SKILL.graph.json</span>
        <span aria-hidden="true">→</span>
        <span>compile</span>
        <span aria-hidden="true">→</span>
        <span className="text-[var(--ink)]">SKILL.md</span>
        <span className="ml-auto hidden sm:inline">same graph, same bytes</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,11fr)_minmax(0,10fr)]">
        <div className="flex items-start justify-center border-b border-[var(--line)] p-5 md:border-r md:border-b-0">
          <SkillGraphFigure />
        </div>
        <div className="p-5">
          <CompiledSkillMd />
        </div>
      </div>
      <figcaption className="border-t border-[var(--line)] px-4 py-2 text-[11.5px] text-[var(--muted)]">
        Hover a node to see the line it compiles to, or a line to find its node.
      </figcaption>
    </figure>
  );
}
