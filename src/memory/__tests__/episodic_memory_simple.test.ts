import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DuckDB } from '../../duck_db';
import { EpisodicMemoryStore } from '../episodic_memory_store';
import { FeedbackDocumentGenerator } from '../feedback_document_generator';
import { MarkdownDatabase } from '../../markdown_db';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

describe('Episodic Memory System (Simple)', () => {
  let duck_db: DuckDB;
  let episodic_store: EpisodicMemoryStore;
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

    // Create a mock LanceDB that doesn't require embeddings
    const mock_memory_db = {
      embeddings: null,
      put: async () => { /* mock */ },
      search: async () => []
    } as any;
    
    episodic_store = new EpisodicMemoryStore(duck_db, mock_memory_db);
    await episodic_store.initialize();

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
    expect(episodes[0].confidence).toBeCloseTo(0.85, 2);
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
    expect(stats.correction_rate).toBeCloseTo(1.0, 2);
    expect(stats.false_positives).toBe(1); // episode1 was accepted but should be rejected
    expect(stats.false_negatives).toBe(1); // episode2 was rejected but should be accepted
    expect(stats.corrections_by_type['knowledge']).toBe(1);
  });
});