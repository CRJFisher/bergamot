import OpenAI from 'openai';
import * as vscode from 'vscode';
import { LlmProvider } from '../config/config_manager';
import { ClaudeAgentClient } from './claude_agent_client';
import { FakeLLMClient } from './fake_llm_client';

/**
 * Provider-neutral model role. Each client maps these to its own concrete
 * model names so callers never hardcode a vendor model id.
 */
export type ModelRole = 'fast' | 'smart';

export interface LLMClient {
  complete(prompt: string, system_prompt: string, role?: ModelRole): Promise<string>;
  complete_json<T>(prompt: string, system_prompt: string, role?: ModelRole): Promise<T>;
}

const OPENAI_MODELS: Record<ModelRole, string> = {
  fast: 'gpt-4o-mini',
  smart: 'gpt-4o',
};

export class OpenAIClient implements LLMClient {
  private openai: OpenAI;

  constructor(api_key: string) {
    this.openai = new OpenAI({ apiKey: api_key });
  }

  async complete(prompt: string, system_prompt: string, role: ModelRole = 'fast'): Promise<string> {
    const response = await this.openai.chat.completions.create({
      model: OPENAI_MODELS[role],
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0
    });

    return response.choices[0]?.message?.content || '';
  }

  async complete_json<T>(prompt: string, system_prompt: string, role: ModelRole = 'fast'): Promise<T> {
    const response = await this.openai.chat.completions.create({
      model: OPENAI_MODELS[role],
      messages: [
        { role: 'system', content: system_prompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    });

    const content = response.choices[0]?.message?.content || '{}';
    return JSON.parse(content) as T;
  }
}

/**
 * Bridges classification onto the editor's language model (Copilot). It resolves
 * a single chat model at {@link VSCodeLLMClient.initialize} and uses it for every
 * request, so the `fast`/`smart` role is not differentiated on this provider —
 * the editor exposes one model family, not a per-role pair.
 */
export class VSCodeLLMClient implements LLMClient {
  private model: vscode.LanguageModelChat | null = null;

  async initialize(model_id = 'gpt-4o'): Promise<boolean> {
    try {
      const models = await vscode.lm.selectChatModels({
        vendor: 'copilot',
        family: model_id,
      });

      if (!models || models.length === 0) {
        console.log(`No chat models found for family: ${model_id}`);
        return false;
      }

      this.model = models[0];
      return true;
    } catch (error) {
      console.log('Failed to initialize VS Code LLM:', error);
      return false;
    }
  }

  async complete(prompt: string, system_prompt: string): Promise<string> {
    if (!this.model) {
      throw new Error('VS Code LLM not initialized');
    }

    const messages = [
      new vscode.LanguageModelChatMessage(
        vscode.LanguageModelChatMessageRole.User,
        `${system_prompt}\n\n${prompt}`
      ),
    ];

    const token_source = new vscode.CancellationTokenSource();
    const response = await this.model.sendRequest(messages, {}, token_source.token);

    let full_response = '';
    for await (const chunk of response.stream) {
      full_response += (chunk as vscode.LanguageModelTextPart).value;
    }

    return full_response;
  }

  async complete_json<T>(prompt: string, system_prompt: string): Promise<T> {
    const response = await this.complete(
      prompt,
      `${system_prompt}\n\nIMPORTANT: Return only valid JSON, no markdown formatting or additional text.`
    );

    return extract_json<T>(response);
  }
}

/**
 * Scans for the first balanced top-level JSON object, tracking string literals
 * so braces inside string values do not throw off the depth count. Returns the
 * object substring, or null if none is found. More reliable than a greedy
 * `/{[\s\S]*}/` match, which over-captures when prose or a second object
 * follows the first.
 */
function find_balanced_json_object(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let in_string = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (in_string) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') in_string = false;
    } else if (ch === '"') {
      in_string = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Extracts a JSON value from a model response that may be raw JSON, fenced in a
 * ```json block, or embedded in prose. Shared by the non-OpenAI clients, which
 * have no native JSON-object response mode.
 */
export function extract_json<T>(response: string): T {
  try {
    return JSON.parse(response) as T;
  } catch {
    const markdown_json_match = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (markdown_json_match && markdown_json_match[1]) {
      return JSON.parse(markdown_json_match[1]) as T;
    }
    const balanced = find_balanced_json_object(response);
    if (balanced) {
      return JSON.parse(balanced) as T;
    }
    throw new Error('No valid JSON found in response');
  }
}

/**
 * Constructs the LLM client for the configured provider.
 *
 * `BERGAMOT_LLM=fake` short-circuits to an offline canned client — the single
 * injection point used by full-pipeline tests (and the same seam the Claude
 * move slots into).
 *
 * There is no silent cross-provider fallback: if the selected provider cannot
 * initialize, the error surfaces rather than quietly switching backends (which
 * would, for the Claude subscription, mean unexpectedly billing API credits).
 */
export async function get_llm_client(
  openai_api_key: string,
  provider: LlmProvider
): Promise<LLMClient> {
  if (process.env.BERGAMOT_LLM === 'fake') {
    return new FakeLLMClient();
  }

  switch (provider) {
    case 'claude':
      return new ClaudeAgentClient();
    case 'openai':
      return new OpenAIClient(openai_api_key);
    case 'vscode': {
      const vscode_client = new VSCodeLLMClient();
      const initialized = await vscode_client.initialize();
      if (!initialized) {
        throw new Error(
          'VS Code language model unavailable (no Copilot chat model). ' +
            'Set bergamot.llmProvider to "claude" or "openai".'
        );
      }
      return vscode_client;
    }
  }
}
