import type {
  Config,
  TestDefinition,
  TestStep,
  TestResult,
  StepResult,
  ChatMessage,
  ToolCall,
  ChatCompletionResponse,
  ToolDefinition,
  AssertionResult,
  SystemPromptSource,
  OnProgressCallback,
  ProgressEvent,
} from './types.js';
import { evaluateStepAssertions, evaluateGlobalAssertions } from './assertions.js';
import { resolveMocks } from './mocks.js';
import { fetchPrompt } from './promptman.js';
import { estimateTokens, estimateCost } from './utils.js';

// ── OpenAI API ──────────────────────────────────────────────────────────────

function buildToolsPayload(tools: ToolDefinition[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}> {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

async function callLLM(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  config: Config,
  testProvider?: Partial<Config['provider']>,
): Promise<ChatCompletionResponse> {
  const baseUrl = testProvider?.base_url ?? config.provider.base_url;
  const model = testProvider?.model ?? config.provider.model;
  const apiKey = testProvider?.api_key ?? config.provider.api_key;

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages,
  };

  if (tools.length > 0) {
    body.tools = buildToolsPayload(tools);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.settings.timeout),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(
      `LLM API error: ${response.status} ${response.statusText}${errorBody ? ` — ${errorBody.slice(0, 500)}` : ''}`,
    );
  }

  return (await response.json()) as ChatCompletionResponse;
}

// ── System Prompt Resolution ────────────────────────────────────────────────

async function resolveSystemPrompt(
  source: SystemPromptSource,
  config: Config,
): Promise<string> {
  if (typeof source === 'string') {
    return source;
  }

  if ('promptman' in source) {
    if (!config.promptman) {
      throw new Error('Promptman config required to fetch remote prompts. Set PROMPTMAN_API_KEY.');
    }
    return fetchPrompt(source.promptman, config.promptman);
  }

  throw new Error('Invalid system_prompt format');
}

// ── Executor ────────────────────────────────────────────────────────────────

/**
 * Execute a single test definition against the LLM.
 * Runs the multi-turn loop, evaluates assertions, returns results.
 */
export interface ExecuteOptions {
  onProgress?: OnProgressCallback;
}

export async function executeTest(
  test: TestDefinition,
  config: Config,
  filePath: string,
  options?: ExecuteOptions,
): Promise<TestResult> {
  const startTime = Date.now();
  const allToolCalls: ToolCall[] = [];
  const stepResults: StepResult[] = [];
  const globalAssertions: AssertionResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTurns = 0;

  try {
    const emit = (event: Omit<ProgressEvent, 'testName'>) =>
      options?.onProgress?.({ ...event, testName: test.name } as ProgressEvent);

    emit({ type: 'test:start', file: filePath });

    // Resolve system prompt
    const systemPrompt = await resolveSystemPrompt(test.system_prompt, config);

    // Build initial messages
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Process each step
    for (let stepIdx = 0; stepIdx < test.steps.length; stepIdx++) {
      const step = test.steps[stepIdx]!;

      // If this is a global assertion step, evaluate it at the end
      if (step.assert && !step.user && !step.expect) {
        continue; // Will be processed after all steps
      }

      // Add user message if present
      if (step.user) {
        messages.push({ role: 'user', content: step.user });
      }

      emit({ type: 'step:start', stepIndex: stepIdx, userMessage: step.user });

      const stepToolCalls: ToolCall[] = [];
      let assistantResponse: string | undefined;
      let turnCount = 0;

      // Multi-turn loop for this step
      while (turnCount < config.settings.max_turns) {
        totalTurns++;
        turnCount++;

        emit({ type: 'step:llm_call', stepIndex: stepIdx });

        const completion = await callLLM(messages, test.tools ?? [], config, test.provider);

        // Track tokens
        if (completion.usage) {
          totalInputTokens += completion.usage.prompt_tokens;
          totalOutputTokens += completion.usage.completion_tokens;
        } else {
          // Estimate if API doesn't return usage
          const msgText = messages.map(m => m.content ?? '').join(' ');
          totalInputTokens += estimateTokens(msgText);
        }

        const choice = completion.choices[0];
        if (!choice) {
          throw new Error('No response from LLM');
        }

        const msg = choice.message;

        // If the assistant made tool calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Add assistant message with tool calls to conversation
          messages.push({
            role: 'assistant',
            content: msg.content,
            tool_calls: msg.tool_calls,
          });

          stepToolCalls.push(...msg.tool_calls);
          allToolCalls.push(...msg.tool_calls);

          emit({
            type: 'step:tool_calls',
            stepIndex: stepIdx,
            toolNames: msg.tool_calls.map(tc => tc.function.name),
          });

          if (completion.usage) {
            totalOutputTokens += estimateTokens(JSON.stringify(msg.tool_calls));
          }

          // Resolve mocks and add tool results
          const mockResults = resolveMocks(msg.tool_calls, step.mock);

          for (const toolCall of msg.tool_calls) {
            const mockContent = mockResults.get(toolCall.id) ?? JSON.stringify({ result: 'ok' });
            messages.push({
              role: 'tool',
              content: mockContent,
              tool_call_id: toolCall.id,
            });
          }

          emit({ type: 'step:mock_inject', stepIndex: stepIdx });

          // Continue the loop — let the LLM process tool results
          continue;
        }

        // If the assistant gave a text response (no tool calls), step is done
        if (msg.content) {
          assistantResponse = msg.content;
          messages.push({ role: 'assistant', content: msg.content });

          if (!completion.usage) {
            totalOutputTokens += estimateTokens(msg.content);
          }
        }

        break; // Exit the multi-turn loop for this step
      }

      // Evaluate step assertions
      const assertions = evaluateStepAssertions(step.expect, stepToolCalls, assistantResponse);

      const stepResult: StepResult = {
        stepIndex: stepIdx,
        userMessage: step.user,
        assertions,
        toolCalls: stepToolCalls,
        assistantResponse,
        passed: assertions.every(a => a.passed),
      };

      stepResults.push(stepResult);
      emit({ type: 'step:complete', stepIndex: stepIdx, step: stepResult });
    }

    // Process global assertion steps
    for (const step of test.steps) {
      if (step.assert) {
        const results = evaluateGlobalAssertions(
          step.assert,
          allToolCalls,
          totalTurns,
          totalInputTokens + totalOutputTokens,
        );
        globalAssertions.push(...results);
      }
    }

    const totalTokens = totalInputTokens + totalOutputTokens;
    const model = test.provider?.model ?? config.provider.model;
    const cost = estimateCost(model, totalInputTokens, totalOutputTokens);

    return {
      name: test.name,
      file: filePath,
      passed: stepResults.every(s => s.passed) && globalAssertions.every(a => a.passed),
      steps: stepResults,
      globalAssertions,
      totalTokens,
      estimatedCost: cost,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      name: test.name,
      file: filePath,
      passed: false,
      steps: stepResults,
      globalAssertions,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCost: 0,
      durationMs: Date.now() - startTime,
      error: (error as Error).message,
    };
  }
}
