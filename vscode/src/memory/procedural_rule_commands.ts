import * as vscode from 'vscode';
import { ProceduralMemoryStore, ProceduralRule, RuleCondition, RuleAction } from './procedural_memory_store';

export function register_procedural_rule_commands(
  context: vscode.ExtensionContext,
  procedural_store: ProceduralMemoryStore
): void {
  // Command to create a new rule
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.createFilterRule', async () => {
      const rule = await create_rule_wizard();
      if (rule) {
        try {
          const created = await procedural_store.add_rule(rule);
          vscode.window.showInformationMessage(`Rule "${created.name}" created successfully`);
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to create rule: ${error}`);
        }
      }
    })
  );

  // Command to manage existing rules
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.manageFilterRules', async () => {
      await show_rule_manager(procedural_store);
    })
  );

  // Command to create domain-specific rule
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.createDomainRule', async () => {
      const domain = await vscode.window.showInputBox({
        prompt: 'Enter domain (e.g., example.com)',
        placeHolder: 'example.com'
      });

      if (!domain) return;

      const action = await vscode.window.showQuickPick(
        ['Always Accept', 'Always Reject', 'Boost Priority'],
        { placeHolder: 'Select action for this domain' }
      );

      if (!action) return;

      const rule_action: RuleAction = {
        type: action === 'Always Accept' ? 'accept' : 
              action === 'Always Reject' ? 'reject' : 'priority_boost',
        reason: `Domain rule for ${domain}`
      };

      const condition: RuleCondition = {
        operator: 'or',
        conditions: [
          {
            operator: 'and',
            field: 'url',
            comparator: 'contains',
            value: domain
          }
        ]
      };

      const rule = {
        name: `Domain: ${domain}`,
        description: `${action} all pages from ${domain}`,
        type: 'domain' as const,
        condition,
        action: rule_action,
        priority: 100,
        enabled: true
      };

      try {
        await procedural_store.add_rule(rule);
        vscode.window.showInformationMessage(`Domain rule for ${domain} created`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create domain rule: ${error}`);
      }
    })
  );

  // Command to create content pattern rule
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.createContentPatternRule', async () => {
      const pattern = await vscode.window.showInputBox({
        prompt: 'Enter keyword or pattern to match in content',
        placeHolder: 'e.g., "important", "TODO:", "/regex pattern/"'
      });

      if (!pattern) return;

      const field = await vscode.window.showQuickPick(
        ['Title', 'Content', 'URL', 'Description'],
        { placeHolder: 'Where to search for this pattern?' }
      );

      if (!field) return;

      const action = await vscode.window.showQuickPick(
        ['Accept', 'Reject', 'Tag', 'Boost Priority'],
        { placeHolder: 'What to do when pattern matches?' }
      );

      if (!action) return;

      let rule_action: RuleAction;
      if (action === 'Tag') {
        const tag = await vscode.window.showInputBox({
          prompt: 'Enter tag to apply',
          placeHolder: 'e.g., "important", "review-later"'
        });
        rule_action = {
          type: 'tag',
          value: tag || 'matched',
          reason: `Content matches pattern: ${pattern}`
        };
      } else {
        rule_action = {
          type: action.toLowerCase() as any,
          reason: `Content matches pattern: ${pattern}`
        };
      }

      const is_regex = pattern.startsWith('/') && pattern.endsWith('/');
      const condition: RuleCondition = {
        operator: 'and',
        field: field.toLowerCase(),
        comparator: is_regex ? 'matches' : 'contains',
        value: is_regex ? pattern.slice(1, -1) : pattern
      };

      const rule = {
        name: `Pattern: ${pattern} in ${field}`,
        description: `${action} pages where ${field} contains "${pattern}"`,
        type: 'content_pattern' as const,
        condition,
        action: rule_action,
        priority: 50,
        enabled: true
      };

      try {
        await procedural_store.add_rule(rule);
        vscode.window.showInformationMessage(`Content pattern rule created`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to create pattern rule: ${error}`);
      }
    })
  );

  // Command to show rule statistics
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.showRuleStatistics', async () => {
      const stats = await procedural_store.get_rule_statistics();
      
      const panel = vscode.window.createWebviewPanel(
        'ruleStatistics',
        'Filter Rule Statistics',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = generate_stats_html(stats);
    })
  );

  // Command to export rules
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.exportFilterRules', async () => {
      const rules_json = await procedural_store.export_rules();
      
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('filter-rules.json'),
        filters: {
          'JSON': ['json']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(rules_json, 'utf8')
        );
        vscode.window.showInformationMessage('Rules exported successfully');
      }
    })
  );

  // Command to import rules
  context.subscriptions.push(
    vscode.commands.registerCommand('bergamot.importFilterRules', async () => {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          'JSON': ['json']
        }
      });

      if (uri && uri[0]) {
        try {
          const content = await vscode.workspace.fs.readFile(uri[0]);
          const json_string = Buffer.from(content).toString('utf8');
          await procedural_store.import_rules(json_string);
          vscode.window.showInformationMessage('Rules imported successfully');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to import rules: ${error}`);
        }
      }
    })
  );
}

