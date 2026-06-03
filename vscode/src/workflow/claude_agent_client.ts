import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { LLMClient, ModelRole, extract_json } from './openai_client';

/**
 * LLM client backed by the user's Claude subscription via the Claude Agent SDK
 * (no API tokens). Each call is a single-turn, tool-less query — the SDK is used
 * purely as a completion endpoint, not an agent.
 */
const CLAUDE_MODELS: Record<ModelRole, string> = {
  fast: 'haiku',
  smart: 'sonnet',
};

// The SDK ships ESM-only. The extension compiles to CommonJS, so it is loaded
// via a genuine dynamic `import()` — a static import would break the CJS loader
// (and jest) at module-eval time. `new Function` prevents TypeScript from
// down-levelling the `import()` into a `require()`. The static `import type`
// above is erased at compile time, so it adds no runtime dependency.
type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');
const import_sdk = new Function('m', 'return import(m)') as (m: string) => Promise<SdkModule>;

/**
 * The child `claude` process inherits `process.env` by default. If
 * `ANTHROPIC_API_KEY` is present it silently overrides subscription OAuth and
 * bills API credits — exactly what the zero-token setup must avoid — so it is
 * scrubbed from the environment passed to the SDK.
 */
function scrubbed_env(): Record<string, string | undefined> {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export class ClaudeAgentClient implements LLMClient {
  private async run(prompt: string, system_prompt: string, role: ModelRole): Promise<string> {
    const { query } = await import_sdk('@anthropic-ai/claude-agent-sdk');

    const options: Options = {
      systemPrompt: system_prompt,
      model: CLAUDE_MODELS[role],
      maxTurns: 1,
      allowedTools: [],
      settingSources: [],
      env: scrubbed_env(),
    };

    let result = '';
    for await (const message of query({ prompt, options })) {
      if (message.type === 'result' && message.subtype === 'success') {
        result = message.result;
      }
    }
    return result;
  }

  async complete(prompt: string, system_prompt: string, role: ModelRole = 'fast'): Promise<string> {
    return this.run(prompt, system_prompt, role);
  }

  async complete_json<T>(prompt: string, system_prompt: string, role: ModelRole = 'fast'): Promise<T> {
    // The SDK has no JSON-object response mode, so steer toward raw JSON and
    // extract defensively (the model may still fence or wrap it).
    const response = await this.run(
      prompt,
      `${system_prompt}\n\nIMPORTANT: Return only valid JSON, no markdown formatting or additional text.`,
      role
    );
    return extract_json<T>(response);
  }
}
