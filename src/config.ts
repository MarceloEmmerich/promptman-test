import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Config, CLIOptions, PromptmanConfig } from './types.js';
import { resolveEnvVars, deepMerge } from './utils.js';

const CONFIG_FILENAMES = [
  'promptman-test.config.yaml',
  'promptman-test.config.yml',
  'promptman-test.config.json',
];

const DEFAULT_CONFIG: Config = {
  provider: {
    base_url: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
  settings: {
    timeout: 30000,
    max_turns: 20,
    verbose: false,
  },
};

function findConfigFile(dir: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const p = resolve(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function loadConfigFile(path: string): Partial<Config> {
  const content = readFileSync(path, 'utf-8');
  if (path.endsWith('.json')) {
    return JSON.parse(content) as Partial<Config>;
  }
  return parseYaml(content) as Partial<Config>;
}

function resolveConfigEnvVars(config: Partial<Config>): Partial<Config> {
  // Resolve env vars in string fields
  if (config.provider?.api_key) {
    config.provider.api_key = resolveEnvVars(config.provider.api_key);
  }
  if (config.provider?.base_url) {
    config.provider.base_url = resolveEnvVars(config.provider.base_url);
  }
  if (config.promptman?.api_key) {
    config.promptman.api_key = resolveEnvVars(config.promptman.api_key);
  }
  if (config.promptman?.base_url) {
    config.promptman.base_url = resolveEnvVars(config.promptman.base_url);
  }
  return config;
}

/**
 * Load config from file + CLI options + env vars, merged with defaults.
 */
export function loadConfig(cliOptions: CLIOptions): Config {
  // 1. Start with defaults
  let config: Config = structuredClone(DEFAULT_CONFIG);

  // 2. Load config file
  const configPath = cliOptions.config
    ? resolve(cliOptions.config)
    : findConfigFile(process.cwd());

  if (configPath && existsSync(configPath)) {
    const fileConfig = resolveConfigEnvVars(loadConfigFile(configPath));
    // Merge provider
    if (fileConfig.provider) {
      Object.assign(config.provider, fileConfig.provider);
    }
    // Merge settings
    if (fileConfig.settings) {
      Object.assign(config.settings, fileConfig.settings);
    }
    // Merge promptman
    if (fileConfig.promptman) {
      config.promptman = { ...{ base_url: 'https://api.promptman.dev' }, ...fileConfig.promptman } as PromptmanConfig;
    }
  }

  // 3. Apply CLI overrides
  if (cliOptions.model) config.provider.model = cliOptions.model;
  if (cliOptions.baseUrl) config.provider.base_url = cliOptions.baseUrl;
  if (cliOptions.timeout) config.settings.timeout = cliOptions.timeout;
  if (cliOptions.maxTurns) config.settings.max_turns = cliOptions.maxTurns;
  if (cliOptions.verbose) config.settings.verbose = true;

  // 4. Resolve API key from env if not set
  if (!config.provider.api_key) {
    config.provider.api_key = process.env.OPENAI_API_KEY ?? process.env.LLM_API_KEY;
  }

  // 5. Resolve promptman key from env
  if (!config.promptman?.api_key) {
    const pmKey = process.env.PROMPTMAN_API_KEY;
    if (pmKey) {
      if (!config.promptman) {
        config.promptman = { base_url: 'https://api.promptman.dev', api_key: pmKey };
      } else {
        config.promptman.api_key = pmKey;
      }
    }
  }

  return config;
}
