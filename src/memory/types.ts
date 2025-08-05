// Agent memory type definitions

export interface EpisodicMemory {
  id: string;
  timestamp: Date;
  url: string;
  domain: string;
  page_type: string;
  confidence: number;
  original_decision: boolean;
  reasoning: string; // Brief reason from LLM (<10 words)
  user_correction?: UserCorrection;
  content_features: ContentFeatures;
  embedding?: number[]; // For similarity search
}

export interface UserCorrection {
  corrected_decision: boolean;
  corrected_type?: string;
  explanation?: string;
  feedback_timestamp: Date;
}

export interface ContentFeatures {
  title: string;
  content_sample: string;
  word_count: number;
  has_code_blocks: boolean;
  link_density: number;
  meta_description?: string;
}

export interface ProceduralRule {
  id: string;
  type: 'domain' | 'content' | 'composite';
  condition: RuleCondition;
  action: RuleAction;
  priority: number;
  created_by: 'user' | 'system';
  created_at: Date;
  enabled: boolean;
  examples?: string[]; // URLs that match this rule
}

export interface RuleCondition {
  field: string;
  operator: 'contains' | 'equals' | 'matches' | 'gt' | 'lt' | 'starts_with' | 'ends_with';
  value: any;
  case_sensitive?: boolean;
}

export type RuleAction = 
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'boost_confidence'; amount: number }
  | { type: 'reduce_confidence'; amount: number }
  | { type: 'override_type'; page_type: string };

export interface MemorySearchOptions {
  limit?: number;
  similarity_threshold?: number;
  time_range?: {
    start: Date;
    end: Date;
  };
  include_corrections_only?: boolean;
}

export interface ClassificationWithMemory {
  base_classification: {
    page_type: string;
    confidence: number;
    should_process: boolean;
  };
  memory_adjustments: {
    similar_episodes: EpisodicMemory[];
    applied_rules: ProceduralRule[];
    confidence_adjustment: number;
    type_override?: string;
    decision_override?: boolean;
    influenced_by: string[];
  };
  final_classification: {
    page_type: string;
    confidence: number;
    should_process: boolean;
    reasoning: string;
    influenced_by: string[]; // IDs of memories/rules that influenced decision
  };
}