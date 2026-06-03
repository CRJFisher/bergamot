import { LLMClient } from './openai_client';

/**
 * Offline canned LLM client for full-pipeline tests (`BERGAMOT_LLM=fake`).
 *
 * `complete_json` returns one object whose fields are a superset of every
 * structured response the pipeline destructures — classification, page
 * analysis, and tree intentions — so a single fake satisfies all call sites
 * without inspecting prompts. The classification is deliberately "knowledge"
 * with full confidence so visits pass the default filter and reach storage.
 */
const CANNED_JSON = {
  // classify_webpage → PageClassification
  page_type: 'knowledge',
  confidence: 1,
  reasoning: 'fake classification',
  should_process: true,
  // analysis → PageAnalysisWithoutPageSessionId
  title: 'Fake Title',
  summary: 'Fake summary of the page content.',
  intentions: ['fake intention'],
  // tree intentions → TreeIntentions
  page_id_to_intentions: {},
};

export class FakeLLMClient implements LLMClient {
  async complete(_prompt: string, _system_prompt: string): Promise<string> {
    return 'Fake processed content.';
  }

  async complete_json<T>(_prompt: string, _system_prompt: string): Promise<T> {
    // Round-trip yields a fresh `any`-typed object each call, which assigns to
    // the caller's T without a type assertion.
    return JSON.parse(JSON.stringify(CANNED_JSON));
  }
}
