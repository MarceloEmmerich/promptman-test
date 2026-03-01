import type {
  AssertionResult,
  StepExpectation,
  GlobalAssertion,
  ToolCall,
  ArgValue,
  NumericAssertion,
  ResponseAssertion,
  ToolCallAssertion,
} from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ok(message: string): AssertionResult {
  return { passed: true, message };
}

function fail(message: string): AssertionResult {
  return { passed: false, message };
}

function checkArgValue(actual: unknown, expected: ArgValue, path: string): AssertionResult {
  // Primitive comparison
  if (typeof expected === 'string') {
    return String(actual) === expected
      ? ok(`${path} = "${expected}"`)
      : fail(`${path}: expected "${expected}", got "${actual}"`);
  }

  if (typeof expected === 'number') {
    return Number(actual) === expected
      ? ok(`${path} = ${expected}`)
      : fail(`${path}: expected ${expected}, got ${actual}`);
  }

  if (typeof expected === 'boolean') {
    return actual === expected
      ? ok(`${path} = ${expected}`)
      : fail(`${path}: expected ${expected}, got ${actual}`);
  }

  // Object assertion
  if (typeof expected === 'object' && expected !== null) {
    const assertion = expected as Record<string, unknown>;
    const actualStr = String(actual ?? '');
    const actualNum = Number(actual);

    if ('equals' in assertion) {
      return String(actual) === String(assertion.equals)
        ? ok(`${path} equals "${assertion.equals}"`)
        : fail(`${path}: expected equals "${assertion.equals}", got "${actual}"`);
    }

    if ('contains' in assertion) {
      const needle = String(assertion.contains);
      return actualStr.includes(needle)
        ? ok(`${path} contains "${needle}"`)
        : fail(`${path}: expected to contain "${needle}", got "${actualStr}"`);
    }

    if ('not_contains' in assertion) {
      const needle = String(assertion.not_contains);
      return !actualStr.includes(needle)
        ? ok(`${path} does not contain "${needle}"`)
        : fail(`${path}: expected NOT to contain "${needle}", but it does`);
    }

    if ('matches' in assertion) {
      const pattern = String(assertion.matches);
      const re = new RegExp(pattern);
      return re.test(actualStr)
        ? ok(`${path} matches /${pattern}/`)
        : fail(`${path}: expected to match /${pattern}/, got "${actualStr}"`);
    }

    if ('gte' in assertion || 'lte' in assertion) {
      const results: AssertionResult[] = [];
      if ('gte' in assertion) {
        results.push(
          actualNum >= Number(assertion.gte)
            ? ok(`${path} >= ${assertion.gte}`)
            : fail(`${path}: expected >= ${assertion.gte}, got ${actualNum}`),
        );
      }
      if ('lte' in assertion) {
        results.push(
          actualNum <= Number(assertion.lte)
            ? ok(`${path} <= ${assertion.lte}`)
            : fail(`${path}: expected <= ${assertion.lte}, got ${actualNum}`),
        );
      }
      const failed = results.find(r => !r.passed);
      return failed ?? results[0] ?? ok(`${path} in range`);
    }
  }

  return fail(`${path}: unsupported assertion type`);
}

function checkNumeric(actual: number, assertion: NumericAssertion, label: string): AssertionResult[] {
  const results: AssertionResult[] = [];
  if (assertion.gte !== undefined) {
    results.push(
      actual >= assertion.gte
        ? ok(`${label} >= ${assertion.gte} (got ${actual})`)
        : fail(`${label}: expected >= ${assertion.gte}, got ${actual}`),
    );
  }
  if (assertion.lte !== undefined) {
    results.push(
      actual <= assertion.lte
        ? ok(`${label} <= ${assertion.lte} (got ${actual})`)
        : fail(`${label}: expected <= ${assertion.lte}, got ${actual}`),
    );
  }
  if (assertion.equals !== undefined) {
    results.push(
      actual === assertion.equals
        ? ok(`${label} = ${assertion.equals}`)
        : fail(`${label}: expected ${assertion.equals}, got ${actual}`),
    );
  }
  return results;
}

// ── Tool Call Assertions ────────────────────────────────────────────────────

function evaluateToolCallAssertion(
  expected: ToolCallAssertion,
  actualCalls: ToolCall[],
): AssertionResult[] {
  const results: AssertionResult[] = [];

  // Find matching calls by name
  const matching = actualCalls.filter(c => c.function.name === expected.name);

  if (matching.length === 0) {
    results.push(fail(`Expected tool call: ${expected.name} — not called`));
    return results;
  }

  results.push(ok(`Called ${expected.name}`));

  // Check count if specified
  if (expected.count !== undefined) {
    results.push(
      matching.length === expected.count
        ? ok(`${expected.name} called ${expected.count} time(s)`)
        : fail(`${expected.name}: expected ${expected.count} call(s), got ${matching.length}`),
    );
  }

  // Check args on the first matching call (or all if count matters)
  if (expected.args) {
    const call = matching[0]!;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      results.push(fail(`${expected.name}: could not parse arguments as JSON`));
      return results;
    }

    for (const [key, expectedValue] of Object.entries(expected.args)) {
      results.push(checkArgValue(args[key], expectedValue as ArgValue, `Args match: ${key}`));
    }
  }

  return results;
}

