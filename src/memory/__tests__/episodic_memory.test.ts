import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DuckDB } from '../../duck_db';
import { LanceDBMemoryStore } from '../../agent_memory';
import { EpisodicMemoryStore } from '../episodic_memory_store';
import { MemoryEnhancedClassifier } from '../memory_enhanced_classifier';
import { FeedbackDocumentGenerator } from '../feedback_document_generator';
import { MarkdownDatabase } from '../../markdown_db';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Episodic Memory System', () => {
  let duck_db: DuckDB;
  let memory_db: LanceDBMemoryStore;
  let episodic_store: EpisodicMemoryStore;
  let memory_classifier: MemoryEnhancedClassifier;
  let feedback_generator: FeedbackDocumentGenerator;
  let markdown_db: MarkdownDatabase;
  let test_dir: string;

  beforeEach(async () => {
    // Create temporary test directory
    test_dir = path.join(__dirname, `test_${uuidv4()}`);
    fs.mkdirSync(test_dir, { recursive: true });

    // Initialize databases
    duck_db = new DuckDB({
      database_path: path.join(test_dir, 'test.db')
    });
    await duck_db.init();

    memory_db = await LanceDBMemoryStore.create(test_dir);
    
    episodic_store = new EpisodicMemoryStore(duck_db, memory_db);
    await episodic_store.initialize();

    memory_classifier = new MemoryEnhancedClassifier(episodic_store);

    const front_page_path = path.join(test_dir, 'test_webpages.md');
    fs.writeFileSync(front_page_path, '# Test Webpages');
    markdown_db = new MarkdownDatabase(front_page_path);
    
    feedback_generator = new FeedbackDocumentGenerator(episodic_store, markdown_db);
  });

  afterEach(async () => {
    await duck_db.close();
    // Clean up test directory
    fs.rmSync(test_dir, { recursive: true, force: true });
  });

  it('should store an episodic memory with reasoning', async () => {
    const episode_id = await episodic_store.store_episode(
      'https://example.com/tutorial',
      'knowledge',
      0.85,
      true,
      'Tutorial on React hooks',
      {
        title: 'React Hooks Tutorial',
        content_sample: 'Learn how to use React hooks...',
        word_count: 1500,
        has_code_blocks: true,
        link_density: 0.05,
        meta_description: 'Complete guide to React hooks'
      },
      'React hooks tutorial content for embedding'
    );

    expect(episode_id).toBeDefined();
    
    const episodes = await episodic_store.get_recent_episodes(1);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].reasoning).toBe('Tutorial on React hooks');
    expect(episodes[0].page_type).toBe('knowledge');
    expect(episodes[0].confidence).toBe(0.85);
  });

  it('should generate feedback document with reasoning', async () => {
    // Store a few test episodes
    await episodic_store.store_episode(
      'https://example.com/tutorial',
      'knowledge',
      0.85,
      true,
      'Tutorial on React hooks',
      {
        title: 'React Hooks Tutorial',
        content_sample: 'Learn React hooks...',
        word_count: 1500,
        has_code_blocks: true,
        link_density: 0.05
      },
      'content'
    );

    await episodic_store.store_episode(
      'https://example.com/game',
      'interactive_app',
      0.92,
      false,
      'Online game interface',
      {
        title: 'Space Invaders',
        content_sample: 'Play the classic game...',
        word_count: 200,
        has_code_blocks: false,
        link_density: 0.02
      },
      'content'
    );

    const doc_path = await feedback_generator.generate_feedback_document(24);
    expect(doc_path).toContain('__recent_webpages__.md');
    
    const content = fs.readFileSync(doc_path, 'utf-8');
    expect(content).toContain('✅ [React Hooks Tutorial]');
    expect(content).toContain('Tutorial on React hooks');
    expect(content).toContain('❌ [Space Invaders]');
    expect(content).toContain('Online game interface');
    expect(content).toContain('Recent Webpages (Last 24h)');
  });

  it('should apply memory adjustments to classification', async () => {
    // Store a corrected episode
    const episode_id = await episodic_store.store_episode(
      'https://docs.example.com/api',
      'interactive_app',
      0.75,
      false,
      'API documentation site',
      {
        title: 'API Documentation',
        content_sample: 'API endpoints...',
        word_count: 800,
        has_code_blocks: true,
        link_density: 0.1
      },
      'API documentation content'
    );

    // Add user correction
    await episodic_store.add_user_correction(episode_id, {
      corrected_decision: true,
      corrected_type: 'knowledge',
      explanation: 'This is documentation, not an app',
      feedback_timestamp: new Date()
    });

    // Mock LLM function for testing
    const mock_llm_complete_json = async <T>(prompt: string, system_prompt: string): Promise<T> => {
      return {
        page_type: 'interactive_app',
        confidence: 0.7,
        reasoning: 'Interactive API explorer',
        should_process: false
      } as T;
    };

    // Classify similar page
    const result = await memory_classifier.classify_with_memory(
      'https://docs.example.com/api/v2',
      'Similar API documentation',
      mock_llm_complete_json,
      { enabled: true, allowed_types: ['knowledge'], min_confidence: 0.7, log_decisions: false }
    );

    // Should be influenced by the correction
    expect(result.memory_adjustments.influenced_by).toHaveLength(1);
    expect(result.memory_adjustments.influenced_by[0]).toBe(episode_id);
    expect(result.final_classification.confidence).toBeLessThan(result.base_classification.confidence);
  });

  it('should track correction statistics', async () => {
    // Store episodes with corrections
    const episode1_id = await episodic_store.store_episode(
      'https://example1.com',
      'knowledge',
      0.8,
      true,
      'Educational content',
      {
        title: 'Page 1',
        content_sample: 'Content 1',
        word_count: 1000,
        has_code_blocks: false,
        link_density: 0.05
      },
      'content'
    );

    const episode2_id = await episodic_store.store_episode(
      'https://example2.com',
      'interactive_app',
      0.9,
      false,
      'Web application',
      {
        title: 'Page 2',
        content_sample: 'Content 2',
        word_count: 500,
        has_code_blocks: true,
        link_density: 0.02
      },
      'content'
    );

    // Add corrections
    await episodic_store.add_user_correction(episode1_id, {
      corrected_decision: false,
      explanation: 'Actually not useful',
      feedback_timestamp: new Date()
    });

    await episodic_store.add_user_correction(episode2_id, {
      corrected_decision: true,
      corrected_type: 'knowledge',
      explanation: 'This is a tutorial',
      feedback_timestamp: new Date()
    });

    const stats = await episodic_store.get_correction_statistics();
    expect(stats.total_episodes).toBe(2);
    expect(stats.total_corrections).toBe(2);
    expect(stats.correction_rate).toBe(1.0);
    expect(stats.false_positives).toBe(1); // episode1 was accepted but should be rejected
    expect(stats.false_negatives).toBe(1); // episode2 was rejected but should be accepted
    expect(stats.corrections_by_type['knowledge']).toBe(1);
  });
});