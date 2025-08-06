import { EnhancedWebpageFilter } from '../enhanced_webpage_filter';
import { ProceduralMemoryStore } from '../../memory/procedural_memory_store';
import { EpisodicMemoryStore } from '../../memory/episodic_memory_store';
import { DuckDB } from '../../duck_db';
import { LanceDBMemoryStore } from '../../agent_memory';
import { FilterConfig } from '../webpage_filter';
import * as path from 'path';
import * as fs from 'fs';

describe('EnhancedWebpageFilter', () => {
  let enhanced_filter: EnhancedWebpageFilter;
  let procedural_store: ProceduralMemoryStore;
  let episodic_store: EpisodicMemoryStore;
  let duck_db: DuckDB;
  let memory_db: LanceDBMemoryStore;
  
  const test_db_path = path.join(__dirname, 'test_enhanced_filter.db');
  const test_memory_path = path.join(__dirname, 'test_memory');

  const filter_config: FilterConfig = {
    enabled: true,
    allowed_types: ['knowledge'],
    min_confidence: 0.7,
    log_decisions: false
  };

  const mock_llm_complete_json = jest.fn();

  beforeEach(async () => {
    // Clean up any existing test databases
    if (fs.existsSync(test_db_path)) {
      fs.unlinkSync(test_db_path);
    }
    if (fs.existsSync(test_memory_path)) {
      fs.rmSync(test_memory_path, { recursive: true, force: true });
    }

    duck_db = new DuckDB({ database_path: test_db_path });
    await duck_db.init();

    memory_db = new LanceDBMemoryStore(test_memory_path);
    await memory_db.initialize();
    
    procedural_store = new ProceduralMemoryStore(duck_db);
    await procedural_store.initialize();
    
    episodic_store = new EpisodicMemoryStore(duck_db, memory_db);
    await episodic_store.initialize();

    enhanced_filter = new EnhancedWebpageFilter(
      procedural_store,
      episodic_store,
      filter_config
    );

    // Reset mock
    mock_llm_complete_json.mockClear();
  });

  afterEach(async () => {
    await duck_db.close();
    if (fs.existsSync(test_db_path)) {
      fs.unlinkSync(test_db_path);
    }
    if (fs.existsSync(test_memory_path)) {
      fs.rmSync(test_memory_path, { recursive: true, force: true });
    }
  });

  describe('Basic Filtering', () => {
    it('should classify and filter a webpage', async () => {
      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.85,
        reasoning: 'Technical documentation',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://docs.example.com/api',
        'API Documentation',
        'This is the API documentation for our service...',
        mock_llm_complete_json
      );

      expect(result.classification.page_type).toBe('knowledge');
      expect(result.classification.confidence).toBe(0.85);
      expect(result.final_decision).toBe(true);
      expect(result.decision_reason).toContain('Accepted');
    });

    it('should reject low confidence pages', async () => {
      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.5,
        reasoning: 'Possibly technical content',
        should_process: false
      });

      const result = await enhanced_filter.filter_webpage(
        'https://example.com/page',
        'Some Page',
        'Mixed content here...',
        mock_llm_complete_json
      );

      expect(result.classification.confidence).toBe(0.5);
      expect(result.final_decision).toBe(false);
      expect(result.decision_reason).toContain('below threshold');
    });
  });

  describe('Procedural Rule Integration', () => {
    it('should apply domain accept rules', async () => {
      // Add a domain rule
      await procedural_store.add_rule({
        name: 'Accept docs.example.com',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: 'docs.example.com'
        },
        action: {
          type: 'accept',
          reason: 'Trusted documentation domain'
        },
        priority: 100,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'navigation',
        confidence: 0.6,
        reasoning: 'Navigation page',
        should_process: false
      });

      const result = await enhanced_filter.filter_webpage(
        'https://docs.example.com/index',
        'Documentation Home',
        'Welcome to our documentation',
        mock_llm_complete_json
      );

      // Despite low confidence and wrong type, procedural rule accepts it
      expect(result.final_decision).toBe(true);
      expect(result.decision_reason).toContain('Accepted by procedural rule');
      expect(result.applied_rules).toContain('accept_rule');
    });

    it('should apply domain reject rules', async () => {
      await procedural_store.add_rule({
        name: 'Block social media',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: 'facebook.com'
        },
        action: {
          type: 'reject',
          reason: 'Social media blocked'
        },
        priority: 100,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.9,
        reasoning: 'Technical article',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://facebook.com/tech-article',
        'Tech Article',
        'Great technical content...',
        mock_llm_complete_json
      );

      // Despite high confidence knowledge page, procedural rule rejects it
      expect(result.final_decision).toBe(false);
      expect(result.decision_reason).toContain('Rejected by procedural rule');
      expect(result.applied_rules).toContain('reject_rule');
    });

    it('should apply tagging rules', async () => {
      await procedural_store.add_rule({
        name: 'Tag TypeScript content',
        type: 'content_pattern',
        condition: {
          operator: 'and',
          field: 'content',
          comparator: 'contains',
          value: 'TypeScript'
        },
        action: {
          type: 'tag',
          value: 'typescript'
        },
        priority: 50,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.8,
        reasoning: 'Programming tutorial',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://example.com/tutorial',
        'TypeScript Tutorial',
        'Learn TypeScript basics...',
        mock_llm_complete_json
      );

      expect(result.tags).toContain('typescript');
      expect(result.applied_rules).toContain('tag_rule');
    });

    it('should apply priority boost rules', async () => {
      await procedural_store.add_rule({
        name: 'Boost documentation',
        type: 'content_pattern',
        condition: {
          operator: 'and',
          field: 'title',
          comparator: 'contains',
          value: 'Documentation'
        },
        action: {
          type: 'priority_boost'
        },
        priority: 60,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.65, // Below threshold
        reasoning: 'Technical docs',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://example.com/docs',
        'API Documentation',
        'API reference...',
        mock_llm_complete_json
      );

      // Boosted from 0.65 to 0.75, now above threshold
      expect(result.classification.confidence).toBeGreaterThan(0.7);
      expect(result.final_decision).toBe(true);
      expect(result.applied_rules).toContain('priority_boost');
    });
  });

  describe('Episodic Memory Integration', () => {
    it('should boost confidence based on similar accepted pages', async () => {
      // Record some accepted decisions for similar pages
      await episodic_store.record_filtering_decision(
        'https://docs.python.org/tutorial1',
        'knowledge',
        true,
        0.85
      );
      await episodic_store.record_filtering_decision(
        'https://docs.python.org/tutorial2',
        'knowledge',
        true,
        0.82
      );

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.68, // Just below threshold
        reasoning: 'Python tutorial',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://docs.python.org/tutorial3',
        'Python Tutorial Part 3',
        'Advanced Python concepts...',
        mock_llm_complete_json
      );

      // Episodic boost should push it above threshold
      expect(result.episodic_confidence_boost).toBeGreaterThan(0);
      expect(result.classification.confidence).toBeGreaterThan(0.7);
      expect(result.final_decision).toBe(true);
    });

    it('should reduce confidence based on similar rejected pages', async () => {
      // Record some rejected decisions for similar pages
      await episodic_store.record_filtering_decision(
        'https://social.example.com/feed1',
        'aggregator',
        false,
        0.8
      );
      await episodic_store.record_filtering_decision(
        'https://social.example.com/feed2',
        'aggregator',
        false,
        0.75
      );

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.72, // Just above threshold
        reasoning: 'Mixed content',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://social.example.com/article',
        'Article on Social Platform',
        'Some article content...',
        mock_llm_complete_json
      );

      // Episodic penalty should push it below threshold
      expect(result.episodic_confidence_boost).toBeLessThan(0);
      expect(result.final_decision).toBe(false);
    });
  });

  describe('Rule Priority and Conflicts', () => {
    it('should prioritize higher priority rules', async () => {
      // Low priority accept rule
      await procedural_store.add_rule({
        name: 'Accept all .com',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: '.com'
        },
        action: {
          type: 'accept'
        },
        priority: 10,
        enabled: true
      });

      // High priority reject rule
      await procedural_store.add_rule({
        name: 'Reject spam',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: 'spam.com'
        },
        action: {
          type: 'reject',
          reason: 'Spam domain'
        },
        priority: 100,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.8,
        reasoning: 'Content',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://spam.com/article',
        'Article',
        'Content...',
        mock_llm_complete_json
      );

      // High priority reject should win
      expect(result.final_decision).toBe(false);
      expect(result.decision_reason).toContain('Spam domain');
    });

    it('should stop evaluation after accept/reject actions', async () => {
      let evaluate_count = 0;

      // First rule: reject
      await procedural_store.add_rule({
        name: 'Reject rule',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: 'test.com'
        },
        action: {
          type: 'reject'
        },
        priority: 100,
        enabled: true
      });

      // Second rule: tag (should not be evaluated)
      await procedural_store.add_rule({
        name: 'Tag rule',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: 'test.com'
        },
        action: {
          type: 'tag',
          value: 'should-not-appear'
        },
        priority: 50,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.8,
        reasoning: 'Content',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://test.com/page',
        'Test Page',
        'Content...',
        mock_llm_complete_json
      );

      // Should only have reject, not tag
      expect(result.procedural_actions).toHaveLength(1);
      expect(result.procedural_actions[0].type).toBe('reject');
      expect(result.tags).not.toContain('should-not-appear');
    });
  });

  describe('Statistics and Learning', () => {
    it('should track filter statistics', async () => {
      await procedural_store.add_rule({
        name: 'Test Rule',
        type: 'domain',
        condition: {
          operator: 'and',
          field: 'url',
          comparator: 'contains',
          value: 'test'
        },
        action: {
          type: 'accept'
        },
        priority: 50,
        enabled: true
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'knowledge',
        confidence: 0.8,
        reasoning: 'Test content',
        should_process: true
      });

      await enhanced_filter.filter_webpage(
        'https://test.com/page1',
        'Test Page 1',
        'Content...',
        mock_llm_complete_json
      );

      await enhanced_filter.filter_webpage(
        'https://test.com/page2',
        'Test Page 2',
        'Content...',
        mock_llm_complete_json
      );

      const stats = await enhanced_filter.get_filter_statistics();
      
      expect(stats.procedural_rules).toBeDefined();
      expect(stats.episodic_memory).toBeDefined();
      expect(stats.config).toEqual(filter_config);
    });

    it('should learn from feedback', async () => {
      mock_llm_complete_json.mockResolvedValue({
        page_type: 'leisure',
        confidence: 0.8,
        reasoning: 'Entertainment',
        should_process: false
      });

      const result = await enhanced_filter.filter_webpage(
        'https://example.com/tutorial',
        'Programming Tutorial',
        'Learn programming...',
        mock_llm_complete_json
      );

      expect(result.final_decision).toBe(false);

      // Provide feedback that this was wrong
      await enhanced_filter.learn_from_feedback(
        'https://example.com/tutorial',
        false,
        'knowledge',
        'This was actually a programming tutorial'
      );

      // Check that episodic memory was updated
      const episodes = await episodic_store.get_recent_episodes(1);
      expect(episodes[0].correction_type).toBe('knowledge');
      expect(episodes[0].correction_decision).toBe(true);
    });
  });

  describe('Config Updates', () => {
    it('should update filter configuration', async () => {
      enhanced_filter.update_config({
        min_confidence: 0.5,
        allowed_types: ['knowledge', 'interactive_app']
      });

      mock_llm_complete_json.mockResolvedValue({
        page_type: 'interactive_app',
        confidence: 0.6,
        reasoning: 'Web application',
        should_process: true
      });

      const result = await enhanced_filter.filter_webpage(
        'https://app.example.com',
        'Web App',
        'Interactive application...',
        mock_llm_complete_json
      );

      // With updated config, this should be accepted
      expect(result.final_decision).toBe(true);
    });
  });
});