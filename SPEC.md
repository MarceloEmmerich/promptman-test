# promptman-test — Local Prompt Testing Framework

## What It Is
A CLI test runner for multi-turn, tool-calling LLM prompts. Define tests in YAML, run them against real LLMs with your own API keys, get pass/fail results. Think "vitest for agentic prompts."

## Install & Run
```bash
npx promptman-test                    # run all *.test.yaml in current dir
npx promptman-test tests/             # run all tests in a directory
npx promptman-test booking.test.yaml  # run a specific file
```

## Package
- Name: `promptman-test`
- Language: TypeScript, compiled to ESM, Node.js 18+
- Zero heavy deps. Use `yaml` for parsing, native fetch for API calls, `chalk` for colors.
- Published as a single npm package with a `bin` entry.

## Config: `promptman-test.config.yaml`
```yaml
provider:
  base_url: https://api.openai.com/v1   # default, override per test
  model: gpt-4o                          # default model
  # API key from env: OPENAI_API_KEY (never in config files)

# Optional: pull prompts from promptman.dev
promptman:
  api_key: ${PROMPTMAN_API_KEY}  # env var reference
  base_url: https://api.promptman.dev

# Global settings
settings:
  timeout: 30000        # per-step timeout ms
  max_turns: 20         # safety limit
  verbose: false        # show full LLM responses
```

Can also be `promptman-test.config.yml` or `promptman-test.config.json`.

## Test File Format: `*.test.yaml`

```yaml
name: Hotel booking agent handles search and reservation

# Provider override (optional, inherits from config)
provider:
  model: gpt-4o-mini

# System prompt — inline or from promptman.dev
system_prompt: |
  You are a hotel booking assistant. You help users find and book hotels.
  Always confirm the booking details before finalizing.

# OR fetch from promptman cloud:
# system_prompt:
#   promptman:
#     slug: booking-agent
#     stage: prod

# Available tools (OpenAI function calling format)
tools:
  - name: search_hotels
    description: Search for available hotels
    parameters:
      type: object
      properties:
        destination:
          type: string
          description: City or region to search
        check_in:
          type: string
          format: date
        check_out:
          type: string
          format: date
        guests:
          type: integer
      required: [destination, check_in]

  - name: create_reservation
    description: Create a hotel reservation
    parameters:
      type: object
      properties:
        hotel_id:
          type: string
        room_type:
          type: string
        guest_name:
          type: string
      required: [hotel_id]

# Test steps — sequential turns
steps:
  - user: "Find me a hotel in Maldives for March 15-22"
    expect:
      tool_calls:
        - name: search_hotels
          args:
            destination: { contains: "Maldives" }
            check_in: "2026-03-15"
    mock:
      search_hotels:
        return:
          - { id: "h1", name: "Ocean Villa", rating: 4.8, price: 450 }
          - { id: "h2", name: "Beach Resort", rating: 4.2, price: 280 }

  - user: "Book the best rated one for John Smith"
    expect:
      tool_calls:
        - name: create_reservation
          args:
            hotel_id: "h1"
      response:
        contains: ["Ocean Villa", "confirmed"]
        not_contains: ["error", "sorry"]
    mock:
      create_reservation:
        return: { confirmation: "RES-12345", status: "confirmed" }

  # No user message = assistant continues from tool result
  - expect:
      response:
        contains: "RES-12345"

  # Verify tool call ordering across the whole test
  - assert:
      tool_order: [search_hotels, create_reservation]
      total_tool_calls: { gte: 2, lte: 4 }
```

## Assertion Types

### On tool_calls (per step):
```yaml
tool_calls:
  - name: search_hotels                    # tool was called
    args:
      destination: "Maldives"              # exact match
      destination: { contains: "Mal" }     # substring
      destination: { matches: "^Mal" }     # regex
      destination: { not_contains: "X" }   # negative substring
      guests: { gte: 1, lte: 10 }         # numeric range
    count: 1                               # called exactly once (optional)
  - name: create_reservation               # second tool call
```

### tool_calls_not:
```yaml
tool_calls_not:
  - name: delete_reservation   # this tool must NOT be called
```

### On response (assistant's text reply):
```yaml
response:
  contains: "confirmed"                     # substring (string or array)
  not_contains: "error"                     # must not contain
  matches: "RES-\\d{5}"                    # regex
  min_length: 20                            # minimum length
  max_length: 500                           # maximum length
```

