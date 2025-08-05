# Agent Memory Research and Design for Webpage Filtering

## Overview

This document synthesizes research on agent memory patterns from cognitive science, AI research, and practical implementations like LangGraph. It proposes a design for implementing agent memory in our webpage filtering system.

## Three Types of Agent Memory

### 1. Semantic Memory (General Knowledge)

- **Definition**: Long-term storage of general facts, concepts, and relationships
- **In AI**: Knowledge graphs, embeddings, trained model weights
- **For Filtering**: Understanding what types of content are "knowledge" vs "leisure"
- **Implementation**: Store learned patterns about page types and their characteristics

### 2. Episodic Memory (Specific Events)

- **Definition**: Memory of specific experiences and events with temporal context
- **In AI**: Few-shot examples, conversation history, user interactions
- **For Filtering**: Remember specific pages and user's feedback on them
- **Implementation**: Store user corrections with full context (URL, content sample, decision)

### 3. Procedural Memory (How-To Knowledge)

- **Definition**: Memory of how to perform tasks, skills, and procedures
- **In AI**: Learned policies, action sequences, tool usage patterns
- **For Filtering**: How to apply user preferences, custom rules, exceptions
- **Implementation**: Store user-defined rules and filtering procedures

## Additional Memory Patterns from Research

### 4. Working Memory (Short-Term)

- **Definition**: Temporary storage for current task processing
- **In AI**: Current conversation context, active task state
- **For Filtering**: Pages being processed in current session
- **Implementation**: In-memory cache of recent decisions

### 5. Associative Memory

- **Definition**: Memory retrieval based on associations and similarity
- **In AI**: Vector similarity search, attention mechanisms
- **For Filtering**: Find similar pages to apply learned patterns
- **Implementation**: Embedding-based similarity search

### 6. Meta-Memory (Memory about Memory)

- **Definition**: Knowledge about what the system knows and doesn't know
- **In AI**: Confidence scores, uncertainty estimation
- **For Filtering**: Track confidence in classifications, areas needing more examples
- **Implementation**: Confidence tracking and active learning

## Design for Webpage Filtering Memory System

### Memory Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Interface                        │
│        (Markdown Feedback Document + VS Code)            │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                 Memory Controller                        │
│   - Coordinates all memory types                        │
│   - Handles feedback processing                         │
│   - Manages memory retrieval                           │
└──────┬──────────┬──────────┬──────────┬───────────────┘
       │          │          │          │
┌──────▼────┐ ┌──▼────┐ ┌──▼────┐ ┌──▼──────┐
│ Semantic  │ │ Epis. │ │ Proc. │ │ Working │
│  Memory   │ │Memory │ │Memory │ │ Memory  │
└───────────┘ └───────┘ └───────┘ └─────────┘
       │          │          │          │
┌──────▼──────────▼──────────▼──────────▼────────────────┐
│              Persistent Storage Layer                   │
│         (DuckDB + LanceDB Vector Store)                │
└─────────────────────────────────────────────────────────┘
```

### Implementation Strategy

#### Phase 1: Episodic Memory (User Feedback)

- Store user corrections as examples
- Each correction includes:
  - URL and domain
  - Content sample
  - Original classification
  - User's correction
  - Timestamp
  - User's optional explanation

#### Phase 2: Procedural Memory (Custom Rules)

- Allow users to define rules:
  - Domain-specific rules (always/never process)
  - Content pattern rules (keywords, structures)
  - Time-based rules (ignore pages older than X)
- Store as structured procedures

#### Phase 3: Semantic Memory (Pattern Learning)

- Extract patterns from episodic memories
- Learn domain characteristics
- Build concept relationships
- Update confidence scores

#### Phase 4: Associative Retrieval

- When classifying new pages:
  - Find similar past examples
  - Apply learned patterns
  - Combine with base model judgment
  - Track confidence

### Feedback Collection Mechanism

#### Interactive Markdown Document

```markdown
# Webpage Filtering Review - [Date Range]

