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
  value?: unknown;
}

export interface RuleAction {
  type: 'accept' | 'reject' | 'tag' | 'priority_boost' | 'custom';
  value?: unknown;
  reason?: string;
}

export class ProceduralMemoryStore {
  private db: DuckDB;
  private rules_cache: Map<string, ProceduralRule> = new Map();
  private compiled_rules: Map<string, (context: unknown) => boolean> = new Map();

  constructor(db: DuckDB) {
    this.db = db;
  }

  async initialize(): Promise<void> {
    await this.create_tables();
    await this.load_rules();
  }

  private async create_tables(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS procedural_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        condition TEXT NOT NULL,
        action TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        usage_count INTEGER DEFAULT 0,
        last_used TEXT
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS rule_execution_history (
        id TEXT PRIMARY KEY,
        rule_id TEXT REFERENCES procedural_rules(id),
        webpage_url TEXT,
        matched INTEGER,
        action_taken TEXT,
        execution_time_ms INTEGER,
        executed_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_rules_priority 
      ON procedural_rules(priority DESC, enabled)
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS idx_rule_history_rule_id 
      ON rule_execution_history(rule_id, executed_at DESC)
    `);
  }

  async load_rules(): Promise<void> {
    const result = await this.db.all<{
      id: string;
      name: string;
      description: string;
      type: string;
      condition: string;
      action: string;
      priority: number;
      enabled: number;
      created_at: string;
      updated_at: string;
      usage_count: number;
      last_used: string;
    }>(`
      SELECT * FROM procedural_rules 
      WHERE enabled = 1 
      ORDER BY priority DESC, created_at ASC
    `);

    this.rules_cache.clear();
    this.compiled_rules.clear();

    for (const row of result) {
      const rule: ProceduralRule = {
        id: row.id,
        name: row.name,
        description: row.description,
        type: row.type as ProceduralRule['type'],
        condition: JSON.parse(row.condition),
        action: JSON.parse(row.action),
        priority: row.priority,
        enabled: row.enabled === 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        usage_count: row.usage_count,
        last_used: row.last_used
      };
      
      this.rules_cache.set(rule.id, rule);
      this.compile_rule(rule);
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

  private create_condition_evaluator(condition: RuleCondition): (context: unknown) => boolean {
    return (context: unknown): boolean => {
      if (condition.operator === 'and') {
        return condition.conditions?.every(c => this.create_condition_evaluator(c)(context)) ?? true;
      } else if (condition.operator === 'or') {
        return condition.conditions?.some(c => this.create_condition_evaluator(c)(context)) ?? false;
      } else if (condition.operator === 'not') {
        const sub_condition = condition.conditions?.[0];
        return sub_condition ? !this.create_condition_evaluator(sub_condition)(context) : true;
      } else if (condition.field && condition.comparator) {
        const field_value = this.get_nested_value(context, condition.field);
        return this.compare_values(field_value, condition.comparator, condition.value);
      }
      return false;
    };
  }

  private get_nested_value(obj: unknown, path: string): unknown {
    return path.split('.').reduce((current, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  private compare_values(field_value: unknown, comparator: string, expected_value: unknown): boolean {
    switch (comparator) {
      case 'equals':
        return field_value === expected_value;
      case 'contains':
        return String(field_value).toLowerCase().includes(String(expected_value).toLowerCase());
      case 'matches':
        return new RegExp(String(expected_value), 'i').test(String(field_value));
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

  async evaluate_rules(context: { url?: string; [key: string]: unknown }): Promise<RuleAction[]> {
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

    // Use direct SQL to avoid type conversion issues
    const escaped_condition = JSON.stringify(new_rule.condition).replace(/'/g, "''");
    const escaped_action = JSON.stringify(new_rule.action).replace(/'/g, "''");
    const escaped_name = new_rule.name.replace(/'/g, "''");
    const escaped_desc = (new_rule.description || '').replace(/'/g, "''");
    
    await this.db.exec(`
      INSERT INTO procedural_rules (
        id, name, description, type, condition, action, 
        priority, enabled, created_at, updated_at, usage_count
      ) VALUES (
        '${new_rule.id}',
        '${escaped_name}',
        '${escaped_desc}',
        '${new_rule.type}',
        '${escaped_condition}',
        '${escaped_action}',
        ${new_rule.priority},
        ${new_rule.enabled ? 1 : 0},
        '${new_rule.created_at}',
        '${new_rule.updated_at}',
        ${new_rule.usage_count}
      )
    `);

    this.rules_cache.set(new_rule.id, new_rule);
    this.compile_rule(new_rule);
    
    return new_rule;
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

    // Use direct SQL to avoid type conversion issues
    const escaped_condition = JSON.stringify(updated_rule.condition).replace(/'/g, "''");
    const escaped_action = JSON.stringify(updated_rule.action).replace(/'/g, "''");
    const escaped_name = updated_rule.name.replace(/'/g, "''");
    const escaped_desc = (updated_rule.description || '').replace(/'/g, "''");
    
    await this.db.exec(`
      UPDATE procedural_rules
      SET name = '${escaped_name}', 
          description = '${escaped_desc}', 
          type = '${updated_rule.type}', 
          condition = '${escaped_condition}', 
          action = '${escaped_action}', 
          priority = ${updated_rule.priority}, 
          enabled = ${updated_rule.enabled ? 1 : 0}, 
          updated_at = '${updated_rule.updated_at}'
      WHERE id = '${id}'
    `);

    this.rules_cache.set(id, updated_rule);
    this.compile_rule(updated_rule);
  }

  async delete_rule(id: string): Promise<void> {
    await this.db.exec(`DELETE FROM procedural_rules WHERE id = '${id}'`);
    this.rules_cache.delete(id);
    this.compiled_rules.delete(id);
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
    const exec_id = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const escaped_url = webpage_url.replace(/'/g, "''");
    const escaped_action = JSON.stringify(action).replace(/'/g, "''");
    
    await this.db.exec(`
      INSERT INTO rule_execution_history (
        id, rule_id, webpage_url, matched, action_taken, execution_time_ms
      ) VALUES (
        '${exec_id}',
        '${rule_id}',
        '${escaped_url}',
        ${matched ? 1 : 0},
        '${escaped_action}',
        0
      )
    `);

    await this.db.exec(`
      UPDATE procedural_rules 
      SET usage_count = usage_count + 1, 
          last_used = CURRENT_TIMESTAMP
      WHERE id = '${rule_id}'
    `);

    // Update cache
    const rule = this.rules_cache.get(rule_id);
    if (rule) {
      rule.usage_count++;
      rule.last_used = new Date().toISOString();
    }
  }

  async get_rule_statistics(): Promise<{
    id: string;
    name: string;
    type: string;
    usage_count: number;
    total_executions: number;
    matches: number;
    avg_execution_time: number;
  }[]> {
    const stats = await this.db.all<{
      id: string;
      name: string;
      type: string;
      usage_count: number;
      total_executions: number | bigint;
      matches: number | bigint;
      avg_execution_time: number | bigint;
    }>(`
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
    
    // Convert BigInt values to regular numbers
    return stats.map(stat => ({
      ...stat,
      total_executions: Number(stat.total_executions),
      matches: Number(stat.matches),
      avg_execution_time: Number(stat.avg_execution_time)
    }));
  }

  async export_rules(): Promise<string> {
    const rules = await this.get_all_rules();
    return JSON.stringify(rules, null, 2);
  }

  async import_rules(json_string: string): Promise<void> {
    const imported_rules = JSON.parse(json_string) as ProceduralRule[];
    
    for (const rule of imported_rules) {
      // Generate new IDs to avoid conflicts
      const { ...rule_data } = rule;
      await this.add_rule(rule_data);
    }
    
    await this.load_rules();
  }
}