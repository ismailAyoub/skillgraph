'use client';

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger';
}) {
  const base =
    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed';
  const styles = {
    default: 'border border-[var(--line)] bg-white hover:bg-neutral-50',
    primary: 'bg-[var(--accent)] text-white hover:opacity-90',
    ghost: 'hover:bg-neutral-100',
    danger: 'border border-red-200 text-red-700 hover:bg-red-50',
  }[variant];
  return <button type="button" className={`${base} ${styles} ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="block space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {label}
        </span>
        {hint && <span className="text-[10px] text-[var(--muted)]">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-[var(--line)] bg-white px-2 py-1.5 text-xs focus:border-[var(--accent)] focus:outline-none';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputCls} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${inputCls} min-h-[60px] resize-y font-[inherit]`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputCls} {...props} />;
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-[var(--line)] px-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 px-2 py-1.5 text-xs ${value === t.id ? 'border-[var(--accent)] font-semibold text-[var(--accent)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'ok' | 'warn' | 'err' | 'accent';
}) {
  const cls = {
    muted: 'bg-neutral-100 text-neutral-600',
    ok: 'bg-green-50 text-green-700',
    warn: 'bg-amber-50 text-amber-700',
    err: 'bg-red-50 text-red-700',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent)]',
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{children}</span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 440,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-close; the dialog itself is focusable
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is handled on the dialog element
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full rounded-lg border border-[var(--line)] bg-white shadow-xl outline-none"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 text-[var(--muted)] hover:bg-neutral-100 hover:text-[var(--ink)]"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="space-y-3 px-4 py-3 text-xs">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-[var(--line)] px-4 py-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
