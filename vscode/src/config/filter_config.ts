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

// Default configuration for VS Code settings
export const FILTER_CONFIG_DEFAULTS = {
  'pkmAssistant.webpageFilter.enabled': {
    type: 'boolean',
    default: true,
    description: 'Enable webpage filtering based on content type'
  },
  'pkmAssistant.webpageFilter.allowedTypes': {
    type: 'array',
    default: ['knowledge'],
    description: 'Types of pages to process',
    items: {
      type: 'string',
      enum: ['knowledge', 'interactive_app', 'aggregator', 'leisure', 'navigation', 'other']
    }
  },
  'pkmAssistant.webpageFilter.minConfidence': {
    type: 'number',
    default: 0.7,
    minimum: 0,
    maximum: 1,
    description: 'Minimum confidence threshold for page classification'
  },
  'pkmAssistant.webpageFilter.logDecisions': {
    type: 'boolean',
    default: true,
    description: 'Log filtering decisions to console'
  }
};