function evaluateToolCallsNot(
  notExpected: ToolCallAssertion[],
  actualCalls: ToolCall[],
): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (const not of notExpected) {
    const found = actualCalls.some(c => c.function.name === not.name);
    results.push(
      found
        ? fail(`Tool ${not.name} should NOT have been called`)
        : ok(`Tool ${not.name} was not called (correct)`),
    );
  }
  return results;
}

// ── Response Assertions ─────────────────────────────────────────────────────

function evaluateResponseAssertion(
  expected: ResponseAssertion,
  actual: string,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (expected.contains) {
    const needles = Array.isArray(expected.contains) ? expected.contains : [expected.contains];
    for (const needle of needles) {
      results.push(
        actual.includes(needle)
          ? ok(`Response contains "${needle}"`)
          : fail(`Response should contain "${needle}" — got: "${actual.slice(0, 100)}${actual.length > 100 ? '...' : ''}"`),
      );
    }
  }

  if (expected.contains_any) {
    const found = expected.contains_any.some(needle => actual.includes(needle));
    results.push(
      found
        ? ok(`Response contains one of: ${expected.contains_any.map(n => `"${n}"`).join(', ')}`)
        : fail(`Response should contain one of: ${expected.contains_any.map(n => `"${n}"`).join(', ')} — got: "${actual.slice(0, 100)}${actual.length > 100 ? '...' : ''}"`),
    );
  }

  if (expected.not_contains) {
    const needles = Array.isArray(expected.not_contains) ? expected.not_contains : [expected.not_contains];
    for (const needle of needles) {
      results.push(
        !actual.includes(needle)
          ? ok(`Response does not contain "${needle}"`)
          : fail(`Response should NOT contain "${needle}"`),
      );
    }
  }

  if (expected.matches) {
    const re = new RegExp(expected.matches);
    results.push(
      re.test(actual)
        ? ok(`Response matches /${expected.matches}/`)
        : fail(`Response should match /${expected.matches}/ — got: "${actual.slice(0, 100)}"`),
    );
  }

  if (expected.min_length !== undefined) {
    results.push(
      actual.length >= expected.min_length
        ? ok(`Response length >= ${expected.min_length}`)
        : fail(`Response too short: ${actual.length} < ${expected.min_length}`),
    );
  }

  if (expected.max_length !== undefined) {
    results.push(
      actual.length <= expected.max_length
        ? ok(`Response length <= ${expected.max_length}`)
        : fail(`Response too long: ${actual.length} > ${expected.max_length}`),
    );
  }

  return results;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Evaluate step-level assertions (tool calls + response).
 */
export function evaluateStepAssertions(
  expect: StepExpectation | undefined,
  toolCalls: ToolCall[],
  response: string | undefined,
): AssertionResult[] {
  if (!expect) return [];
  const results: AssertionResult[] = [];

  if (expect.tool_calls) {
    for (const tc of expect.tool_calls) {
      results.push(...evaluateToolCallAssertion(tc, toolCalls));
    }
  }

  if (expect.tool_calls_not) {
    results.push(...evaluateToolCallsNot(expect.tool_calls_not, toolCalls));
  }

  if (expect.response && response) {
    results.push(...evaluateResponseAssertion(expect.response, response));
  } else if (expect.response && !response) {
    results.push(fail('Expected a text response but got none'));
  }

  return results;
}

/**
 * Evaluate global assertions (across the whole test).
 */
export function evaluateGlobalAssertions(
  assert: GlobalAssertion,
  allToolCalls: ToolCall[],
  totalTurns: number,
  totalTokens: number,
): AssertionResult[] {
  const results: AssertionResult[] = [];

  if (assert.tool_order) {
    const calledNames = allToolCalls.map(c => c.function.name);
    let orderIndex = 0;
    let orderOk = true;
    for (const expected of assert.tool_order) {
      const foundAt = calledNames.indexOf(expected, orderIndex);
      if (foundAt === -1) {
        results.push(fail(`Tool order: expected ${expected} after position ${orderIndex}, not found`));
        orderOk = false;
        break;
      }
      orderIndex = foundAt + 1;
    }
    if (orderOk) {
      results.push(ok(`Tool order: ${assert.tool_order.join(' → ')}`));
    }
  }

  if (assert.total_tool_calls) {
    results.push(...checkNumeric(allToolCalls.length, assert.total_tool_calls, 'Total tool calls'));
  }

  if (assert.total_turns) {
    results.push(...checkNumeric(totalTurns, assert.total_turns, 'Total turns'));
  }

  if (assert.total_tokens) {
    results.push(...checkNumeric(totalTokens, assert.total_tokens, 'Total tokens'));
  }

  return results;
}
