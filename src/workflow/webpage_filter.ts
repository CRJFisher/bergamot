export interface PageClassification {
  page_type: 'knowledge' | 'interactive_app' | 'aggregator' | 'leisure' | 'navigation' | 'other';
  confidence: number;
  reasoning: string;
  should_process: boolean;
}

export const PAGE_FILTER_PROMPT = `You are an expert at classifying web pages based on their content value for a personal knowledge management system.

Analyze the webpage and classify it into one of these categories:
- knowledge: Educational content, documentation, tutorials, how-to guides, technical articles, research papers
- interactive_app: Web applications, tools, dashboards, games, interactive interfaces
- aggregator: Search results, link collections, news feeds, social media timelines
- leisure: Entertainment, social media posts, memes, casual browsing content
- navigation: Home pages, about pages, contact pages, navigation menus
- other: Content that doesn't fit other categories

Also determine if this page should be processed for knowledge extraction.

Return your analysis as a JSON object with this structure:
{
  "page_type": "category",
  "confidence": 0.0-1.0,
  "reasoning": "Very brief reason (max 10 words)",
  "should_process": true/false
}

Pages that should be processed:
- Educational or informative content
- Technical documentation or tutorials
- Research papers or in-depth articles
- How-to guides or instructional content

Pages that should NOT be processed:
- Interactive web applications or tools
- Social media feeds or timelines
- Search result pages or link aggregators
- Entertainment or leisure content
- Navigation-only pages
- Login or authentication pages`;

export interface FilterConfig {
  enabled: boolean;
  allowed_types: string[];
  min_confidence: number;
  log_decisions: boolean;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  enabled: true,
  allowed_types: ['knowledge'],
  min_confidence: 0.7,
  log_decisions: true
};

export async function classify_webpage(
  url: string,
  content: string,
  llm_complete_json: <T>(prompt: string, system_prompt: string, model?: string) => Promise<T>
): Promise<PageClassification> {
  // Take first 2000 characters of content for classification
  const content_sample = content.substring(0, 2000);
  
  const prompt = `URL: ${url}\n\nContent sample:\n${content_sample}`;
  
  return await llm_complete_json<PageClassification>(
    prompt,
    PAGE_FILTER_PROMPT,
    'gpt-4o-mini'
  );
}

export function should_process_page(
  classification: PageClassification,
  config: FilterConfig
): boolean {
  if (!config.enabled) {
    return true;
  }
  
  // Check if page type is allowed
  if (!config.allowed_types.includes(classification.page_type)) {
    return false;
  }
  
  // Check confidence threshold
  if (classification.confidence < config.min_confidence) {
    return false;
  }
  
  // Use the model's recommendation
  return classification.should_process;
}

export function log_filter_decision(
  url: string,
  classification: PageClassification,
  decision: boolean,
  config: FilterConfig
): void {
  if (!config.log_decisions) {
    return;
  }
  
  const action = decision ? '✅ ACCEPTED' : '❌ FILTERED';
  console.log(`\n${action}: ${url}`);
  console.log(`  Type: ${classification.page_type} (confidence: ${classification.confidence})`);
  console.log(`  Reasoning: ${classification.reasoning}`);
}