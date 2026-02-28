import { describe, it, expect } from 'vitest';
import { parseTestFile } from '../src/parser.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function writeTempYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pmt-'));
  const file = join(dir, 'test.test.yaml');
  writeFileSync(file, content);
  return file;
}

describe('parseTestFile', () => {
  it('parses a valid test file', () => {
    const file = writeTempYaml(`
name: Test
system_prompt: You are helpful
tools:
  - name: greet
    description: Say hello
    parameters:
      type: object
      properties:
        name:
          type: string
steps:
  - user: "Hi"
    expect:
      response:
        contains: "hello"
`);
    const result = parseTestFile(file);
    expect(result.name).toBe('Test');
    expect(result.system_prompt).toBe('You are helpful');
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe('greet');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]!.user).toBe('Hi');
  });

  it('throws on missing name', () => {
    const file = writeTempYaml(`
system_prompt: test
steps:
  - user: "hi"
`);
    expect(() => parseTestFile(file)).toThrow('name');
  });

  it('throws on missing system_prompt', () => {
    const file = writeTempYaml(`
name: Test
steps:
  - user: "hi"
`);
    expect(() => parseTestFile(file)).toThrow('system_prompt');
  });

  it('throws on missing steps', () => {
    const file = writeTempYaml(`
name: Test
system_prompt: test
`);
    expect(() => parseTestFile(file)).toThrow('steps');
  });

  it('throws on empty steps', () => {
    const file = writeTempYaml(`
name: Test
system_prompt: test
steps: []
`);
    expect(() => parseTestFile(file)).toThrow('steps');
  });

  it('parses promptman source', () => {
    const file = writeTempYaml(`
name: Test
system_prompt:
  promptman:
    slug: my-prompt
    stage: prod
    variables:
      company: Acme
steps:
  - user: "hi"
    expect:
      response:
        contains: "hello"
`);
    const result = parseTestFile(file);
    expect(typeof result.system_prompt).toBe('object');
    const src = result.system_prompt as { promptman: { slug: string; stage: string; variables: Record<string, string> } };
    expect(src.promptman.slug).toBe('my-prompt');
    expect(src.promptman.stage).toBe('prod');
    expect(src.promptman.variables?.company).toBe('Acme');
  });

  it('parses mocks with conditional syntax', () => {
    const file = writeTempYaml(`
name: Test
system_prompt: test
steps:
  - user: "search"
    mock:
      search:
        - when:
            q: { contains: "hello" }
          return: [1, 2, 3]
        - default:
            return: []
`);
    const result = parseTestFile(file);
    const mock = result.steps[0]!.mock;
    expect(mock).toBeDefined();
    expect(mock!.search).toBeDefined();
  });

  it('parses assert steps', () => {
    const file = writeTempYaml(`
name: Test
system_prompt: test
steps:
  - user: "hi"
    expect:
      response:
        contains: "hello"
  - assert:
      tool_order: [search, book]
      total_tool_calls:
        gte: 2
`);
    const result = parseTestFile(file);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1]!.assert).toBeDefined();
    expect(result.steps[1]!.assert!.tool_order).toEqual(['search', 'book']);
  });
});
