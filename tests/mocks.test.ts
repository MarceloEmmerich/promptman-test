import { describe, it, expect } from 'vitest';
import { resolveMocks } from '../src/mocks.js';
import type { ToolCall, StepMock } from '../src/types.js';

function makeToolCall(name: string, args: Record<string, unknown>, id = 'tc_1'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('resolveMocks', () => {
  it('returns simple mock value', () => {
    const calls = [makeToolCall('search', { q: 'test' })];
    const mock: StepMock = {
      search: { return: [{ id: 1, name: 'Result' }] },
    };
    const results = resolveMocks(calls, mock);
    expect(results.get('tc_1')).toBe(JSON.stringify([{ id: 1, name: 'Result' }]));
  });

  it('returns error mock', () => {
    const calls = [makeToolCall('search', {})];
    const mock: StepMock = {
      search: { error: 'Service unavailable' },
    };
    const results = resolveMocks(calls, mock);
    expect(results.get('tc_1')).toContain('error');
    expect(results.get('tc_1')).toContain('Service unavailable');
  });

  it('returns default for undefined mock', () => {
    const calls = [makeToolCall('unknown_tool', {})];
    const results = resolveMocks(calls, undefined);
    expect(results.get('tc_1')).toContain('Mock not defined');
  });

  it('handles conditional mocks', () => {
    const calls = [makeToolCall('search', { destination: 'Maldives' })];
    const mock: StepMock = {
      search: {
        conditions: [
          { when: { destination: { contains: 'Maldives' } }, return: [{ id: 'h1' }] },
          { when: { destination: { contains: 'Paris' } }, return: [{ id: 'h2' }] },
        ],
      },
    };
    const results = resolveMocks(calls, mock);
    expect(results.get('tc_1')).toBe(JSON.stringify([{ id: 'h1' }]));
  });

  it('falls through to default in conditional mocks', () => {
    const calls = [makeToolCall('search', { destination: 'Tokyo' })];
    const mock: StepMock = {
      search: {
        conditions: [
          { when: { destination: { contains: 'Maldives' } }, return: [{ id: 'h1' }] },
        ],
        default: { return: [] },
      },
    };
    const results = resolveMocks(calls, mock);
    expect(results.get('tc_1')).toBe(JSON.stringify([]));
  });

  it('handles raw value as return', () => {
    const calls = [makeToolCall('get_time', {})];
    const mock: StepMock = {
      get_time: '14:30',
    };
    const results = resolveMocks(calls, mock);
    expect(results.get('tc_1')).toBe('14:30');
  });

  it('handles multiple tool calls', () => {
    const calls = [
      makeToolCall('search', { q: 'a' }, 'tc_1'),
      makeToolCall('details', { id: '1' }, 'tc_2'),
    ];
    const mock: StepMock = {
      search: { return: [{ id: 1 }] },
      details: { return: { name: 'Hotel A' } },
    };
    const results = resolveMocks(calls, mock);
    expect(results.size).toBe(2);
    expect(results.get('tc_1')).toBe(JSON.stringify([{ id: 1 }]));
    expect(results.get('tc_2')).toBe(JSON.stringify({ name: 'Hotel A' }));
  });
});
