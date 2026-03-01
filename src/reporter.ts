import chalk from 'chalk';
import type { TestResult, RunResult, StepResult, AssertionResult } from './types.js';
import { formatCost, formatDuration } from './utils.js';

// ── Live Reporter (streaming) ───────────────────────────────────────────────

/**
 * Write to stderr for live progress (always unbuffered).
 * Final results go to stdout for piping/JSON.
 */
function live(msg: string): void {
  process.stderr.write(msg);
}

export function printTestStart(name: string): void {
  live(` ${chalk.cyan('⟳')} ${name}\n`);
}

export function printStepLive(step: StepResult, verbose: boolean): void {
  const userLabel = step.userMessage ? `"${truncate(step.userMessage, 50)}"` : '(continued)';
  const icon = step.passed ? chalk.green('✓') : chalk.red('✗');

  live(`   ${icon} Step ${step.stepIndex + 1}: ${chalk.dim(userLabel)}\n`);

  if (verbose) {
    for (const a of step.assertions) {
      live(`     ${a.passed ? chalk.green('✓') : chalk.red('✗')} ${a.message}\n`);
    }
    if (step.toolCalls.length > 0) {
      live(chalk.dim(`     Tool calls:\n`));
      for (const tc of step.toolCalls) {
        live(chalk.dim(`       → ${tc.function.name}(${truncate(tc.function.arguments, 80)})\n`));
      }
    }
    if (step.assistantResponse) {
      live(chalk.dim(`     Response: "${truncate(step.assistantResponse, 120)}"\n`));
    }
  } else {
    // Compact: only show failed assertions
    for (const a of step.assertions) {
      if (!a.passed) {
        live(`     ${chalk.red('✗')} ${a.message}\n`);
      }
    }
  }
}

export function printTestEnd(test: TestResult): void {
  const icon = test.passed ? chalk.green('✓') : chalk.red('✗');
  const meta = chalk.dim(
    `(${formatDuration(test.durationMs)}, ${test.totalTokens.toLocaleString()} tokens, ~${formatCost(test.estimatedCost)})`,
  );

  live(` ${icon} ${test.name} ${meta}\n`);

  // Print global assertions
  if (test.globalAssertions.length > 0) {
    for (const a of test.globalAssertions) {
      live(`   ${a.passed ? chalk.green('✓') : chalk.red('✗')} ${a.message}\n`);
    }
  }

  if (test.error) {
    live(`   ${chalk.red('Error:')} ${test.error}\n`);
  }
}

export function printSummary(result: RunResult): void {
  live('\n');
  const passedStr = result.summary.passed > 0 ? chalk.green(`${result.summary.passed} passed`) : '';
  const failedStr = result.summary.failed > 0 ? chalk.red(`${result.summary.failed} failed`) : '';
  const errorStr = result.summary.errors > 0 ? chalk.yellow(`${result.summary.errors} error(s)`) : '';
  const parts = [passedStr, failedStr, errorStr].filter(Boolean);

  live(` ${chalk.bold('Tests:')}  ${parts.join(', ')} ${chalk.dim(`(${result.summary.total} total)`)}\n`);
  live(` ${chalk.bold('Time:')}   ${formatDuration(result.duration_ms)}\n`);
  live(` ${chalk.bold('Tokens:')} ${result.tokens.total.toLocaleString()} ${chalk.dim(`(~${formatCost(result.tokens.cost_usd)})`)}\n`);
  live('\n');
}

// ── JSON Reporter ───────────────────────────────────────────────────────────