async function create_rule_wizard(): Promise<Omit<ProceduralRule, 'id' | 'created_at' | 'updated_at' | 'usage_count'> | null> {
  // Get rule name
  const name = await vscode.window.showInputBox({
    prompt: 'Enter rule name',
    placeHolder: 'e.g., "Accept TypeScript documentation"'
  });
  if (!name) return null;

  // Get rule type
  const type = await vscode.window.showQuickPick(
    ['Domain', 'Content Pattern', 'Metadata', 'Custom'],
    { placeHolder: 'Select rule type' }
  );
  if (!type) return null;

  // Build condition based on type
  let condition: RuleCondition;
  
  if (type === 'Custom') {
    // For custom rules, provide a JSON input
    const condition_json = await vscode.window.showInputBox({
      prompt: 'Enter rule condition as JSON',
      placeHolder: '{"operator": "and", "field": "url", "comparator": "contains", "value": "docs"}'
    });
    if (!condition_json) return null;
    
    try {
      condition = JSON.parse(condition_json);
    } catch (error) {
      vscode.window.showErrorMessage('Invalid JSON for condition');
      return null;
    }
  } else {
    // Simplified condition builder for common cases
    const field = await vscode.window.showInputBox({
      prompt: 'Enter field to check',
      placeHolder: 'e.g., url, title, content'
    });
    if (!field) return null;

    const comparator = await vscode.window.showQuickPick(
      ['equals', 'contains', 'matches', 'starts_with', 'ends_with'],
      { placeHolder: 'Select comparison operator' }
    );
    if (!comparator) return null;

    const value = await vscode.window.showInputBox({
      prompt: 'Enter value to compare',
      placeHolder: 'e.g., "documentation", "example.com"'
    });
    if (!value) return null;

    condition = {
      operator: 'and',
      field,
      comparator: comparator as any,
      value
    };
  }

  // Get action
  const action_type = await vscode.window.showQuickPick(
    ['Accept', 'Reject', 'Tag', 'Priority Boost'],
    { placeHolder: 'Select action when rule matches' }
  );
  if (!action_type) return null;

  let action: RuleAction;
  if (action_type === 'Tag') {
    const tag = await vscode.window.showInputBox({
      prompt: 'Enter tag to apply',
      placeHolder: 'e.g., "important"'
    });
    action = {
      type: 'tag',
      value: tag || 'matched'
    };
  } else {
    action = {
      type: action_type.toLowerCase().replace(' ', '_') as any
    };
  }

  // Get priority
  const priority_str = await vscode.window.showInputBox({
    prompt: 'Enter rule priority (higher = evaluated first)',
    placeHolder: '0-1000',
    value: '50'
  });
  const priority = parseInt(priority_str || '50', 10);

  // Get description
  const description = await vscode.window.showInputBox({
    prompt: 'Enter rule description (optional)',
    placeHolder: 'Describe what this rule does'
  });

  return {
    name,
    description,
    type: type.toLowerCase().replace(' ', '_') as any,
    condition,
    action,
    priority,
    enabled: true
  };
}

async function show_rule_manager(procedural_store: ProceduralMemoryStore): Promise<void> {
  const rules = await procedural_store.get_all_rules();
  
  const items = rules.map(rule => ({
    label: `${rule.enabled ? '✓' : '✗'} ${rule.name}`,
    description: `Priority: ${rule.priority}, Type: ${rule.type}, Used: ${rule.usage_count} times`,
    detail: rule.description,
    rule
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a rule to manage',
    canPickMany: false
  });

  if (!selected) return;

  const action = await vscode.window.showQuickPick(
    ['Toggle Enable/Disable', 'Edit', 'Delete', 'View Details'],
    { placeHolder: `Action for "${selected.rule.name}"` }
  );

  if (!action) return;

  switch (action) {
    case 'Toggle Enable/Disable':
      await procedural_store.update_rule(selected.rule.id, {
        enabled: !selected.rule.enabled
      });
      vscode.window.showInformationMessage(
        `Rule "${selected.rule.name}" ${selected.rule.enabled ? 'disabled' : 'enabled'}`
      );
      break;

    case 'Edit': {
      // Simple edit for priority
      const new_priority = await vscode.window.showInputBox({
        prompt: 'Enter new priority',
        value: selected.rule.priority.toString()
      });
      if (new_priority) {
        await procedural_store.update_rule(selected.rule.id, {
          priority: parseInt(new_priority, 10)
        });
        vscode.window.showInformationMessage(`Rule priority updated`);
      }
      break;
    }

    case 'Delete': {
      const confirm = await vscode.window.showWarningMessage(
        `Delete rule "${selected.rule.name}"?`,
        'Delete',
        'Cancel'
      );
      if (confirm === 'Delete') {
        await procedural_store.delete_rule(selected.rule.id);
        vscode.window.showInformationMessage(`Rule deleted`);
      }
      break;
    }

    case 'View Details': {
      const panel = vscode.window.createWebviewPanel(
        'ruleDetails',
        selected.rule.name,
        vscode.ViewColumn.One,
        {}
      );
      panel.webview.html = `
        <html>
        <body>
          <h1>${selected.rule.name}</h1>
          <p>${selected.rule.description || 'No description'}</p>
          <h3>Details:</h3>
          <pre>${JSON.stringify(selected.rule, null, 2)}</pre>
        </body>
        </html>
      `;
      break;
    }
  }
}

function generate_stats_html(stats: any[]): string {
  const rows = stats.map(s => `
    <tr>
      <td>${s.name}</td>
      <td>${s.type}</td>
      <td>${s.usage_count}</td>
      <td>${s.total_executions}</td>
      <td>${s.matches}</td>
      <td>${s.avg_execution_time?.toFixed(2) || 'N/A'} ms</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        tr:hover { background-color: #f5f5f5; }
      </style>
    </head>
    <body>
      <h1>Filter Rule Statistics</h1>
      <table>
        <thead>
          <tr>
            <th>Rule Name</th>
            <th>Type</th>
            <th>Usage Count</th>
            <th>Total Executions</th>
            <th>Matches</th>
            <th>Avg Execution Time</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </body>
    </html>
  `;
}