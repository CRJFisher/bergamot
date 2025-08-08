import { PageClassification, FilterConfig, classify_webpage, should_process_page } from './webpage_filter';
import { ProceduralMemoryStore, RuleAction } from '../memory/procedural_memory_store';
import { EpisodicMemoryStore } from '../memory/episodic_memory_store';

export interface EnhancedFilterResult {
  classification: PageClassification;
  procedural_actions: RuleAction[];
  episodic_confidence_boost: number;
  final_decision: boolean;
  decision_reason: string;
  applied_rules: string[];
  tags: string[];
}

export class EnhancedWebpageFilter {
  private procedural_store: ProceduralMemoryStore;
  private episodic_store: EpisodicMemoryStore;
  private config: FilterConfig;

  constructor(
    procedural_store: ProceduralMemoryStore,
    episodic_store: EpisodicMemoryStore,
    config: FilterConfig
  ) {
    this.procedural_store = procedural_store;
    this.episodic_store = episodic_store;
    this.config = config;
  }

  async filter_webpage(
    url: string,
    title: string,
    content: string,
    llm_complete_json: <T>(prompt: string, system_prompt: string, model?: string) => Promise<T>
  ): Promise<EnhancedFilterResult> {
    // Step 1: Get base classification from LLM
    const classification = await classify_webpage(url, content, llm_complete_json);
    
    // Step 2: Create context for procedural rules
    const rule_context = {
      url,
      title,
      content: content.substring(0, 2000), // Limit content for rule evaluation
      page_type: classification.page_type,
      confidence: classification.confidence,
      timestamp: new Date().toISOString()
    };

    // Step 3: Evaluate procedural rules
    const procedural_actions = await this.procedural_store.evaluate_rules(rule_context);
    
    // Step 4: Get episodic memory confidence boost
    const episodic_boost = await this.calculate_episodic_boost(url, classification);
    
    // Step 5: Make final decision
    const result = this.make_final_decision(
      classification,
      procedural_actions,
      episodic_boost
    );

    // Step 6: Record decision in episodic memory
    await this.record_decision(url, result);

    return result;
  }

  private async calculate_episodic_boost(
    url: string,
    classification: PageClassification
  ): Promise<number> {
    // Check if similar pages have been successfully processed before
    const similar_accepted = await this.episodic_store.get_similar_decisions(
      url,
      classification.page_type,
      true // accepted
    );
    
    const similar_rejected = await this.episodic_store.get_similar_decisions(
      url,
      classification.page_type,
      false // rejected
    );

    // Calculate boost based on historical patterns
    const accept_count = similar_accepted.length;
    const reject_count = similar_rejected.length;
    const total = accept_count + reject_count;

    if (total === 0) return 0;

    // Positive boost if more accepted, negative if more rejected
    const ratio = (accept_count - reject_count) / total;
    return ratio * 0.2; // Max boost of ±0.2
  }

  private make_final_decision(
    classification: PageClassification,
    procedural_actions: RuleAction[],
    episodic_boost: number
  ): EnhancedFilterResult {
    const applied_rules: string[] = [];
    const tags: string[] = [];
    let final_decision = classification.should_process;
    let decision_reason = classification.reasoning;

    // Check for explicit accept/reject rules first
    for (const action of procedural_actions) {
      if (action.type === 'reject') {
        final_decision = false;
        decision_reason = action.reason || 'Rejected by procedural rule';
        applied_rules.push('reject_rule');
        break;
      } else if (action.type === 'accept') {
        final_decision = true;
        decision_reason = action.reason || 'Accepted by procedural rule';
        applied_rules.push('accept_rule');
        break;
      } else if (action.type === 'tag') {
        tags.push(String(action.value) || 'tagged');
        applied_rules.push('tag_rule');
      } else if (action.type === 'priority_boost') {
        // Boost confidence for priority rules
        classification.confidence = Math.min(1.0, classification.confidence + 0.1);
        applied_rules.push('priority_boost');
      }
    }

    // If no explicit accept/reject, use confidence with episodic boost
    if (!applied_rules.includes('reject_rule') && !applied_rules.includes('accept_rule')) {
      const boosted_confidence = Math.max(0, Math.min(1, classification.confidence + episodic_boost));
      
      // Check against config thresholds
      if (this.config.enabled) {
        if (!this.config.allowed_types.includes(classification.page_type)) {
          final_decision = false;
          decision_reason = `Page type ${classification.page_type} not in allowed types`;
        } else if (boosted_confidence < this.config.min_confidence) {
          final_decision = false;
          decision_reason = `Confidence ${boosted_confidence.toFixed(2)} below threshold`;
        } else {
          final_decision = true;
          decision_reason = `Accepted with confidence ${boosted_confidence.toFixed(2)}`;
        }
      }
      
      // Update classification with boosted confidence
      classification.confidence = boosted_confidence;
    }

    return {
      classification,
      procedural_actions,
      episodic_confidence_boost: episodic_boost,
      final_decision,
      decision_reason,
      applied_rules,
      tags
    };
  }

  private async record_decision(url: string, result: EnhancedFilterResult): Promise<void> {
    // Record in episodic memory for future learning
    await this.episodic_store.record_filtering_decision(
      url,
      result.classification.page_type,
      result.final_decision,
      result.classification.confidence,
      {
        reasoning: result.decision_reason,
        applied_rules: result.applied_rules,
        tags: result.tags,
        episodic_boost: result.episodic_confidence_boost
      }
    );
  }

  async get_filter_statistics(): Promise<any> {
    const procedural_stats = await this.procedural_store.get_rule_statistics();
    const episodic_stats = await this.episodic_store.get_filtering_statistics();
    
    return {
      procedural_rules: procedural_stats,
      episodic_memory: episodic_stats,
      config: this.config
    };
  }

  update_config(config: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async learn_from_feedback(
    url: string,
    was_correct: boolean,
    correct_type?: string,
    feedback?: string
  ): Promise<void> {
    // Update episodic memory with feedback
    await this.episodic_store.update_decision_feedback(
      url,
      was_correct,
      correct_type,
      feedback
    );

    // Potentially suggest new rules based on patterns
    if (!was_correct && feedback) {
      await this.suggest_new_rule(url, correct_type || 'unknown', feedback);
    }
  }

  private async suggest_new_rule(
    url: string,
    correct_type: string,
    feedback: string
  ): Promise<void> {
    // Extract domain from URL
    const domain = new URL(url).hostname;
    
    // Check if we have multiple errors from this domain
    const domain_errors = await this.episodic_store.get_domain_error_count(domain);
    
    if (domain_errors > 3) {
      // Suggest a domain rule
      console.log(`Suggestion: Create a domain rule for ${domain} to handle as ${correct_type}`);
      // Could automatically create the rule or notify user
    }
  }
}