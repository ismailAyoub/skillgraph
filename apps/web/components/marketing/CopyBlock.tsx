'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

/** A code block with a copy button. `lines` are shown as-is; comments after `#` are dimmed. */
export function CopyBlock({ lines, label }: { lines: string[]; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="relative">
      <div className="mk-code px-4 py-3.5 pr-24" title={label}>
        {lines.map((line) => {
          const i = line.indexOf('#');
          const cmd = i >= 0 ? line.slice(0, i) : line;
          const comment = i >= 0 ? line.slice(i) : '';
          return (
            <div key={line}>
              <span className="select-none text-[var(--muted)]">$ </span>
              {cmd}
              {comment && <span className="text-[var(--muted)]">{comment}</span>}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={copy}
        className="absolute top-2.5 right-2.5 inline-flex items-center gap-1.5 rounded-md border border-[var(--line)] bg-white px-2 py-1 text-[11px] font-medium text-[var(--muted)] transition hover:text-[var(--ink)]"
        aria-live="polite"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
