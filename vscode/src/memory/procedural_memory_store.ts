import * as vscode from 'vscode';
import { DuckDB } from '../duck_db';

export interface ProceduralRule {
  id: string;
  name: string;
  description?: string;
  type: 'domain' | 'content_pattern' | 'metadata' | 'custom';
  condition: RuleCondition;
  action: RuleAction;
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  usage_count: number;
  last_used?: string;
}

export interface RuleCondition {
  operator: 'and' | 'or' | 'not';
  conditions?: RuleCondition[];
  field?: string;
  comparator?: 'equals' | 'contains' | 'matches' | 'starts_with' | 'ends_with' | 'greater_than' | 'less_than';
  value?: any;
}

export interface RuleAction {
  type: 'accept' | 'reject' | 'tag' | 'priority_boost' | 'custom';
  value?: any;
  reason?: string;
}

export class ProceduralMemoryStore {
  private db: DuckDB;
  private rules_cache: Map<string, ProceduralRule> = new Map();
  private compiled_rules: Map<string, Function> = new Map();

  constructor(db: DuckDB) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    await this.create_tables();
    await this.load_rules();
  }

  private async create_tables(): Promise<void> {
    const conn = await this.db.connection();
    try {
      await conn.run(`
        CREATE TABLE IF NOT EXISTS procedural_rules (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL,
          condition TEXT NOT NULL,
          action TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          enabled BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          usage_count INTEGER DEFAULT 0,
          last_used TIMESTAMP
        )
      `);

      await conn.run(`
        CREATE TABLE IF NOT EXISTS rule_execution_history (
          id TEXT PRIMARY KEY,
          rule_id TEXT REFERENCES procedural_rules(id),
          webpage_url TEXT,
          matched BOOLEAN,
          action_taken TEXT,
          execution_time_ms INTEGER,
          executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await conn.run(`
        CREATE INDEX IF NOT EXISTS idx_rules_priority 
        ON procedural_rules(priority DESC, enabled)
      `);

      await conn.run(`
        CREATE INDEX IF NOT EXISTS idx_rule_history_rule_id 
        ON rule_execution_history(rule_id, executed_at DESC)
      `);
    } finally {
      await conn.close();
    }
  }

  async load_rules(): Promise<void> {
    const conn = await this.db.connection();
    try {
      const result = await conn.all<any>(`
        SELECT * FROM procedural_rules 
        WHERE enabled = true 
        ORDER BY priority DESC, created_at ASC
      `);

      this.rules_cache.clear();
      this.compiled_rules.clear();

      for (const row of result) {
        const rule: ProceduralRule = {
          id: row.id,
          name: row.name,
          description: row.description,
          type: row.type,
          condition: JSON.parse(row.condition),
          action: JSON.parse(row.action),
          priority: row.priority,
          enabled: row.enabled,
          created_at: row.created_at,
          updated_at: row.updated_at,
          usage_count: row.usage_count,
          last_used: row.last_used
        };
        
        this.rules_cache.set(rule.id, rule);
        this.compile_rule(rule);
      }
    } finally {
      await conn.close();
    }
  }

  private compile_rule(rule: ProceduralRule): void {
    try {
      const evaluator = this.create_condition_evaluator(rule.condition);
      this.compiled_rules.set(rule.id, evaluator);
    } catch (error) {
      console.error(`Failed to compile rule ${rule.id}:`, error);
    }
  }

  private create_condition_evaluator(condition: RuleCondition): Function {
    return (context: any): boolean => {
      if (condition.operator === 'and') {
        return condition.conditions?.every(c => this.create_condition_evaluator(c)(context)) ?? true;
      } else if (condition.operator === 'or') {
        return condition.conditions?.some(c => this.create_condition_evaluator(c)(context)) ?? false;
      } else if (condition.operator === 'not') {
        const subCondition = condition.conditions?.[0];
        return subCondition ? !this.create_condition_evaluator(subCondition)(context) : true;
      } else if (condition.field && condition.comparator) {
        const field_value = this.get_nested_value(context, condition.field);
        return this.compare_values(field_value, condition.comparator, condition.value);
      }
      return false;
    };
  }

  private get_nested_value(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private compare_values(field_value: any, comparator: string, expected_value: any): boolean {
    switch (comparator) {
      case 'equals':
        return field_value === expected_value;
      case 'contains':
        return String(field_value).toLowerCase().includes(String(expected_value).toLowerCase());
      case 'matches':
        return new RegExp(expected_value, 'i').test(String(field_value));
      case 'starts_with':
        return String(field_value).toLowerCase().startsWith(String(expected_value).toLowerCase());
      case 'ends_with':
        return String(field_value).toLowerCase().endsWith(String(expected_value).toLowerCase());
      case 'greater_than':
        return Number(field_value) > Number(expected_value);
      case 'less_than':
        return Number(field_value) < Number(expected_value);
      default:
        return false;
    }
  }

  async evaluate_rules(context: any): Promise<RuleAction[]> {
    const matched_actions: RuleAction[] = [];
    const sorted_rules = Array.from(this.rules_cache.values())
      .filter(r => r.enabled)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of sorted_rules) {
      const evaluator = this.compiled_rules.get(rule.id);
      if (evaluator && evaluator(context)) {
        matched_actions.push(rule.action);
        await this.record_rule_execution(rule.id, context.url, true, rule.action);
        
        // Stop on first reject or accept action
        if (rule.action.type === 'reject' || rule.action.type === 'accept') {
          break;
        }
      }
    }

    return matched_actions;
  }

  async add_rule(rule: Omit<ProceduralRule, 'id' | 'created_at' | 'updated_at' | 'usage_count'>): Promise<ProceduralRule> {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    
    const new_rule: ProceduralRule = {
      ...rule,
      id,
      created_at: now,
      updated_at: now,
      usage_count: 0
    };

    const conn = await this.db.connection();
    try {
      await conn.run(`
        INSERT INTO procedural_rules (
          id, name, description, type, condition, action, 
          priority, enabled, created_at, updated_at, usage_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        new_rule.id,
        new_rule.name,
        new_rule.description,
        new_rule.type,
        JSON.stringify(new_rule.condition),
        JSON.stringify(new_rule.action),
        new_rule.priority,
        new_rule.enabled,
        new_rule.created_at,
        new_rule.updated_at,
        new_rule.usage_count
      ]);

      this.rules_cache.set(new_rule.id, new_rule);
      this.compile_rule(new_rule);
      
      return new_rule;
    } finally {
      await conn.close();
    }
  }

  async update_rule(id: string, updates: Partial<ProceduralRule>): Promise<void> {
    const existing_rule = this.rules_cache.get(id);
    if (!existing_rule) {
      throw new Error(`Rule ${id} not found`);
    }

    const updated_rule = {
      ...existing_rule,
      ...updates,
      id: existing_rule.id,
      created_at: existing_rule.created_at,
      updated_at: new Date().toISOString()
    };

    const conn = await this.db.connection();
    try {
      await conn.run(`
        UPDATE procedural_rules
        SET name = ?, description = ?, type = ?, condition = ?, 
            action = ?, priority = ?, enabled = ?, updated_at = ?
        WHERE id = ?
      `, [
        updated_rule.name,
        updated_rule.description,
        updated_rule.type,
        JSON.stringify(updated_rule.condition),
        JSON.stringify(updated_rule.action),
        updated_rule.priority,
        updated_rule.enabled,
        updated_rule.updated_at,
        id
      ]);

      this.rules_cache.set(id, updated_rule);
      this.compile_rule(updated_rule);
    } finally {
      await conn.close();
    }
  }

  async delete_rule(id: string): Promise<void> {
    const conn = await this.db.connection();
    try {
      await conn.run('DELETE FROM procedural_rules WHERE id = ?', [id]);
      this.rules_cache.delete(id);
      this.compiled_rules.delete(id);
    } finally {
      await conn.close();
    }
  }

  async get_all_rules(): Promise<ProceduralRule[]> {
    return Array.from(this.rules_cache.values());
  }

  async get_rule(id: string): Promise<ProceduralRule | undefined> {
    return this.rules_cache.get(id);
  }

  private async record_rule_execution(
    rule_id: string,
    webpage_url: string,
    matched: boolean,
    action: RuleAction
  ): Promise<void> {
    const conn = await this.db.connection();
    try {
      const exec_id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await conn.run(`
        INSERT INTO rule_execution_history (
          id, rule_id, webpage_url, matched, action_taken, execution_time_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        exec_id,
        rule_id,
        webpage_url,
        matched,
        JSON.stringify(action),
        0 // Could track actual execution time if needed
      ]);

      await conn.run(`
        UPDATE procedural_rules 
        SET usage_count = usage_count + 1, 
            last_used = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [rule_id]);

      // Update cache
      const rule = this.rules_cache.get(rule_id);
      if (rule) {
        rule.usage_count++;
        rule.last_used = new Date().toISOString();
      }
    } finally {
      await conn.close();
    }
  }

  async get_rule_statistics(): Promise<any> {
    const conn = await this.db.connection();
    try {
      const stats = await conn.all<any>(`
        SELECT 
          r.id,
          r.name,
          r.type,
          r.usage_count,
          COUNT(h.id) as total_executions,
          SUM(CASE WHEN h.matched THEN 1 ELSE 0 END) as matches,
          AVG(h.execution_time_ms) as avg_execution_time
        FROM procedural_rules r
        LEFT JOIN rule_execution_history h ON r.id = h.rule_id
        GROUP BY r.id, r.name, r.type, r.usage_count
        ORDER BY r.usage_count DESC
      `);
      
      return stats;
    } finally {
      await conn.close();
    }
  }

  async export_rules(): Promise<string> {
    const rules = await this.get_all_rules();
    return JSON.stringify(rules, null, 2);
  }

  async import_rules(json_string: string): Promise<void> {
    const imported_rules = JSON.parse(json_string) as ProceduralRule[];
    
    for (const rule of imported_rules) {
      // Generate new IDs to avoid conflicts
      const { id, created_at, updated_at, usage_count, last_used, ...rule_data } = rule;
      await this.add_rule(rule_data);
    }
    
    await this.load_rules();
  }
}