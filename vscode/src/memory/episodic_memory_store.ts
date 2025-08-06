import { DuckDB } from '../duck_db';
import { LanceDBMemoryStore } from '../agent_memory';
import { EpisodicMemory, UserCorrection, ContentFeatures, MemorySearchOptions } from './types';
import { v4 as uuidv4 } from 'uuid';

const EPISODIC_MEMORY_NAMESPACE = 'episodic_memory';
const EPISODIC_MEMORY_TABLE = 'webpage_episodic_memory';

export class EpisodicMemoryStore {
  private duck_db: DuckDB;
  private vector_store: LanceDBMemoryStore;

  constructor(duck_db: DuckDB, vector_store: LanceDBMemoryStore) {
    this.duck_db = duck_db;
    this.vector_store = vector_store;
  }

  async initialize(): Promise<void> {
    // Create episodic memory table in DuckDB
    await this.duck_db.exec(`
      CREATE TABLE IF NOT EXISTS ${EPISODIC_MEMORY_TABLE} (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        page_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        original_decision BOOLEAN NOT NULL,
        reasoning TEXT NOT NULL,
        
        -- User correction fields (nullable)
        correction_decision BOOLEAN,
        correction_type TEXT,
        correction_explanation TEXT,
        correction_timestamp TIMESTAMP,
        
        -- Content features
        title TEXT NOT NULL,
        content_sample TEXT NOT NULL,
        word_count INTEGER NOT NULL,
        has_code_blocks BOOLEAN NOT NULL,
        link_density REAL NOT NULL,
        meta_description TEXT,
        
        -- Note: DuckDB creates indexes separately, not inline
      )
    `);
  }