## Summary
- Pages Processed: X
- Pages Filtered: Y
- Confidence Average: Z%

## Recent Decisions

### ✅ Accepted Pages

#### 1. [Page Title](url)
- **Type**: knowledge (confidence: 0.9)
- **Reasoning**: Technical documentation
- **Processed**: 2024-01-15 10:30 AM

❌ **Mark as incorrect** | 💭 **Add note**

---

### 🚫 Filtered Pages

#### 1. [Page Title](url)
- **Type**: interactive_app (confidence: 0.95)
- **Reasoning**: Web application dashboard
- **Filtered**: 2024-01-15 10:25 AM

✅ **Should have processed** | 💭 **Add note**

---

## Custom Rules

### Domain Rules
- ✅ Always process: docs.*.com, *.edu
- ❌ Never process: social.*.com, *.facebook.com

[Add new rule...]

### Content Rules
- Contains "tutorial" → likely knowledge
- Contains "dashboard" → likely app

[Add new rule...]
```

### Memory Storage Schema

#### Episodic Memory Entry

```typescript
interface EpisodicMemory {
  id: string;
  timestamp: Date;
  url: string;
  domain: string;
  page_type: string;
  confidence: number;
  original_decision: boolean;
  user_correction?: {
    corrected_decision: boolean;
    corrected_type?: string;
    explanation?: string;
    feedback_timestamp: Date;
  };
  content_features: {
    title: string;
    content_sample: string;
    word_count: number;
    has_code_blocks: boolean;
    link_density: number;
  };
}
```

#### Procedural Memory Entry

```typescript
interface ProceduralRule {
  id: string;
  type: 'domain' | 'content' | 'composite';
  condition: {
    field: string;
    operator: 'contains' | 'equals' | 'matches' | 'gt' | 'lt';
    value: any;
  };
  action: 'accept' | 'reject' | 'boost_confidence' | 'reduce_confidence';
  priority: number;
  created_by: 'user' | 'system';
  created_at: Date;
  enabled: boolean;
}
```

### Active Learning Strategy

1. **Uncertainty Sampling**: Flag low-confidence decisions for review
2. **Diversity Sampling**: Request feedback on new types of content
3. **Error-Driven**: Prioritize pages similar to past corrections
4. **Temporal Decay**: Give more weight to recent feedback

### Memory Retrieval for Classification

When classifying a new page:

```typescript
async function classify_with_memory(url: string, content: string) {
  // 1. Get similar episodes from memory
  const similar_episodes = await episodic_memory.find_similar(url, content, limit=5);
  
  // 2. Apply procedural rules
  const rule_results = await procedural_memory.apply_rules(url, content);
  
  // 3. Get base model classification
  const base_classification = await classify_webpage(url, content);
  
  // 4. Combine with memory-based adjustments
  const final_classification = combine_classifications(
    base_classification,
    similar_episodes,
    rule_results
  );
  
  // 5. Track meta-memory (confidence, uncertainty)
  await meta_memory.record_classification(url, final_classification);
  
  return final_classification;
}
```

## Benefits of This Approach

1. **Personalization**: System adapts to individual user's definition of "knowledge"
2. **Transparency**: Users can see why decisions were made and correct them
3. **Continuous Learning**: Improves over time with feedback
4. **Explainability**: Can show which memories influenced decisions
5. **Control**: Users can add explicit rules for edge cases

## Implementation Priorities

1. **MVP**: Episodic memory with simple feedback collection
2. **V2**: Add procedural rules and domain preferences  
3. **V3**: Implement associative retrieval and pattern learning
4. **V4**: Add meta-memory and active learning

## Technical Considerations

- Use DuckDB for structured memory storage
- Use LanceDB for vector similarity search
- Keep working memory in-process for speed
- Implement memory cleanup/compression for old entries
- Add memory export/import for backup and sharing
