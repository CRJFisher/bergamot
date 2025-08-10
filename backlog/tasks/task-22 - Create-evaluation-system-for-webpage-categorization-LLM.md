---
id: task-22
title: Create evaluation system for webpage categorization LLM
status: To Do
assignee: []
created_date: "2025-08-10 19:33"
labels:
  - evaluation
  - llm
  - testing
  - quality
dependencies: []
---

## Description

Design and implement a comprehensive evaluation system for the LLM-based webpage categorization that filters out non-knowledge pages. This includes researching best practices, collecting a diverse test dataset, establishing ground truth labels, evaluating current performance, and iteratively improving the prompt based on systematic evaluation results.

## Acceptance Criteria

- [ ] Research completed on LLM evaluation best practices
- [ ] Test dataset collected with 50+ examples per category (300+ total)
- [ ] Ground truth labels established with clear criteria
- [ ] Inter-annotator agreement measured (if multiple labelers)
- [ ] Evaluation metrics implemented (accuracy precision recall F1 confusion matrix)
- [ ] Baseline performance measured on current prompt
- [ ] Edge cases and ambiguous examples documented
- [ ] Prompt improvements tested and validated
- [ ] Evaluation framework code created for ongoing monitoring
- [ ] Performance report with recommendations
- [ ] Continuous monitoring strategy defined

## Implementation Plan

### Phase 1: Research and Planning (Completed)

Key findings from LLM evaluation research:

- Use F1 score and confusion matrices for multi-class classification
- Minimum 50-100 examples per category for reliable metrics
- Implement confidence scores for uncertain classifications
- Use validation set for prompt optimization, keep test set untouched
- Consider tools like Langfuse or LangSmith for ongoing monitoring

### Phase 2: Dataset Collection

#### Categories to Cover (6 primary + edge cases):

1. **Knowledge** - Educational content, documentation, tutorials
2. **Interactive_app** - Web applications, tools, dashboards
3. **Aggregator** - Search results, link collections, news feeds
4. **Leisure** - Entertainment, casual browsing
5. **Navigation** - Home pages, menus, sitemaps
6. **Other** - Miscellaneous content

#### Sources for Test Data:

- **Aggregators**: Reddit, HackerNews, Google Search, Twitter/X feeds
- **Emails**: Gmail, Outlook web (privacy-safe examples)
- **Blogs**: Medium, Substack, personal blogs, tech blogs
- **Forums**: Stack Overflow, Discord web, Discourse forums
- **Wikis**: Wikipedia, Fandom wikis, documentation wikis
- **Social Media**: LinkedIn, Facebook, Instagram web
- **Knowledge**: ArXiv, documentation sites, tutorials
- **Apps**: Google Docs, Figma, online calculators
- **Grey Areas**:
  - GitHub repos (code vs documentation)
  - YouTube videos (education vs entertainment)
  - News articles (knowledge vs aggregation)
  - Product pages (navigation vs knowledge)

#### Dataset Structure:

```json
{
  "url": "https://example.com/page",
  "content_sample": "First 2000 chars...",
  "ground_truth": "knowledge",
  "confidence": 0.9,
  "reasoning": "Why this classification",
  "edge_case": false,
  "notes": "Any ambiguity notes"
}
```

### Phase 3: Labeling Strategy

1. **Create Labeling Guidelines**:

   - Clear criteria for each category
   - Decision tree for ambiguous cases
   - Examples of each category

2. **Labeling Process**:

   - Start with clear examples (high confidence)
   - Add edge cases progressively
   - Document reasoning for difficult cases
   - If possible, get 2-3 people to label independently

3. **Quality Checks**:
   - Measure inter-annotator agreement (Cohen's kappa)
   - Resolve disagreements through discussion
   - Create "gold standard" test set

### Phase 4: Evaluation Implementation

```python
# Core evaluation metrics to implement
class WebpageCategorizationEvaluator:
    def evaluate(self, predictions, ground_truth):
        return {
            'accuracy': accuracy_score(ground_truth, predictions),
            'f1_weighted': f1_score(ground_truth, predictions, average='weighted'),
            'per_class_metrics': classification_report(ground_truth, predictions),
            'confusion_matrix': confusion_matrix(ground_truth, predictions)
        }

    def analyze_errors(self, confusion_matrix):
        # Identify most common misclassifications
        # Suggest prompt improvements
        pass
```

### Phase 5: Baseline Evaluation

1. Run current prompt on test dataset
2. Calculate baseline metrics:
   - Overall accuracy (target: 85%+)
   - Per-category F1 (target: 70%+ each)
   - Confusion matrix analysis
3. Identify systematic errors

### Phase 6: Prompt Optimization

Based on error analysis:

1. **Common Improvements**:

   - Add more specific examples in prompt
   - Clarify category boundaries
   - Add chain-of-thought reasoning
   - Include confidence scoring

2. **Iterative Testing**:

   - Test on validation set (not test set)
   - A/B test prompt variations
   - Focus on worst-performing categories

3. **Avoid Overfitting**:
   - Don't add test set examples to prompt
   - Keep prompt general, not specific to test cases
   - Validate on held-out data

### Phase 7: Continuous Monitoring

1. **Production Metrics**:

   - Track classification distribution over time
   - Monitor confidence scores
   - Detect drift in webpage types

2. **Feedback Loop**:

   - Collect user corrections
   - Periodic re-evaluation
   - Prompt version control

3. **Automation**:
   - Weekly evaluation runs
   - Alert on performance drops
   - Dashboard for metrics visualization

## Success Metrics

- **Primary**: 85%+ overall accuracy on test set
- **Secondary**: 70%+ F1 score for each category
- **Edge Cases**: 60%+ accuracy on ambiguous examples
- **Confidence**: High-confidence predictions 90%+ accurate
- **Stability**: <5% performance variance week-to-week

## Tools and Resources

- **Evaluation Framework**: Consider Langfuse or custom solution
- **Dataset Storage**: JSON or CSV with version control
- **Metrics Visualization**: Matplotlib/Seaborn for confusion matrices
- **Statistical Analysis**: Scikit-learn for metrics calculation
