import { ProceduralMemoryStore, ProceduralRule, RuleCondition, RuleAction } from '../procedural_memory_store';
import { DuckDB } from '../../duck_db';
import * as path from 'path';
import * as fs from 'fs';

describe('ProceduralMemoryStore', () => {
  let procedural_store: ProceduralMemoryStore;
  let duck_db: DuckDB;
  const test_db_path = path.join(__dirname, 'test_procedural.db');

  beforeEach(async () => {
    // Clean up any existing test database
    if (fs.existsSync(test_db_path)) {
      fs.unlinkSync(test_db_path);
    }

    duck_db = new DuckDB({ database_path: test_db_path });
    await duck_db.init();
    
    procedural_store = new ProceduralMemoryStore(duck_db);
    await procedural_store.initialize();
  });

  afterEach(async () => {
    await duck_db.close();
    if (fs.existsSync(test_db_path)) {
      fs.unlinkSync(test_db_path);
    }
  });

  describe('Rule Management', () => {
    it('should add a new rule', async () => {
      const rule_data = {
        name: 'Test Domain Rule',
        description: 'Always accept pages from test.com',
        type: 'domain' as const,
        condition: {
          operator: 'and' as const,
          field: 'url',
          comparator: 'contains' as const,
          value: 'test.com'
        },
        action: {
          type: 'accept' as const,
          reason: 'Trusted domain'
        },
        priority: 100,
        enabled: true
      };

      const created_rule = await procedural_store.add_rule(rule_data);

      expect(created_rule).toBeDefined();
      expect(created_rule.id).toBeDefined();
      expect(created_rule.name).toBe('Test Domain Rule');
      expect(created_rule.created_at).toBeDefined();
      expect(created_rule.usage_count).toBe(0);
    });

    it('should update an existing rule', async () => {
      const rule_data = {
        name: 'Original Rule',
        type: 'domain' as const,
        condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: 'example.com' },
        action: { type: 'accept' as const },
        priority: 50,
        enabled: true
      };

      const created_rule = await procedural_store.add_rule(rule_data);
      
      await procedural_store.update_rule(created_rule.id, {
        name: 'Updated Rule',
        priority: 75,
        enabled: false
      });

      const updated_rule = await procedural_store.get_rule(created_rule.id);
      expect(updated_rule?.name).toBe('Updated Rule');
      expect(updated_rule?.priority).toBe(75);
      expect(updated_rule?.enabled).toBe(false);
    });

    it('should delete a rule', async () => {
      const rule_data = {
        name: 'To Delete',
        type: 'domain' as const,
        condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: 'delete.com' },
        action: { type: 'reject' as const },
        priority: 10,
        enabled: true
      };

      const created_rule = await procedural_store.add_rule(rule_data);
      await procedural_store.delete_rule(created_rule.id);

      const deleted_rule = await procedural_store.get_rule(created_rule.id);
      expect(deleted_rule).toBeUndefined();
    });

    it('should get all rules', async () => {
      const rules = [
        {
          name: 'Rule 1',
          type: 'domain' as const,
          condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: 'site1.com' },
          action: { type: 'accept' as const },
          priority: 100,
          enabled: true
        },
        {
          name: 'Rule 2',
          type: 'content_pattern' as const,
          condition: { operator: 'and' as const, field: 'content', comparator: 'contains' as const, value: 'documentation' },
          action: { type: 'tag' as const, value: 'docs' },
          priority: 50,
          enabled: true
        }
      ];

      for (const rule of rules) {
        await procedural_store.add_rule(rule);
      }

      const all_rules = await procedural_store.get_all_rules();
      expect(all_rules).toHaveLength(2);
      expect(all_rules.map(r => r.name)).toContain('Rule 1');
      expect(all_rules.map(r => r.name)).toContain('Rule 2');
    });
  });

  describe('Rule Evaluation', () => {
    it('should evaluate simple field conditions', async () => {
      const rule = {
        name: 'URL Contains Test',
        type: 'domain' as const,
        condition: {
          operator: 'and' as const,
          field: 'url',
          comparator: 'contains' as const,
          value: 'example.com'
        },
        action: {
          type: 'accept' as const,
          reason: 'Example domain'
        },
        priority: 100,
        enabled: true
      };

      await procedural_store.add_rule(rule);

      const context = {
        url: 'https://www.example.com/page',
        title: 'Test Page',
        content: 'Some content'
      };

      const actions = await procedural_store.evaluate_rules(context);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('accept');
    });

    it('should evaluate complex nested conditions', async () => {
      const rule = {
        name: 'Complex Rule',
        type: 'custom' as const,
        condition: {
          operator: 'or' as const,
          conditions: [
            {
              operator: 'and' as const,
              field: 'url',
              comparator: 'contains' as const,
              value: 'docs'
            },
            {
              operator: 'and' as const,
              field: 'title',
              comparator: 'contains' as const,
              value: 'Documentation'
            }
          ]
        },
        action: {
          type: 'tag' as const,
          value: 'documentation'
        },
        priority: 80,
        enabled: true
      };

      await procedural_store.add_rule(rule);

      // Test with URL matching
      let context = {
        url: 'https://site.com/docs/api',
        title: 'API Guide',
        content: 'API documentation'
      };

      let actions = await procedural_store.evaluate_rules(context);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('tag');
      expect(actions[0].value).toBe('documentation');

      // Test with title matching
      context = {
        url: 'https://site.com/guide',
        title: 'Documentation Overview',
        content: 'Getting started'
      };

      actions = await procedural_store.evaluate_rules(context);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('tag');
    });

    it('should respect rule priority', async () => {
      const rules = [
        {
          name: 'Low Priority',
          type: 'domain' as const,
          condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: '.com' },
          action: { type: 'tag' as const, value: 'low-priority' },
          priority: 10,
          enabled: true
        },
        {
          name: 'High Priority',
          type: 'domain' as const,
          condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: '.com' },
          action: { type: 'reject' as const, reason: 'High priority rejection' },
          priority: 100,
          enabled: true
        }
      ];

      for (const rule of rules) {
        await procedural_store.add_rule(rule);
      }

      const context = {
        url: 'https://example.com',
        title: 'Test',
        content: 'Content'
      };

      const actions = await procedural_store.evaluate_rules(context);
      
      // High priority reject should be evaluated first and stop evaluation
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('reject');
    });

    it('should skip disabled rules', async () => {
      const rule = {
        name: 'Disabled Rule',
        type: 'domain' as const,
        condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: 'test' },
        action: { type: 'accept' as const },
        priority: 100,
        enabled: false
      };

      await procedural_store.add_rule(rule);

      const context = {
        url: 'https://test.com',
        title: 'Test',
        content: 'Content'
      };

      const actions = await procedural_store.evaluate_rules(context);
      expect(actions).toHaveLength(0);
    });

    it('should handle regex patterns', async () => {
      const rule = {
        name: 'Regex Pattern',
        type: 'content_pattern' as const,
        condition: {
          operator: 'and' as const,
          field: 'content',
          comparator: 'matches' as const,
          value: '\\bTODO:\\s*.+'
        },
        action: {
          type: 'tag' as const,
          value: 'has-todo'
        },
        priority: 50,
        enabled: true
      };

      await procedural_store.add_rule(rule);

      const context = {
        url: 'https://example.com',
        title: 'Code File',
        content: 'Some code here\n// TODO: Fix this later\nMore code'
      };

      const actions = await procedural_store.evaluate_rules(context);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('tag');
      expect(actions[0].value).toBe('has-todo');
    });
  });

  describe('Rule Statistics', () => {
    it('should track rule usage', async () => {
      const rule_data = {
        name: 'Tracked Rule',
        type: 'domain' as const,
        condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: 'track' },
        action: { type: 'accept' as const },
        priority: 50,
        enabled: true
      };

      const rule = await procedural_store.add_rule(rule_data);

      // Evaluate rules multiple times
      const context = {
        url: 'https://track.com/page1',
        title: 'Page',
        content: 'Content'
      };

      await procedural_store.evaluate_rules(context);
      await procedural_store.evaluate_rules({ ...context, url: 'https://track.com/page2' });

      const stats = await procedural_store.get_rule_statistics();
      const rule_stat = stats.find((s: any) => s.id === rule.id);
      
      expect(rule_stat).toBeDefined();
      expect(rule_stat.total_executions).toBe(2);
      expect(rule_stat.matches).toBe(2);
    });
  });

  describe('Import/Export', () => {
    it('should export rules as JSON', async () => {
      const rules = [
        {
          name: 'Export Rule 1',
          type: 'domain' as const,
          condition: { operator: 'and' as const, field: 'url', comparator: 'contains' as const, value: 'export1' },
          action: { type: 'accept' as const },
          priority: 100,
          enabled: true
        },
        {
          name: 'Export Rule 2',
          type: 'content_pattern' as const,
          condition: { operator: 'and' as const, field: 'content', comparator: 'contains' as const, value: 'pattern' },
          action: { type: 'tag' as const, value: 'exported' },
          priority: 50,
          enabled: false
        }
      ];

      for (const rule of rules) {
        await procedural_store.add_rule(rule);
      }

      const json_export = await procedural_store.export_rules();
      const exported_rules = JSON.parse(json_export);

      expect(exported_rules).toHaveLength(2);
      expect(exported_rules.map((r: any) => r.name)).toContain('Export Rule 1');
      expect(exported_rules.map((r: any) => r.name)).toContain('Export Rule 2');
    });

    it('should import rules from JSON', async () => {
      const rules_to_import = [
        {
          id: 'old_id_1',
          name: 'Imported Rule 1',
          type: 'domain',
          condition: { operator: 'and', field: 'url', comparator: 'contains', value: 'imported' },
          action: { type: 'accept' },
          priority: 75,
          enabled: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          usage_count: 10
        }
      ];

      const json_string = JSON.stringify(rules_to_import);
      await procedural_store.import_rules(json_string);

      const all_rules = await procedural_store.get_all_rules();
      expect(all_rules).toHaveLength(1);
      expect(all_rules[0].name).toBe('Imported Rule 1');
      expect(all_rules[0].id).not.toBe('old_id_1'); // Should generate new ID
      expect(all_rules[0].usage_count).toBe(0); // Should reset usage count
    });
  });

  describe('Comparator Functions', () => {
    it('should handle starts_with comparator', async () => {
      const rule = {
        name: 'Starts With Test',
        type: 'domain' as const,
        condition: {
          operator: 'and' as const,
          field: 'url',
          comparator: 'starts_with' as const,
          value: 'https://docs'
        },
        action: { type: 'tag' as const, value: 'documentation' },
        priority: 50,
        enabled: true
      };

      await procedural_store.add_rule(rule);

      const matching_context = {
        url: 'https://docs.example.com/api',
        title: 'API',
        content: 'Content'
      };

      const non_matching_context = {
        url: 'https://www.example.com/docs',
        title: 'Docs',
        content: 'Content'
      };

      let actions = await procedural_store.evaluate_rules(matching_context);
      expect(actions).toHaveLength(1);

      actions = await procedural_store.evaluate_rules(non_matching_context);
      expect(actions).toHaveLength(0);
    });

    it('should handle ends_with comparator', async () => {
      const rule = {
        name: 'Ends With Test',
        type: 'content_pattern' as const,
        condition: {
          operator: 'and' as const,
          field: 'url',
          comparator: 'ends_with' as const,
          value: '.pdf'
        },
        action: { type: 'tag' as const, value: 'pdf-document' },
        priority: 50,
        enabled: true
      };

      await procedural_store.add_rule(rule);

      const matching_context = {
        url: 'https://example.com/document.pdf',
        title: 'Document',
        content: 'PDF content'
      };

      const actions = await procedural_store.evaluate_rules(matching_context);
      expect(actions).toHaveLength(1);
      expect(actions[0].value).toBe('pdf-document');
    });

    it('should handle numeric comparisons', async () => {
      const rules = [
        {
          name: 'Greater Than',
          type: 'metadata' as const,
          condition: {
            operator: 'and' as const,
            field: 'confidence',
            comparator: 'greater_than' as const,
            value: 0.8
          },
          action: { type: 'tag' as const, value: 'high-confidence' },
          priority: 50,
          enabled: true
        },
        {
          name: 'Less Than',
          type: 'metadata' as const,
          condition: {
            operator: 'and' as const,
            field: 'confidence',
            comparator: 'less_than' as const,
            value: 0.5
          },
          action: { type: 'tag' as const, value: 'low-confidence' },
          priority: 50,
          enabled: true
        }
      ];

      for (const rule of rules) {
        await procedural_store.add_rule(rule);
      }

      const high_confidence_context = {
        url: 'https://example.com',
        confidence: 0.9
      };

      const low_confidence_context = {
        url: 'https://example.com',
        confidence: 0.3
      };

      let actions = await procedural_store.evaluate_rules(high_confidence_context);
      expect(actions.map(a => a.value)).toContain('high-confidence');

      actions = await procedural_store.evaluate_rules(low_confidence_context);
      expect(actions.map(a => a.value)).toContain('low-confidence');
    });
  });

  describe('NOT operator', () => {
    it('should handle NOT conditions', async () => {
      const rule = {
        name: 'Not Contains Test',
        type: 'domain' as const,
        condition: {
          operator: 'not' as const,
          conditions: [
            {
              operator: 'and' as const,
              field: 'url',
              comparator: 'contains' as const,
              value: 'blocked.com'
            }
          ]
        },
        action: { type: 'accept' as const },
        priority: 50,
        enabled: true
      };

      await procedural_store.add_rule(rule);

      const allowed_context = {
        url: 'https://allowed.com',
        title: 'Allowed',
        content: 'Content'
      };

      const blocked_context = {
        url: 'https://blocked.com',
        title: 'Blocked',
        content: 'Content'
      };

      let actions = await procedural_store.evaluate_rules(allowed_context);
      expect(actions).toHaveLength(1);
      expect(actions[0].type).toBe('accept');

      actions = await procedural_store.evaluate_rules(blocked_context);
      expect(actions).toHaveLength(0);
    });
  });
});