# promptman-test

> Local test runner for multi-turn, tool-calling LLM prompts. Think "vitest for agentic prompts."

[![npm](https://img.shields.io/npm/v/promptman-test)](https://npmjs.com/package/promptman-test)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

Define your agent's expected behavior in YAML. Run it against real LLMs with your own API keys. Get pass/fail results.

```
 promptman-test v1.0.0

 ✓ Hotel booking agent (4.2s, 2,847 tokens, ~$0.008)
 ✗ Edge case: cancellation (2.1s, 1,203 tokens, ~$0.003)
   Step 2: "Actually, cancel that"
     ✗ Expected tool call: cancel_reservation — not called

 Tests:  1 passed, 1 failed (2 total)
 Time:   6.3s
 Tokens: 4,050 (~$0.011)
```

## Why?

Testing agentic prompts today means writing janky scripts that call an LLM, parse tool calls manually, and `console.log` whether it "looks right." There's no structured way to:

- Define expected tool-calling behavior
- Mock tool responses for deterministic testing
- Assert on multi-turn conversations
- Track token usage and costs

**promptman-test** gives you a proper test framework for this. YAML-based (language-agnostic), works with any OpenAI-compatible API, and runs locally with your own keys.

## Quick Start

```bash
# Run all tests in current directory
npx promptman-test

# Run a specific test
npx promptman-test tests/booking.test.yaml

# Dry run (validate without calling LLMs)
npx promptman-test --dry-run

# Verbose output
npx promptman-test -v
```

Set your API key:

```bash
export OPENAI_API_KEY=sk-...
```

Works with any OpenAI-compatible endpoint (OpenRouter, Ollama, Together, etc.):

```bash
npx promptman-test --base-url http://localhost:11434/v1 --model llama3.2
```

## Writing Tests

Create a `*.test.yaml` file:

```yaml
name: Weather assistant calls the right tool

system_prompt: |
  You are a weather assistant. Use the get_weather tool
  to look up current conditions.

tools:
  - name: get_weather
    description: Get current weather for a location
    parameters:
      type: object
      properties:
        location:
          type: string
      required: [location]

steps:
  - user: "What's the weather in Berlin?"
    expect:
      tool_calls:
        - name: get_weather
          args:
            location: { contains: "Berlin" }
    mock:
      get_weather:
        return: { temperature: 12, condition: "Cloudy" }

  - expect:
      response:
        contains: "12"
```

### Multi-Turn Tests

Steps are sequential. Each step can have a `user` message, `expect` assertions, and `mock` responses. The framework handles the full conversation loop:

1. Sends messages to the LLM
2. If the LLM makes tool calls → checks assertions, returns mocks
3. Loops until the LLM gives a text response
4. Checks response assertions

```yaml
steps:
  - user: "Search for hotels in Maldives"
    expect:
      tool_calls:
        - name: search_hotels
    mock:
      search_hotels:
        return: [{ id: "h1", name: "Ocean Villa" }]

  - user: "Book the first one"
    expect:
      tool_calls:
        - name: create_reservation
          args:
            hotel_id: "h1"
      response:
        contains: "confirmed"
    mock:
      create_reservation:
        return: { status: "confirmed" }
```

### Steps Without User Messages

A step without `user` continues from the previous tool result — useful when the LLM needs to process tool output before responding:

```yaml
  - user: "Search hotels"
    expect:
      tool_calls:
        - name: search_hotels
    mock:
      search_hotels:
        return: [{ id: "h1", name: "Hotel A" }]

  # No user message — LLM processes the tool result
  - expect:
      response:
        contains: "Hotel A"
```

## Assertions

### Tool Call Assertions

```yaml
expect:
  tool_calls:
    - name: search_hotels              # tool was called
      args:
        destination: "Maldives"        # exact match
        destination: { contains: "Mal" }  # substring
        destination: { matches: "^Mal" }  # regex
        guests: { gte: 1, lte: 10 }   # numeric range
      count: 1                         # called exactly N times

  tool_calls_not:
    - name: delete_data                # must NOT be called
```

### Response Assertions

```yaml
expect:
  response:
    contains: "confirmed"              # substring (string or array)
    contains: ["hotel", "booked"]      # must contain ALL
    not_contains: "error"              # must not contain
    matches: "RES-\\d{5}"             # regex
    min_length: 20
    max_length: 500
```

### Global Assertions

Place at the end of your steps to assert across the entire test:

```yaml
  - assert:
      tool_order: [search, details, book]  # tools called in this order
      total_tool_calls: { gte: 3, lte: 6 }
      total_turns: { lte: 10 }
      total_tokens: { lte: 5000 }
```

## Mocks

### Simple Mock

```yaml
mock:
  search_hotels:
    return: [{ id: "h1", name: "Hotel A" }]
```

### Conditional Mocks

Return different values based on arguments:

```yaml
mock:
  search_hotels:
    - when:
        destination: { contains: "Maldives" }
      return: [{ id: "h1", name: "Ocean Villa" }]
    - when:
        destination: { contains: "Paris" }
      return: [{ id: "h2", name: "Le Grand" }]
    - default:
        return: []
```

### Error Simulation

```yaml
mock:
  search_hotels:
    error: "Service temporarily unavailable"
```

## Configuration

Create `promptman-test.config.yaml` in your project root:

```yaml
provider:
  base_url: https://api.openai.com/v1
  model: gpt-4o

settings:
  timeout: 30000
  max_turns: 20
  verbose: false
```

API keys are read from environment variables:
- `OPENAI_API_KEY` (default)
- `LLM_API_KEY` (fallback)

### Provider Examples

```yaml
# OpenAI
provider:
  base_url: https://api.openai.com/v1
  model: gpt-4o-mini

# Ollama (local)
provider:
  base_url: http://localhost:11434/v1
  model: llama3.2

# OpenRouter
provider:
  base_url: https://openrouter.ai/api/v1
  model: anthropic/claude-3.5-sonnet

# Together AI
provider:
  base_url: https://api.together.xyz/v1
  model: meta-llama/Llama-3-70b-chat-hf
```

## Promptman Cloud Integration

Optionally fetch prompts from [promptman.dev](https://promptman.dev) instead of inline:

```yaml
system_prompt:
  promptman:
    slug: my-agent-prompt
    stage: prod
    variables:
      companyName: "Acme Corp"
```

Set `PROMPTMAN_API_KEY` in your environment. [Sign up free →](https://promptman.dev)

## CLI Options

```
npx promptman-test [files...]

Options:
  -V, --version        Show version
  -c, --config <path>  Config file path
  -v, --verbose        Detailed output with full LLM responses
  --json               Machine-readable JSON output
  --model <model>      Override model for all tests
  --base-url <url>     Override provider base URL
  --timeout <ms>       Step timeout in milliseconds
  --max-turns <n>      Max conversation turns per step
  --bail               Stop on first failure
  --dry-run            Validate tests without calling LLMs
  -h, --help           Show help
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | One or more tests failed |
| 2 | Configuration or parse error |

## CI Integration

```yaml
# GitHub Actions
- name: Test prompts
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  run: npx promptman-test --json > results.json
```

```bash
# Or just check exit code
npx promptman-test --bail && echo "All good" || echo "Tests failed"
```

## Examples

See the [`examples/`](./examples) directory for complete test files:

- **[simple.test.yaml](./examples/simple.test.yaml)** — Basic single-turn tool calling
- **[multi-turn.test.yaml](./examples/multi-turn.test.yaml)** — Multi-step hotel booking flow
- **[tool-calling.test.yaml](./examples/tool-calling.test.yaml)** — Conditional tool use assertions
- **[promptman-cloud.test.yaml](./examples/promptman-cloud.test.yaml)** — Fetching prompts from Promptman cloud

## How It Works

1. **Parse** — YAML test files are validated and parsed into typed structures
2. **Resolve** — System prompts are loaded (inline or from Promptman cloud)
3. **Execute** — Each step runs through a multi-turn loop:
   - User message → LLM → tool calls? → mock responses → LLM → ... → text response
4. **Assert** — Tool calls and responses are checked against expectations
5. **Report** — Results are formatted for terminal or JSON output

The executor handles the full OpenAI chat completions protocol, including multi-round tool calling within a single step.

## License

MIT — [Promptman](https://promptman.dev)
