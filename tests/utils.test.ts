import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateCost, formatCost, formatDuration, resolveEnvVars, deepMerge } from '../src/utils.js';

describe('estimateTokens', () => {
  it('estimates tokens from text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('estimateCost', () => {
  it('calculates cost for known model', () => {
    const cost = estimateCost('gpt-4o', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it('returns 0 for unknown model', () => {
    expect(estimateCost('unknown-model-xyz', 1000, 500)).toBe(0);
  });

  it('matches prefix for versioned models', () => {
    const cost = estimateCost('gpt-4o-2024-11-20', 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });
});

describe('formatCost', () => {
  it('formats zero as unknown', () => {
    expect(formatCost(0)).toBe('$?.??');
  });

  it('formats small costs', () => {
    expect(formatCost(0.0001)).toBe('<$0.001');
  });

  it('formats normal costs', () => {
    expect(formatCost(0.015)).toBe('$0.015');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(4200)).toBe('4.2s');
  });
});

describe('resolveEnvVars', () => {
  it('resolves env vars', () => {
    process.env.TEST_VAR_XYZ = 'hello';
    expect(resolveEnvVars('${TEST_VAR_XYZ}')).toBe('hello');
    delete process.env.TEST_VAR_XYZ;
  });

  it('returns empty for missing vars', () => {
    expect(resolveEnvVars('${NONEXISTENT_VAR_12345}')).toBe('');
  });
});

describe('deepMerge', () => {
  it('merges nested objects', () => {
    const target = { a: { b: 1, c: 2 }, d: 3 };
    const source = { a: { b: 10 } };
    const result = deepMerge(target, source);
    expect(result.a.b).toBe(10);
    expect(result.a.c).toBe(2);
    expect(result.d).toBe(3);
  });

  it('overrides with source values', () => {
    const result = deepMerge({ a: 1 }, { a: 2 });
    expect(result.a).toBe(2);
  });
});
