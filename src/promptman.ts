import type { PromptmanSource, PromptmanConfig } from './types.js';

interface PromptmanResponse {
  content: string;
  title?: string;
  slug: string;
  variables?: Record<string, { name: string; description?: string }>;
}

/**
 * Fetch a prompt from the Promptman cloud API.
 */
export async function fetchPrompt(
  source: PromptmanSource,
  config: PromptmanConfig,
): Promise<string> {
  if (!config.api_key) {
    throw new Error(
      'Promptman API key required. Set PROMPTMAN_API_KEY env var or configure promptman.api_key in config.',
    );
  }

  const url = new URL(`/prompt/${encodeURIComponent(source.slug)}`, config.base_url);
  if (source.stage) {
    url.searchParams.set('stage', source.stage);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Failed to fetch prompt "${source.slug}" from Promptman: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`,
    );
  }

  const data = (await response.json()) as PromptmanResponse;
  let content = data.content;

  // Substitute variables
  if (source.variables) {
    for (const [key, value] of Object.entries(source.variables)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
  }

  return content;
}
