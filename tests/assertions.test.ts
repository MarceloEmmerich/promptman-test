import { describe, it, expect } from 'vitest';
import { evaluateStepAssertions, evaluateGlobalAssertions } from '../src/assertions.js';
import type { ToolCall, StepExpectation, GlobalAssertion } from '../src/types.js';

function makeToolCall(name: string, args: Record<string, unknown>, id = 'tc_1'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('evaluateStepAssertions', () => {
  describe('tool_calls', () => {
    it('passes when expected tool is called', () => {
      const calls = [makeToolCall('search', { q: 'test' })];
      const expect_: StepExpectation = { tool_calls: [{ name: 'search' }] };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('fails when expected tool is not called', () => {
      const calls = [makeToolCall('other', {})];
      const expect_: StepExpectation = { tool_calls: [{ name: 'search' }] };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.some(r => !r.passed)).toBe(true);
    });

    it('checks exact arg match', () => {
      const calls = [makeToolCall('search', { destination: 'Maldives' })];
      const expect_: StepExpectation = {
        tool_calls: [{ name: 'search', args: { destination: 'Maldives' } }],
      };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('checks contains arg match', () => {
      const calls = [makeToolCall('search', { destination: 'Maldives Islands' })];
      const expect_: StepExpectation = {
        tool_calls: [{ name: 'search', args: { destination: { contains: 'Maldives' } } }],
      };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('checks regex arg match', () => {
      const calls = [makeToolCall('search', { date: '2026-03-15' })];
      const expect_: StepExpectation = {
        tool_calls: [{ name: 'search', args: { date: { matches: '^2026-\\d{2}-\\d{2}$' } } }],
      };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('checks numeric range', () => {
      const calls = [makeToolCall('search', { guests: 3 })];
      const expect_: StepExpectation = {
        tool_calls: [{ name: 'search', args: { guests: { gte: 1, lte: 5 } } }],
      };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('fails numeric range out of bounds', () => {
      const calls = [makeToolCall('search', { guests: 10 })];
      const expect_: StepExpectation = {
        tool_calls: [{ name: 'search', args: { guests: { gte: 1, lte: 5 } } }],
      };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.some(r => !r.passed)).toBe(true);
    });

    it('checks count', () => {
      const calls = [
        makeToolCall('search', { q: 'a' }, 'tc_1'),
        makeToolCall('search', { q: 'b' }, 'tc_2'),
      ];
      const expect_: StepExpectation = {
        tool_calls: [{ name: 'search', count: 2 }],
      };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });
  });

  describe('tool_calls_not', () => {
    it('passes when forbidden tool is not called', () => {
      const calls = [makeToolCall('search', {})];
      const expect_: StepExpectation = { tool_calls_not: [{ name: 'delete' }] };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('fails when forbidden tool is called', () => {
      const calls = [makeToolCall('delete', {})];
      const expect_: StepExpectation = { tool_calls_not: [{ name: 'delete' }] };
      const results = evaluateStepAssertions(expect_, calls, undefined);
      expect(results.some(r => !r.passed)).toBe(true);
    });
  });

  describe('response', () => {
    it('checks contains string', () => {
      const expect_: StepExpectation = { response: { contains: 'hello' } };
      const results = evaluateStepAssertions(expect_, [], 'hello world');
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('checks contains array (all must match)', () => {
      const expect_: StepExpectation = { response: { contains: ['hello', 'world'] } };
      const results = evaluateStepAssertions(expect_, [], 'hello world');
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('fails contains when missing', () => {
      const expect_: StepExpectation = { response: { contains: 'xyz' } };
      const results = evaluateStepAssertions(expect_, [], 'hello world');
      expect(results.some(r => !r.passed)).toBe(true);
    });

    it('checks not_contains', () => {
      const expect_: StepExpectation = { response: { not_contains: 'error' } };
      const results = evaluateStepAssertions(expect_, [], 'all good');
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('checks regex matches', () => {
      const expect_: StepExpectation = { response: { matches: 'RES-\\d+' } };
      const results = evaluateStepAssertions(expect_, [], 'Your confirmation: RES-12345');
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('checks min_length', () => {
      const expect_: StepExpectation = { response: { min_length: 5 } };
      const results = evaluateStepAssertions(expect_, [], 'hi');
      expect(results.some(r => !r.passed)).toBe(true);
    });

    it('checks max_length', () => {
      const expect_: StepExpectation = { response: { max_length: 10 } };
      const results = evaluateStepAssertions(expect_, [], 'this is a very long response');
      expect(results.some(r => !r.passed)).toBe(true);
    });

    it('fails when no response but response expected', () => {
      const expect_: StepExpectation = { response: { contains: 'hello' } };
      const results = evaluateStepAssertions(expect_, [], undefined);
      expect(results.some(r => !r.passed)).toBe(true);
    });
  });

  it('returns empty for undefined expect', () => {
    const results = evaluateStepAssertions(undefined, [], 'hello');
    expect(results).toHaveLength(0);
  });
});

describe('evaluateGlobalAssertions', () => {
  it('checks tool_order', () => {
    const calls = [
      makeToolCall('search', {}, 'tc_1'),
      makeToolCall('details', {}, 'tc_2'),
      makeToolCall('book', {}, 'tc_3'),
    ];
    const assert_: GlobalAssertion = { tool_order: ['search', 'details', 'book'] };
    const results = evaluateGlobalAssertions(assert_, calls, 3, 1000);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('fails wrong tool_order', () => {
    const calls = [
      makeToolCall('book', {}, 'tc_1'),
      makeToolCall('search', {}, 'tc_2'),
    ];
    const assert_: GlobalAssertion = { tool_order: ['search', 'book'] };
    const results = evaluateGlobalAssertions(assert_, calls, 2, 500);
    // search appears after book, so order check should still pass since search is at index 1 and book would need to be after
    // Actually: we look for 'search' first (found at index 1), then 'book' after index 1 — not found → fail
    expect(results.some(r => !r.passed)).toBe(true);
  });

  it('checks total_tool_calls', () => {
    const calls = [makeToolCall('a', {}, '1'), makeToolCall('b', {}, '2')];
    const assert_: GlobalAssertion = { total_tool_calls: { gte: 2, lte: 5 } };
    const results = evaluateGlobalAssertions(assert_, calls, 2, 500);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('checks total_turns', () => {
    const assert_: GlobalAssertion = { total_turns: { lte: 10 } };
    const results = evaluateGlobalAssertions(assert_, [], 5, 1000);
    expect(results.every(r => r.passed)).toBe(true);
  });

  it('checks total_tokens', () => {
    const assert_: GlobalAssertion = { total_tokens: { lte: 5000 } };
    const results = evaluateGlobalAssertions(assert_, [], 3, 3000);
    expect(results.every(r => r.passed)).toBe(true);
  });
});
