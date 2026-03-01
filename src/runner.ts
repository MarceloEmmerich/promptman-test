import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { glob } from 'glob';
import type { Config, CLIOptions, RunResult, TestDefinition } from './types.js';
import { loadConfig } from './config.js';
import { parseTestFile } from './parser.js';
import { executeTest } from './executor.js';
import { LiveReporter, reportJSON, reportDryRun } from './reporter.js';

/**
 * Discover test files from the given paths (files or directories).
 */
async function discoverFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const p of paths) {
    const resolved = resolve(p);
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      // Try as a glob pattern
      const matches = await glob(p, { absolute: true });
      files.push(...matches.filter(m => m.endsWith('.test.yaml') || m.endsWith('.test.yml')));
      continue;
    }

    if (stat.isFile()) {
      files.push(resolved);
    } else if (stat.isDirectory()) {
      const matches = await glob('**/*.test.{yaml,yml}', { cwd: resolved, absolute: true });
      files.push(...matches);
    }
  }

  // Deduplicate
  return [...new Set(files)].sort();
}

/**
 * Run tests with the given CLI options and file/directory paths.
 */
export async function run(paths: string[], options: CLIOptions): Promise<void> {
  const config = loadConfig(options);

  // Default to current directory
  if (paths.length === 0) {
    paths = ['.'];
  }

  const files = await discoverFiles(paths);

  if (files.length === 0) {
    console.error('No test files found. Test files must match *.test.yaml or *.test.yml');
    process.exit(2);
  }

  // Parse all test files first
  const parsed: Array<{ file: string; test: TestDefinition }> = [];
  for (const file of files) {
    try {
      const test = parseTestFile(file);
      parsed.push({ file, test });
    } catch (error) {
      console.error(`Error parsing ${file}: ${(error as Error).message}`);
      process.exit(2);
    }
  }

  // Dry run — just validate and report
  if (options.dryRun) {
    console.log(reportDryRun(parsed));
    process.exit(0);
  }

  // Check for API key
  if (!config.provider.api_key) {
    console.error(
      'No API key found. Set OPENAI_API_KEY (or LLM_API_KEY) environment variable, or configure provider.api_key in config.',
    );
    process.exit(2);
  }

  const isJson = !!options.json;
  const verbose = config.settings.verbose || !!options.verbose;
  const reporter = new LiveReporter(verbose);

  // Execute tests sequentially
  const startTime = Date.now();
  const results: RunResult['tests'] = [];

  if (!isJson) {
    reporter.printHeader();
  }

  for (const { file, test } of parsed) {
    const result = await executeTest(test, config, file, isJson ? undefined : {
      onProgress: (event) => reporter.handleEvent(event),
    });

    if (!isJson) {
      reporter.printTestEnd(result);
    }

    results.push(result);

    // Bail on first failure
    if (options.bail && !result.passed) {
      break;
    }
  }

  // Build run result
  const runResult: RunResult = {
    tests: results,
    summary: {
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed && !r.error).length,
      total: results.length,
      errors: results.filter(r => !!r.error).length,
    },
    tokens: {
      total: results.reduce((sum, r) => sum + r.totalTokens, 0),
      cost_usd: results.reduce((sum, r) => sum + r.estimatedCost, 0),
    },
    duration_ms: Date.now() - startTime,
  };

  // Report
  if (isJson) {
    console.log(reportJSON(runResult));
  } else {
    reporter.printSummary(runResult);
  }

  // Exit code
  const allPassed = runResult.summary.failed === 0 && runResult.summary.errors === 0;
  process.exit(allPassed ? 0 : 1);
}
