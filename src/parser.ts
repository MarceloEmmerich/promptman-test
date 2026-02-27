import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { TestDefinition, TestStep, ToolDefinition, MockDefinition, StepMock, ArgValue } from './types.js';

class ParseError extends Error {
  constructor(file: string, message: string) {
    super(`[${file}] ${message}`);
    this.name = 'ParseError';
  }
}

/**
 * Normalize raw mock YAML into our MockDefinition structure.
 * Handles both simple `return:` and conditional `when:` arrays.
 */
function normalizeMock(raw: unknown): MockDefinition {
  if (raw === null || raw === undefined) {
    return { return: null };
  }

  // If it's an array, check if items have `when` keys (conditional mock)
  if (Array.isArray(raw)) {
    const hasWhen = raw.some((item: unknown) =>
      typeof item === 'object' && item !== null && 'when' in item
    );
    if (hasWhen) {
      const conditions = raw
        .filter((item: unknown) => typeof item === 'object' && item !== null && 'when' in item)
        .map((item: Record<string, unknown>) => ({
          when: item.when as Record<string, ArgValue>,
          return: item.return,
        }));
      const defaultItem = raw.find(
        (item: unknown) => typeof item === 'object' && item !== null && 'default' in item
      ) as Record<string, unknown> | undefined;
      return {
        conditions,
        default: defaultItem
          ? { return: (defaultItem.default as Record<string, unknown>)?.return ?? defaultItem.default }
          : undefined,
      };
    }
    // Plain array = direct return value
    return { return: raw };
  }

  // If it's an object with `return`, `error`, or `when` keys
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if ('error' in obj) return { error: String(obj.error) };
    if ('return' in obj) return { return: obj.return };
    // Otherwise treat the whole object as the return value
    return { return: raw };
  }

  // Primitive value = direct return
  return { return: raw };
}

function normalizeStepMocks(raw: Record<string, unknown> | undefined): StepMock | undefined {
  if (!raw) return undefined;
  const result: StepMock = {};
  for (const [toolName, mockValue] of Object.entries(raw)) {
    result[toolName] = normalizeMock(mockValue);
  }
  return result;
}

function validateTool(tool: unknown, file: string, index: number): ToolDefinition {
  if (typeof tool !== 'object' || tool === null) {
    throw new ParseError(file, `tools[${index}] must be an object`);
  }
  const t = tool as Record<string, unknown>;
  if (!t.name || typeof t.name !== 'string') {
    throw new ParseError(file, `tools[${index}].name is required and must be a string`);
  }
  return {
    name: t.name,
    description: (t.description as string) ?? '',
    parameters: (t.parameters as ToolDefinition['parameters']) ?? { type: 'object', properties: {} },
  };
}

function validateStep(step: unknown, file: string, index: number): TestStep {
  if (typeof step !== 'object' || step === null) {
    throw new ParseError(file, `steps[${index}] must be an object`);
  }
  const s = step as Record<string, unknown>;

  // A step must have at least one of: user, expect, assert, mock
  if (!s.user && !s.expect && !s.assert && !s.mock) {
    throw new ParseError(file, `steps[${index}] must have at least one of: user, expect, assert`);
  }

  return {
    user: s.user as string | undefined,
    expect: s.expect as TestStep['expect'],
    mock: normalizeStepMocks(s.mock as Record<string, unknown> | undefined),
    assert: s.assert as TestStep['assert'],
  };
}

/**
 * Parse a YAML test file into a validated TestDefinition.
 */
export function parseTestFile(filePath: string): TestDefinition {
  const content = readFileSync(filePath, 'utf-8');
  let raw: Record<string, unknown>;

  try {
    raw = parseYaml(content) as Record<string, unknown>;
  } catch (err) {
    throw new ParseError(filePath, `Invalid YAML: ${(err as Error).message}`);
  }

  if (!raw || typeof raw !== 'object') {
    throw new ParseError(filePath, 'Test file must be a YAML object');
  }

  // Validate required fields
  if (!raw.name || typeof raw.name !== 'string') {
    throw new ParseError(filePath, '"name" is required and must be a string');
  }

  if (!raw.system_prompt) {
    throw new ParseError(filePath, '"system_prompt" is required');
  }

  if (!raw.steps || !Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new ParseError(filePath, '"steps" is required and must be a non-empty array');
  }

  // Parse tools
  const tools: ToolDefinition[] = [];
  if (raw.tools && Array.isArray(raw.tools)) {
    for (let i = 0; i < raw.tools.length; i++) {
      tools.push(validateTool(raw.tools[i], filePath, i));
    }
  }

  // Parse steps
  const steps: TestStep[] = [];
  for (let i = 0; i < raw.steps.length; i++) {
    steps.push(validateStep(raw.steps[i], filePath, i));
  }

  return {
    name: raw.name as string,
    provider: raw.provider as TestDefinition['provider'],
    system_prompt: raw.system_prompt as TestDefinition['system_prompt'],
    tools,
    steps,
  };
}
