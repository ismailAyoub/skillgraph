import type { Diagnostic, LintResult } from '@skillgraph/core';
import pc from 'picocolors';

export function printDiagnostics(result: LintResult, file = 'SKILL.md'): void {
  const order: Diagnostic['severity'][] = ['error', 'warning', 'info'];
  const sorted = [...result.diagnostics].sort(
    (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity),
  );
  for (const d of sorted) {
    const tag =
      d.severity === 'error'
        ? pc.red('error')
        : d.severity === 'warning'
          ? pc.yellow('warn ')
          : pc.cyan('info ');
    const where = d.nodeId ? pc.dim(` [${d.nodeId}]`) : '';
    console.log(`  ${tag} ${pc.dim(d.rule)} ${d.message}${where}`);
  }
  const summary = `${result.errors} error(s), ${result.warnings} warning(s), ${result.infos} info`;
  console.log(
    result.errors > 0
      ? pc.red(summary)
      : result.warnings > 0
        ? pc.yellow(summary)
        : pc.green(summary),
  );
  void file;
}
