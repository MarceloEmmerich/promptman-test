// ── Token Counting ──────────────────────────────────────────────────────────

/**
 * Estimate token count from text. Uses a simple heuristic: ~4 chars per token.
 * This is a rough estimate — good enough for cost tracking, not for exact billing.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Average English text: ~4 characters per token for GPT models
  return Math.ceil(text.length / 4);
}

// ── Cost Estimation ─────────────────────────────────────────────────────────

interface ModelPricing {
  input: number;  // per 1M tokens
  output: number; // per 1M tokens
}

const MODEL_PRICES: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-2024-11-20': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  'o3-mini': { input: 1.10, output: 4.40 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-3-opus': { input: 15.00, output: 75.00 },
  'claude-sonnet-4': { input: 3.00, output: 15.00 },
  'claude-haiku-3.5': { input: 0.80, output: 4.00 },
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

/**
 * Estimate cost in USD for a given model and token counts.
 * Returns 0 for unknown models.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first, then prefix match
  let pricing = MODEL_PRICES[model];
  if (!pricing) {
    const key = Object.keys(MODEL_PRICES).find(k => model.startsWith(k));
    if (key) pricing = MODEL_PRICES[key];
  }
  if (!pricing) return 0;

  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/**
 * Format cost as a dollar string.
 */
export function formatCost(cost: number): string {
  if (cost === 0) return '$?.??';
  if (cost < 0.001) return '<$0.001';
  return `$${cost.toFixed(3)}`;
}

/**
 * Format milliseconds as a human-readable duration.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Resolve environment variable references in strings.
 * Supports ${VAR_NAME} syntax.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
    return process.env[name] ?? '';
  });
}

/**
 * Deep merge two objects. Source values override target.
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== undefined &&
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else if (srcVal !== undefined) {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}
