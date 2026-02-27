import type { StepMock, MockDefinition, ArgValue, ToolCall } from './types.js';

/**
 * Check if a value matches an arg assertion.
 */
function matchesArgValue(actual: unknown, expected: ArgValue): boolean {
  if (expected === null || expected === undefined) return true;

  // Primitive comparison
  if (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean') {
    return String(actual) === String(expected);
  }

  // Object assertion (contains, matches, gte, lte, equals)
  if (typeof expected === 'object' && expected !== null) {
    const assertion = expected as Record<string, unknown>;
    const actualStr = String(actual ?? '');
    const actualNum = Number(actual);

    if ('equals' in assertion) {
      return String(actual) === String(assertion.equals);
    }
    if ('contains' in assertion) {
      return actualStr.includes(String(assertion.contains));
    }
    if ('matches' in assertion) {
      return new RegExp(String(assertion.matches)).test(actualStr);
    }
    if ('not_contains' in assertion) {
      return !actualStr.includes(String(assertion.not_contains));
    }
    if ('gte' in assertion || 'lte' in assertion) {
      if ('gte' in assertion && actualNum < Number(assertion.gte)) return false;
      if ('lte' in assertion && actualNum > Number(assertion.lte)) return false;
      return true;
    }
  }

  return false;
}

/**
 * Check if a tool call's args match a condition.
 */
function argsMatchCondition(toolCallArgs: Record<string, unknown>, condition: Record<string, ArgValue>): boolean {
  for (const [key, expected] of Object.entries(condition)) {
    if (!matchesArgValue(toolCallArgs[key], expected)) return false;
  }
  return true;
}

/**
 * Resolve a mock definition for a given tool call.
 * Returns the mock response value or throws if the tool has no mock.
 */
function resolveMockDefinition(mock: MockDefinition, args: Record<string, unknown>): unknown {
  // Error mock
  if (mock.error) {
    return { error: mock.error };
  }

  // Conditional mocks
  if (mock.conditions && mock.conditions.length > 0) {
    for (const condition of mock.conditions) {
      if (argsMatchCondition(args, condition.when as Record<string, ArgValue>)) {
        return condition.return;
      }
    }
    // Fall through to default
    if (mock.default) {
      return mock.default.return;
    }
    return { error: `No matching mock condition for args: ${JSON.stringify(args)}` };
  }

  // Simple return
  if ('return' in mock) {
    return mock.return;
  }

  return null;
}

/**
 * Resolve mock responses for a set of tool calls from the current step's mocks.
 * Returns a map of tool_call_id → response content string.
 */
export function resolveMocks(
  toolCalls: ToolCall[],
  stepMock: StepMock | undefined,
): Map<string, string> {
  const results = new Map<string, string>();

  for (const call of toolCalls) {
    const toolName = call.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      // malformed args, use empty
    }

    let response: unknown = { result: `Mock not defined for tool: ${toolName}` };

    if (stepMock && toolName in stepMock) {
      const mockDef = stepMock[toolName];

      // If it's already a MockDefinition object (has return/error/conditions)
      if (
        typeof mockDef === 'object' &&
        mockDef !== null &&
        ('return' in (mockDef as Record<string, unknown>) ||
          'error' in (mockDef as Record<string, unknown>) ||
          'conditions' in (mockDef as Record<string, unknown>))
      ) {
        response = resolveMockDefinition(mockDef as MockDefinition, args);
      } else {
        // Treat the raw value as the return value directly
        response = mockDef;
      }
    }

    const content = typeof response === 'string' ? response : JSON.stringify(response);
    results.set(call.id, content);
  }

  return results;
}
