// ── Config ──────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  base_url: string;
  model: string;
  api_key?: string;
}

export interface PromptmanConfig {
  api_key?: string;
  base_url: string;
}

export interface Settings {
  timeout: number;
  max_turns: number;
  verbose: boolean;
}

export interface Config {
  provider: ProviderConfig;
  promptman?: PromptmanConfig;
  settings: Settings;
}

// ── CLI Options ─────────────────────────────────────────────────────────────

export interface CLIOptions {
  config?: string;
  verbose?: boolean;
  json?: boolean;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  maxTurns?: number;
  bail?: boolean;
  dryRun?: boolean;
}

// ── Tool Definition (OpenAI format) ─────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  format?: string;
  properties?: Record<string, ToolParameter>;
  items?: ToolParameter;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter;
}

// ── Assertions ──────────────────────────────────────────────────────────────

export interface StringAssertion {
  contains?: string;
  not_contains?: string;
  matches?: string;
  equals?: string;
}

export type ArgValue = string | number | boolean | StringAssertion | NumericAssertion;

export interface NumericAssertion {
  gte?: number;
  lte?: number;
  equals?: number;
}

export interface ToolCallAssertion {
  name: string;
  args?: Record<string, ArgValue>;
  count?: number;
}

export interface ResponseAssertion {
  contains?: string | string[];
  contains_any?: string[];
  not_contains?: string | string[];
  matches?: string;
  min_length?: number;
  max_length?: number;
}

export interface GlobalAssertion {
  tool_order?: string[];
  total_tool_calls?: NumericAssertion;
  total_turns?: NumericAssertion;
  total_tokens?: NumericAssertion;
}

export interface StepExpectation {
  tool_calls?: ToolCallAssertion[];
  tool_calls_not?: ToolCallAssertion[];
  response?: ResponseAssertion;
}

// ── Mock ────────────────────────────────────────────────────────────────────

export interface MockCondition {
  when: Record<string, ArgValue>;
  return: unknown;
}

export interface MockDefinition {
  return?: unknown;
  error?: string;
  conditions?: MockCondition[];
  default?: { return: unknown };
}

export interface StepMock {
  [toolName: string]: MockDefinition | unknown;
}

// ── Test Definition ─────────────────────────────────────────────────────────

export interface PromptmanSource {
  slug: string;
  stage?: string;
  variables?: Record<string, string>;
}

export type SystemPromptSource = string | { promptman: PromptmanSource };

export interface TestStep {
  user?: string;
  expect?: StepExpectation;
  mock?: StepMock;
  assert?: GlobalAssertion;
}

export interface TestDefinition {
  name: string;
  provider?: Partial<ProviderConfig>;
  system_prompt: SystemPromptSource;
  tools?: ToolDefinition[];
  steps: TestStep[];
}

// ── OpenAI API Types ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ── Results ─────────────────────────────────────────────────────────────────

export interface AssertionResult {
  passed: boolean;
  message: string;
}

export interface StepResult {
  stepIndex: number;
  userMessage?: string;
  assertions: AssertionResult[];
  toolCalls: ToolCall[];
  assistantResponse?: string;
  passed: boolean;
}

export interface TestResult {
  name: string;
  file: string;
  passed: boolean;
  steps: StepResult[];
  globalAssertions: AssertionResult[];
  totalTokens: number;
  estimatedCost: number;
  durationMs: number;
  error?: string;
}

export interface ProgressEvent {
  type: 'test:start' | 'step:start' | 'step:llm_call' | 'step:tool_calls' | 'step:mock_inject' | 'step:complete' | 'test:complete';
  testName: string;
  file?: string;
  stepIndex?: number;
  userMessage?: string;
  toolNames?: string[];
  step?: StepResult;
  test?: TestResult;
}

export type OnProgressCallback = (event: ProgressEvent) => void;

export interface RunResult {
  tests: TestResult[];
  summary: {
    passed: number;
    failed: number;
    total: number;
    errors: number;
  };
  tokens: {
    total: number;
    cost_usd: number;
  };
  duration_ms: number;
}
