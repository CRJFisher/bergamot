import { FilterConfig } from '../workflow/webpage_filter';
import * as vscode from 'vscode';

export function get_filter_config(): FilterConfig {
  const config = vscode.workspace.getConfiguration('bergamot.webpageFilter');
  
  return {
    enabled: config.get<boolean>('enabled', true),
    allowed_types: config.get<string[]>('allowedTypes', ['knowledge']),
    min_confidence: config.get<number>('minConfidence', 0.7),
    log_decisions: config.get<boolean>('logDecisions', true)
  };
}