import { EpisodicMemoryStore } from './episodic_memory_store';
import { EpisodicMemory, ClassificationWithMemory } from './types';
import { 
  PageClassification, 
  classify_webpage as base_classify_webpage,
  should_process_page,
  FilterConfig
} from '../workflow/webpage_filter';

export class MemoryEnhancedClassifier {
  private episodic_store: EpisodicMemoryStore;
  private confidence_boost_per_similar_correction = 0.1;
  private confidence_penalty_per_different_correction = 0.05;

  constructor(episodic_store: EpisodicMemoryStore) {
    this.episodic_store = episodic_store;
  }

  async classify_with_memory(
    url: string,
    content: string,
    llm_complete_json: <T>(prompt: string, system_prompt: string, model?: string) => Promise<T>,
    filter_config: FilterConfig
  ): Promise<ClassificationWithMemory> {
    // Get base classification from the model
    const base_classification = await base_classify_webpage(url, content, llm_complete_json);
    
    // Find similar episodes from memory
    const similar_episodes = await this.episodic_store.find_similar_episodes(
      url,
      content,
      { limit: 5 }
    );
    
    // Also check for same domain episodes
    const domain = new URL(url).hostname;
    const domain_episodes = await this.episodic_store.get_episodes_by_domain(domain);
    
    // Apply memory-based adjustments
    const memory_adjustments = this.calculate_memory_adjustments(
      base_classification,
      similar_episodes,
      domain_episodes
    );
    
    // Calculate final classification
    const final_classification = this.apply_memory_adjustments(
      base_classification,
      memory_adjustments,
      filter_config
    );
    
    return {
      base_classification,
      memory_adjustments: {
        ...memory_adjustments,
        similar_episodes,
        applied_rules: [], // Will be populated when we implement procedural memory
        influenced_by: memory_adjustments.influenced_by
      },
      final_classification
    };
  }

  private calculate_memory_adjustments(
    base_classification: PageClassification,
    similar_episodes: EpisodicMemory[],
    domain_episodes: EpisodicMemory[]
  ): {
    confidence_adjustment: number;
    type_override?: string;
    decision_override?: boolean;
    influenced_by: string[];
  } {
    let confidence_adjustment = 0;
    let type_override: string | undefined;
    let decision_override: boolean | undefined;
    const influenced_by: string[] = [];

    // Check for corrected episodes that are similar
    const corrected_similar = similar_episodes.filter(e => e.user_correction);
    
    for (const episode of corrected_similar) {
      influenced_by.push(episode.id);
      
      // If user corrected a similar page's decision
      if (episode.user_correction!.corrected_decision !== episode.original_decision) {
        // Check if the correction would apply to this classification
        if (base_classification.should_process !== episode.user_correction!.corrected_decision) {
          confidence_adjustment -= this.confidence_penalty_per_different_correction;
          
          // Strong signal: multiple corrections in the same direction
          const same_correction_count = corrected_similar.filter(
            e => e.user_correction?.corrected_decision === episode.user_correction!.corrected_decision
          ).length;
          
          if (same_correction_count >= 2) {
            decision_override = episode.user_correction!.corrected_decision;
          }
        }
      }
      
      // If user corrected the type
      if (episode.user_correction!.corrected_type) {
        type_override = episode.user_correction!.corrected_type;
      }
    }

    // Check domain-specific patterns
    const domain_corrections = domain_episodes.filter(e => e.user_correction);
    if (domain_corrections.length >= 3) {
      // Strong domain pattern detected
      const accept_count = domain_corrections.filter(
        e => e.user_correction!.corrected_decision === true
      ).length;
      const reject_count = domain_corrections.length - accept_count;
      
      if (accept_count > reject_count * 2) {
        // Strong accept pattern for this domain
        confidence_adjustment += 0.2;
        if (base_classification.should_process === false) {
          decision_override = true;
        }
      } else if (reject_count > accept_count * 2) {
        // Strong reject pattern for this domain
        confidence_adjustment -= 0.2;
        if (base_classification.should_process === true) {
          decision_override = false;
        }
      }
    }

    return {
      confidence_adjustment,
      type_override,
      decision_override,
      influenced_by
    };
  }

  private apply_memory_adjustments(
    base_classification: PageClassification,
    adjustments: {
      confidence_adjustment: number;
      type_override?: string;
      decision_override?: boolean;
      influenced_by: string[];
    },
    filter_config: FilterConfig
  ): {
    page_type: string;
    confidence: number;
    should_process: boolean;
    reasoning: string;
    influenced_by: string[];
  } {
    // Apply adjustments
    const adjusted_confidence = Math.max(0, Math.min(1, 
      base_classification.confidence + adjustments.confidence_adjustment
    ));
    
    const final_type = (adjustments.type_override || base_classification.page_type) as PageClassification['page_type'];
    
    // Determine final decision
    let final_decision: boolean;
    if (adjustments.decision_override !== undefined) {
      final_decision = adjustments.decision_override;
    } else {
      // Re-evaluate with adjusted confidence
      const adjusted_classification = {
        ...base_classification,
        page_type: final_type,
        confidence: adjusted_confidence
      };
      final_decision = should_process_page(adjusted_classification as PageClassification, filter_config);
    }
    
    // Build reasoning
    const reasoning_parts = [base_classification.reasoning];
    if (adjustments.influenced_by.length > 0) {
      reasoning_parts.push(
        `Adjusted based on ${adjustments.influenced_by.length} similar past episodes`
      );
    }
    if (adjustments.type_override) {
      reasoning_parts.push(`Type corrected to ${adjustments.type_override} based on user feedback`);
    }
    if (adjustments.decision_override !== undefined) {
      reasoning_parts.push(`Decision overridden based on consistent user corrections`);
    }
    if (Math.abs(adjustments.confidence_adjustment) > 0.01) {
      reasoning_parts.push(
        `Confidence ${adjustments.confidence_adjustment > 0 ? 'boosted' : 'reduced'} by ${
          Math.abs(adjustments.confidence_adjustment).toFixed(2)
        }`
      );
    }
    
    return {
      page_type: final_type,
      confidence: adjusted_confidence,
      should_process: final_decision,
      reasoning: reasoning_parts.join('. '),
      influenced_by: adjustments.influenced_by
    };
  }

  async store_classification_episode(
    url: string,
    classification: ClassificationWithMemory,
    content_features: {
      title: string;
      content_sample: string;
      word_count: number;
      has_code_blocks: boolean;
      link_density: number;
      meta_description?: string;
    },
    content_for_embedding: string
  ): Promise<string> {
    return await this.episodic_store.store_episode(
      url,
      classification.final_classification.page_type,
      classification.final_classification.confidence,
      classification.final_classification.should_process,
      classification.final_classification.reasoning,
      content_features,
      content_for_embedding
    );
  }
}