#!/usr/bin/env node

import { Command } from 'commander';
import { run } from './runner.js';

const program = new Command();

program
  .name('promptman-test')
  .description('Local test runner for multi-turn, tool-calling LLM prompts')
  .version('1.0.0')
  .argument('[files...]', 'Test files or directories (default: current directory)')
  .option('-c, --config <path>', 'Config file path')
  .option('-v, --verbose', 'Show detailed output including full LLM responses')
  .option('--json', 'Output results as JSON')
  .option('--model <model>', 'Override model for all tests')
  .option('--base-url <url>', 'Override provider base URL')
  .option('--timeout <ms>', 'Override step timeout (ms)', parseInt)
  .option('--max-turns <n>', 'Override max turns safety limit', parseInt)
  .option('--bail', 'Stop on first failure')
  .option('--dry-run', 'Parse and validate test files without running')
  .action(async (files: string[], options) => {
    try {
      await run(files, {
        config: options.config,
        verbose: options.verbose,
        json: options.json,
        model: options.model,
        baseUrl: options.baseUrl,
        timeout: options.timeout,
        maxTurns: options.maxTurns,
        bail: options.bail,
        dryRun: options.dryRun,
      });
    } catch (error) {
      console.error(`Fatal error: ${(error as Error).message}`);
      process.exit(2);
    }
  });

program.parse();
