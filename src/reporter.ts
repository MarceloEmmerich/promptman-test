import chalk from 'chalk';
import type { TestResult, RunResult, StepResult, AssertionResult, ProgressEvent } from './types.js';
import { formatCost, formatDuration } from './utils.js';

// ── Spinner ─────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private text = '';
  private lineLen = 0;

  start(text: string): void {
    this.text = text;
    this.frameIdx = 0;
    this.render();
    this.interval = setInterval(() => this.render(), 80);
  }

  update(text: string): void {
    this.text = text;
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.clear();
  }

  private render(): void {
    this.clear();
    const frame = chalk.cyan(SPINNER_FRAMES[this.frameIdx % SPINNER_FRAMES.length]);
    const line = `  ${frame} ${chalk.dim(this.text)}`;
    process.stderr.write(line);
    this.lineLen = stripAnsi(line).length;
    this.frameIdx++;
  }

  private clear(): void {
    if (this.lineLen > 0) {
      process.stderr.write(`\r${' '.repeat(this.lineLen)}\r`);
      this.lineLen = 0;
    }
  }
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}

function live(msg: string): void {
  process.stderr.write(msg);
}

// ── Live Reporter ───────────────────────────────────────────────────────────

export class LiveReporter {
  private spinner = new Spinner();
  private verbose: boolean;
  private stepStartTime = 0;

  constructor(verbose: boolean) {
    this.verbose = verbose;
  }

  handleEvent(event: ProgressEvent): void {
    switch (event.type) {
      case 'test:start':
        live(`\n  ${chalk.bold.white(event.testName)}\n`);
        live(`  ${chalk.dim('─'.repeat(Math.min(event.testName.length + 4, 60)))}\n`);
        break;

      case 'step:start': {
        this.stepStartTime = Date.now();
        const label = event.userMessage
          ? chalk.white(`"${truncate(event.userMessage, 50)}"`)
          : chalk.dim('(processing tool result)');
        this.spinner.start(`Step ${(event.stepIndex ?? 0) + 1}: ${stripAnsi(label)} — waiting for LLM…`);
        break;
      }

      case 'step:llm_call':
        this.spinner.update(`Step ${(event.stepIndex ?? 0) + 1} — calling LLM…`);
        break;

      case 'step:tool_calls': {
        const tools = event.toolNames?.join(', ') ?? '';
        this.spinner.update(`Step ${(event.stepIndex ?? 0) + 1} — called ${chalk.yellow(tools)}, injecting mocks…`);
        break;
      }

      case 'step:mock_inject':
        this.spinner.update(`Step ${(event.stepIndex ?? 0) + 1} — processing tool results…`);
        break;

      case 'step:complete': {
        this.spinner.stop();
        const step = event.step;
        if (!step) break;

        const elapsed = Date.now() - this.stepStartTime;
        const timeStr = chalk.dim(`${formatDuration(elapsed)}`);
        const stepNum = chalk.dim(`${step.stepIndex + 1}`);

        if (step.passed) {
          const userLabel = step.userMessage
            ? `"${truncate(step.userMessage, 45)}"`
            : '(continued)';
          live(`  ${chalk.green('●')} ${chalk.dim('Step')} ${stepNum}  ${chalk.green('pass')}  ${timeStr}  ${chalk.dim(userLabel)}\n`);

          if (this.verbose) {
            this.printStepDetails(step);
          }
        } else {
          const userLabel = step.userMessage
            ? `"${truncate(step.userMessage, 45)}"`
            : '(continued)';
          live(`  ${chalk.red('✘')} ${chalk.dim('Step')} ${stepNum}  ${chalk.red('FAIL')}  ${timeStr}  ${chalk.dim(userLabel)}\n`);
          this.printFailedAssertions(step);

          if (this.verbose) {
            this.printStepDetails(step);
          }
        }
        break;
      }
    }
  }

  private printFailedAssertions(step: StepResult): void {
    for (const a of step.assertions) {
      if (!a.passed) {
        live(`    ${chalk.red('└')} ${chalk.red(a.message)}\n`);
      }
    }
  }