### Global assertions (at end of test):
```yaml
- assert:
    tool_order: [search_hotels, create_reservation]  # ordered sequence
    total_tool_calls: { gte: 2, lte: 5 }
    total_turns: { lte: 6 }
    total_tokens: { lte: 5000 }            # token budget check
```

## Mock Strategies

### Simple: return same value regardless of args
```yaml
mock:
  search_hotels:
    return: [{ id: "h1", name: "Hotel A" }]
```

### Conditional: return based on args
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

### Error simulation:
```yaml
mock:
  search_hotels:
    error: "Service temporarily unavailable"
```

## Promptman Cloud Integration

When `PROMPTMAN_API_KEY` is set and system_prompt uses `promptman:` block:

```yaml
system_prompt:
  promptman:
    slug: booking-agent
    stage: prod           # optional, defaults to latest draft
```

The CLI fetches the prompt from `GET https://api.promptman.dev/prompt/booking-agent?stage=prod` with the API key as Bearer token.

Variables in the prompt ({{variableName}}) can be filled:
```yaml
system_prompt:
  promptman:
    slug: booking-agent
    stage: prod
    variables:
      companyName: "Acme Hotels"
      language: "English"
```

## CLI Output

### Default (compact):
```
 promptman-test v1.0.0

 ✓ Hotel booking agent handles search and reservation (4.2s, 2847 tokens, ~$0.008)
 ✗ Edge case: user cancels mid-booking (2.1s, 1203 tokens, ~$0.003)
   Step 2: "Actually, cancel that"
     ✗ Expected tool call: cancel_reservation — not called
     ✗ Response should contain "cancelled" — got: "I've completed your booking!"

 Tests:  1 passed, 1 failed (2 total)
 Time:   6.3s
 Tokens: 4,050 (~$0.011)
```

### Verbose (`--verbose` or `-v`):
Shows full LLM responses, all tool calls with args, mock returns.

### JSON output (`--json`):
Machine-readable results for CI integration.
```json
{
  "tests": [...],
  "summary": { "passed": 1, "failed": 1, "total": 2 },
  "tokens": { "total": 4050, "cost_usd": 0.011 },
  "duration_ms": 6300
}
```

## CLI Flags
```
npx promptman-test [files/dirs...]

Options:
  -c, --config <path>    Config file path (default: promptman-test.config.yaml)
  -v, --verbose          Show detailed output including full LLM responses
  --json                 Output results as JSON
  --model <model>        Override model for all tests
  --base-url <url>       Override provider base URL
  --timeout <ms>         Override step timeout
  --max-turns <n>        Override max turns safety limit
  --bail                 Stop on first failure
  --dry-run              Parse and validate test files without running
  -h, --help             Show help
  --version              Show version
```

## Exit Codes
- 0: All tests passed
- 1: One or more tests failed
- 2: Configuration/parse error

## File Structure (the npm package)
```
promptman-test/
├── src/
│   ├── index.ts          # CLI entry point
│   ├── runner.ts         # Test runner orchestration
│   ├── executor.ts       # Multi-turn LLM execution loop
│   ├── assertions.ts     # Assertion evaluation engine
│   ├── mocks.ts          # Mock response resolution
│   ├── parser.ts         # YAML test file parser + validation
│   ├── config.ts         # Config loading + merging
│   ├── promptman.ts      # Promptman cloud API client
│   ├── reporter.ts       # Terminal output formatting
│   ├── types.ts          # TypeScript interfaces
│   └── utils.ts          # Helpers (token counting, cost estimation)
├── tests/                # Internal tests for the framework itself
│   ├── parser.test.ts
│   ├── assertions.test.ts
│   ├── mocks.test.ts
│   └── executor.test.ts
├── examples/
│   ├── simple.test.yaml
│   ├── multi-turn.test.yaml
│   ├── tool-calling.test.yaml
│   └── promptman-cloud.test.yaml
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE                # MIT
└── .gitignore
```

## Implementation Notes
- Use native `fetch` (Node 18+) for all HTTP calls
- OpenAI chat completions API format — works with OpenAI, Anthropic (via proxy), Ollama, OpenRouter, any compatible endpoint
- Token counting: use `tiktoken` for accurate counts, fall back to word-based estimate
- Cost estimation: hardcoded table of known model prices, skip for unknown models
- Promptman API: simple GET with Bearer token, graceful error if unavailable
- YAML parsing: use `yaml` package (not js-yaml, it's older)
- Colors: use `chalk`
- No test framework dependency — the CLI IS the test framework
- The internal tests (for the framework itself) use `vitest`