  async store_episode(
    url: string,
    page_type: string,
    confidence: number,
    original_decision: boolean,
    reasoning: string,
    content_features: ContentFeatures,
    content_for_embedding: string
  ): Promise<string> {
    const id = uuidv4();
    const timestamp = new Date();
    const domain = new URL(url).hostname;

    // Store in DuckDB
    await this.duck_db.run(
      `INSERT INTO ${EPISODIC_MEMORY_TABLE} (
        id, timestamp, url, domain, page_type, confidence, original_decision, reasoning,
        title, content_sample, word_count, has_code_blocks, link_density, meta_description
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        timestamp.toISOString(),
        url,
        domain,
        page_type,
        confidence,
        original_decision,
        reasoning,
        content_features.title,
        content_features.content_sample,
        content_features.word_count,
        content_features.has_code_blocks,
        content_features.link_density,
        content_features.meta_description || null
      ]
    );

    // Store in vector store for similarity search
    if (this.vector_store.embeddings) {
      await this.vector_store.put(
        [EPISODIC_MEMORY_NAMESPACE],
        id,
        {
          url,
          page_type,
          confidence,
          original_decision,
          title: content_features.title,
          content: content_for_embedding,
          timestamp: timestamp.toISOString()
        }
      );
    }

    return id;
  }

  async add_user_correction(
    episode_id: string,
    correction: UserCorrection
  ): Promise<void> {
    await this.duck_db.run(
      `UPDATE ${EPISODIC_MEMORY_TABLE} 
       SET correction_decision = ?,
           correction_type = ?,
           correction_explanation = ?,
           correction_timestamp = ?
       WHERE id = ?`,
      [
        correction.corrected_decision,
        correction.corrected_type || null,
        correction.explanation || null,
        correction.feedback_timestamp.toISOString(),
        episode_id
      ]
    );
  }

  async get_recent_episodes(
    time_window_hours = 24,
    include_corrections_only = false
  ): Promise<EpisodicMemory[]> {
    const since = new Date();
    since.setHours(since.getHours() - time_window_hours);

    let query = `
      SELECT * FROM ${EPISODIC_MEMORY_TABLE}
      WHERE timestamp >= ?
    `;
    
    if (include_corrections_only) {
      query += ' AND correction_timestamp IS NOT NULL';
    }
    
    query += ' ORDER BY timestamp DESC';

    const rows = await this.duck_db.all(query, [since.toISOString()]);
    
    return rows.map(row => this.row_to_episodic_memory(row));
  }

  async get_episodes_by_domain(domain: string): Promise<EpisodicMemory[]> {
    const rows = await this.duck_db.all(
      `SELECT * FROM ${EPISODIC_MEMORY_TABLE}
       WHERE domain = ?
       ORDER BY timestamp DESC
       LIMIT 50`,
      [domain]
    );
    
    return rows.map(row => this.row_to_episodic_memory(row));
  }

  async find_similar_episodes(
    url: string,
    content: string,
    options: MemorySearchOptions = {}
  ): Promise<EpisodicMemory[]> {
    if (!this.vector_store.embeddings) {
      // Fallback to domain-based search if no embeddings
      const domain = new URL(url).hostname;
      return this.get_episodes_by_domain(domain);
    }

    // Search for similar episodes using vector similarity
    const results = await this.vector_store.search(
      [EPISODIC_MEMORY_NAMESPACE],
      {
        query: `${url} ${content}`.substring(0, 1000),
        limit: options.limit || 5
      }
    );

    // Get full episode data from DuckDB
    const episodes: EpisodicMemory[] = [];
    for (const result of results) {
      const row = await this.duck_db.get(
        `SELECT * FROM ${EPISODIC_MEMORY_TABLE} WHERE id = ?`,
        [result.key]
      );
      if (row) {
        episodes.push(this.row_to_episodic_memory(row));
      }
    }

    return episodes;
  }

  async get_correction_statistics(): Promise<{
    total_episodes: number;
    total_corrections: number;
    correction_rate: number;
    corrections_by_type: Record<string, number>;
    false_positives: number;
    false_negatives: number;
  }> {
    const stats = await this.duck_db.get(`
      SELECT 
        COUNT(*) as total_episodes,
        COUNT(correction_timestamp) as total_corrections,
        SUM(CASE WHEN original_decision = true AND correction_decision = false THEN 1 ELSE 0 END) as false_positives,
        SUM(CASE WHEN original_decision = false AND correction_decision = true THEN 1 ELSE 0 END) as false_negatives
      FROM ${EPISODIC_MEMORY_TABLE}
    `);

    const type_corrections = await this.duck_db.all(`
      SELECT correction_type, COUNT(*) as count
      FROM ${EPISODIC_MEMORY_TABLE}
      WHERE correction_type IS NOT NULL
      GROUP BY correction_type
    `);

    const corrections_by_type: Record<string, number> = {};
    for (const row of type_corrections) {
      corrections_by_type[row.correction_type] = Number(row.count);
    }

    return {
      total_episodes: Number(stats.total_episodes || 0),
      total_corrections: Number(stats.total_corrections || 0),
      correction_rate: stats.total_episodes > 0 ? Number(stats.total_corrections) / Number(stats.total_episodes) : 0,
      corrections_by_type,
      false_positives: Number(stats.false_positives || 0),
      false_negatives: Number(stats.false_negatives || 0)
    };
  }

  async get_similar_decisions(
    url: string,
    page_type: string,
    accepted: boolean
  ): Promise<EpisodicMemory[]> {
    const domain = new URL(url).hostname;
    
    const rows = await this.duck_db.all(`
      SELECT * FROM ${EPISODIC_MEMORY_TABLE}
      WHERE domain = ? 
        AND page_type = ?
        AND original_decision = ?
      ORDER BY timestamp DESC
      LIMIT 10
    `, [domain, page_type, accepted]);
    
    return rows.map(row => this.row_to_episodic_memory(row));
  }

  async update_decision_feedback(
    url: string,
    was_correct: boolean,
    correct_type?: string,
    feedback?: string
  ): Promise<void> {
    const memory = await this.get_by_url(url);
    if (!memory) return;

    if (!was_correct) {
      await this.correct_decision(
        memory.id,
        !memory.original_decision,
        correct_type || memory.page_type,
        feedback
      );
    }
  }

  async get_domain_error_count(domain: string): Promise<number> {
    const result = await this.duck_db.get(`
      SELECT COUNT(*) as error_count
      FROM ${EPISODIC_MEMORY_TABLE}
      WHERE domain = ?
        AND correction_timestamp IS NOT NULL
    `, [domain]);
    
    return Number(result?.error_count || 0);
  }

  private async get_by_url(url: string): Promise<EpisodicMemory | null> {
    const row = await this.duck_db.get(`
      SELECT * FROM ${EPISODIC_MEMORY_TABLE}
      WHERE url = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `, [url]);
    
    return row ? this.row_to_episodic_memory(row) : null;
  }

  private row_to_episodic_memory(row: any): EpisodicMemory {
    const memory: EpisodicMemory = {
      id: row.id,
      timestamp: new Date(row.timestamp),
      url: row.url,
      domain: row.domain,
      page_type: row.page_type,
      confidence: row.confidence,
      original_decision: row.original_decision,
      reasoning: row.reasoning,
      content_features: {
        title: row.title,
        content_sample: row.content_sample,
        word_count: row.word_count,
        has_code_blocks: row.has_code_blocks,
        link_density: row.link_density,
        meta_description: row.meta_description
      }
    };

    if (row.correction_timestamp) {
      memory.user_correction = {
        corrected_decision: row.correction_decision,
        corrected_type: row.correction_type,
        explanation: row.correction_explanation,
        feedback_timestamp: new Date(row.correction_timestamp)
      };
    }

    return memory;
  }
}