export function reportJSON(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Terminal Reporter ───────────────────────────────────────────────────────

function assertionIcon(passed: boolean): string {
  return passed ? chalk.green('✓') : chalk.red('✗');
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

function reportStepCompact(step: StepResult): string[] {
  const lines: string[] = [];
  const userLabel = step.userMessage ? `"${truncate(step.userMessage, 50)}"` : '(continued)';
  const icon = step.passed ? chalk.green('✓') : chalk.red('✗');

  lines.push(`   ${icon} Step ${step.stepIndex + 1}: ${chalk.dim(userLabel)}`);

  // Only show failed assertions in compact mode
  for (const a of step.assertions) {
    if (!a.passed) {
      lines.push(`     ${chalk.red('✗')} ${a.message}`);
    }
  }

  return lines;
}

function reportStepVerbose(step: StepResult): string[] {
  const lines: string[] = [];
  const userLabel = step.userMessage ? `"${step.userMessage}"` : '(continued from tool result)';
  const icon = step.passed ? chalk.green('✓') : chalk.red('✗');

  lines.push(`   ${icon} Step ${step.stepIndex + 1}: ${chalk.dim(userLabel)}`);

  // Show all assertions
  for (const a of step.assertions) {
    lines.push(`     ${assertionIcon(a.passed)} ${a.message}`);
  }

  // Show tool calls
  if (step.toolCalls.length > 0) {
    lines.push(chalk.dim(`     Tool calls:`));
    for (const tc of step.toolCalls) {
      lines.push(chalk.dim(`       → ${tc.function.name}(${truncate(tc.function.arguments, 80)})`));
    }
  }

  // Show response
  if (step.assistantResponse) {
    lines.push(chalk.dim(`     Response: "${truncate(step.assistantResponse, 120)}"`));
  }

  return lines;
}

function reportTest(test: TestResult, verbose: boolean): string[] {
  const lines: string[] = [];
  const icon = test.passed ? chalk.green('✓') : chalk.red('✗');
  const meta = chalk.dim(
    `(${formatDuration(test.durationMs)}, ${test.totalTokens.toLocaleString()} tokens, ~${formatCost(test.estimatedCost)})`,
  );

  if (test.error) {
    lines.push(` ${chalk.red('✗')} ${test.name} ${meta}`);
    lines.push(`   ${chalk.red('Error:')} ${test.error}`);
    return lines;
  }

  lines.push(` ${icon} ${test.name} ${meta}`);

  if (test.passed && !verbose) {
    // Compact: don't show steps for passing tests
    return lines;
  }

  // Show steps
  for (const step of test.steps) {
    const stepLines = verbose ? reportStepVerbose(step) : reportStepCompact(step);
    lines.push(...stepLines);
  }

  // Show global assertions
  for (const a of test.globalAssertions) {
    lines.push(`   ${assertionIcon(a.passed)} ${a.message}`);
  }

  return lines;
}

export function reportTerminal(result: RunResult, verbose: boolean): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(` ${chalk.bold('promptman-test')} ${chalk.dim('v1.0.0')}`);
  lines.push('');

  // Tests
  for (const test of result.tests) {
    lines.push(...reportTest(test, verbose));
  }

  // Summary
  lines.push('');
  const passedStr = result.summary.passed > 0 ? chalk.green(`${result.summary.passed} passed`) : '';
  const failedStr = result.summary.failed > 0 ? chalk.red(`${result.summary.failed} failed`) : '';
  const errorStr = result.summary.errors > 0 ? chalk.yellow(`${result.summary.errors} error(s)`) : '';
  const parts = [passedStr, failedStr, errorStr].filter(Boolean);

  lines.push(
    ` ${chalk.bold('Tests:')}  ${parts.join(', ')} ${chalk.dim(`(${result.summary.total} total)`)}`,
  );
  lines.push(
    ` ${chalk.bold('Time:')}   ${formatDuration(result.duration_ms)}`,
  );
  lines.push(
    ` ${chalk.bold('Tokens:')} ${result.tokens.total.toLocaleString()} ${chalk.dim(`(~${formatCost(result.tokens.cost_usd)})`)}`,
  );
  lines.push('');

  return lines.join('\n');
}

// ── Dry Run Reporter ────────────────────────────────────────────────────────

export function reportDryRun(
  files: Array<{ file: string; test: { name: string; steps: unknown[]; tools?: unknown[] } }>,
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(` ${chalk.bold('promptman-test')} ${chalk.dim('dry run')}`);
  lines.push('');

  for (const { file, test } of files) {
    lines.push(` ${chalk.cyan('○')} ${test.name} ${chalk.dim(`(${file})`)}`);
    lines.push(chalk.dim(`   ${test.steps.length} step(s), ${test.tools?.length ?? 0} tool(s)`));
  }

  lines.push('');
  lines.push(chalk.dim(` ${files.length} test file(s) parsed successfully`));
  lines.push('');

  return lines.join('\n');
}