  private printStepDetails(step: StepResult): void {
    // Show all assertions
    for (const a of step.assertions) {
      const icon = a.passed ? chalk.green('✓') : chalk.red('✗');
      const msg = a.passed ? chalk.dim(a.message) : chalk.red(a.message);
      live(`    ${chalk.dim('│')} ${icon} ${msg}\n`);
    }

    // Tool calls
    if (step.toolCalls.length > 0) {
      for (const tc of step.toolCalls) {
        live(`    ${chalk.dim('│')} ${chalk.yellow('▸')} ${chalk.yellow(tc.function.name)}${chalk.dim('(')}${chalk.dim(truncate(tc.function.arguments, 60))}${chalk.dim(')')}\n`);
      }
    }

    // Response
    if (step.assistantResponse) {
      live(`    ${chalk.dim('│')} ${chalk.dim('⚡')} ${chalk.dim(truncate(step.assistantResponse, 80))}\n`);
    }

    live(`    ${chalk.dim('│')}\n`);
  }

  printTestEnd(test: TestResult): void {
    if (test.error) {
      live(`\n  ${chalk.red('✘')} ${chalk.red('Error:')} ${test.error}\n`);
    }

    // Global assertions
    if (test.globalAssertions.length > 0) {
      live(`  ${chalk.dim('─')}\n`);
      for (const a of test.globalAssertions) {
        const icon = a.passed ? chalk.green('●') : chalk.red('✘');
        live(`  ${icon} ${a.passed ? chalk.dim(a.message) : chalk.red(a.message)}\n`);
      }
    }

    const icon = test.passed ? chalk.green('✓') : chalk.red('✗');
    const status = test.passed ? chalk.green('PASSED') : chalk.red('FAILED');
    const meta = chalk.dim(
      `${formatDuration(test.durationMs)} · ${test.totalTokens.toLocaleString()} tokens · ~${formatCost(test.estimatedCost)}`,
    );
    live(`\n  ${icon} ${status} ${meta}\n`);
  }

  printHeader(): void {
    live(`\n  ${chalk.bold.hex('#7C5CFC')('promptman-test')} ${chalk.dim('v1.0.0')}\n`);
  }

  printSummary(result: RunResult): void {
    live(`\n  ${chalk.dim('━'.repeat(50))}\n\n`);

    const passedStr = result.summary.passed > 0
      ? chalk.green(`${result.summary.passed} passed`)
      : '';
    const failedStr = result.summary.failed > 0
      ? chalk.red(`${result.summary.failed} failed`)
      : '';
    const errorStr = result.summary.errors > 0
      ? chalk.yellow(`${result.summary.errors} error(s)`)
      : '';
    const parts = [passedStr, failedStr, errorStr].filter(Boolean);

    live(`  ${chalk.bold('Tests')}     ${parts.join(chalk.dim(' · '))} ${chalk.dim(`(${result.summary.total} total)`)}\n`);
    live(`  ${chalk.bold('Duration')}  ${formatDuration(result.duration_ms)}\n`);
    live(`  ${chalk.bold('Tokens')}    ${result.tokens.total.toLocaleString()} ${chalk.dim(`(~${formatCost(result.tokens.cost_usd)})`)}\n`);
    live('\n');
  }
}

// ── JSON Reporter ───────────────────────────────────────────────────────────

export function reportJSON(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

// ── Dry Run Reporter ────────────────────────────────────────────────────────

export function reportDryRun(
  files: Array<{ file: string; test: { name: string; steps: unknown[]; tools?: unknown[] } }>,
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`  ${chalk.bold.hex('#7C5CFC')('promptman-test')} ${chalk.dim('dry run')}`);
  lines.push('');

  for (const { file, test } of files) {
    lines.push(`  ${chalk.cyan('○')} ${chalk.white(test.name)}`);
    lines.push(chalk.dim(`    ${test.steps.length} step(s) · ${test.tools?.length ?? 0} tool(s) · ${file}`));
  }

  lines.push('');
  lines.push(`  ${chalk.green('✓')} ${chalk.dim(`${files.length} test file(s) parsed successfully`)}`);
  lines.push('');

  return lines.join('\n');
}
