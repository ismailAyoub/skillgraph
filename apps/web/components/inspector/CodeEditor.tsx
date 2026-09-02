'use client';

import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';

export function CodeEditor({
  value,
  onChange,
  lang,
  minHeight = '120px',
}: {
  value: string;
  onChange: (v: string) => void;
  lang?: string;
  minHeight?: string;
}) {
  const extensions = useMemo(() => {
    switch ((lang ?? '').toLowerCase()) {
      case 'markdown':
      case 'md':
        return [markdown()];
      case 'javascript':
      case 'typescript':
      case 'js':
      case 'ts':
        return [javascript({ typescript: /ts/.test(lang ?? '') })];
      case 'python':
      case 'py':
        return [python()];
      case 'yaml':
      case 'yml':
        return [yaml()];
      default:
        return [];
    }
  }, [lang]);
  return (
    <div className="overflow-hidden rounded-md border border-[var(--line)] text-xs">
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        minHeight={minHeight}
        basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
      />
    </div>
  );
}
