#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

// ANSI color codes
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

interface Violation {
  type: string;
  name: string;
  file: string;
  line: number;
  expected: string;
}

function is_snake_case(name: string): boolean {
  // Single lowercase words are acceptable (like 'note', 'parser', 'user')
  if (/^[a-z]+$/.test(name)) return true;
  // Otherwise must be proper snake_case
  return /^[a-z][a-z0-9_]*$/.test(name);
}

function is_pascal_case(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function is_upper_snake_case(name: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(name);
}

// Whitelist of specific names that are exceptions
const NAMING_WHITELIST = [
  'PageAnalysisSchemaWithoutPageSessionId',  // Zod schema
  'AgentStateAnnotation',  // Annotation type
  'WebpageTreeNodeCollectionSpec',  // Spec type
  'ConnectionCollectionSpec',  // Spec type
  'NoteSchema',  // Zod schema
];

function should_skip(name: string, file: string): boolean {
  // Skip test functions and hooks
  const skip_names = [
    'describe', 'it', 'test', 'expect',
    'beforeEach', 'afterEach', 'beforeAll', 'afterAll',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'
  ];
  
  if (skip_names.includes(name)) return true;
  
  // Skip whitelisted names
  if (NAMING_WHITELIST.includes(name)) return true;
  
  // Skip mock variables in test files
  if (file.includes('.test.') && (name.startsWith('mock') || name.startsWith('Mock'))) {
    return true;
  }
  
  // Skip React hooks
  if (name.startsWith('use') && is_pascal_case(name.substring(3))) {
    return true;
  }
  
  return false;
}

async function check_file(file_path: string, verbose: boolean): Promise<Violation[]> {
  const violations: Violation[] = [];
  const content = fs.readFileSync(file_path, 'utf-8');
  const lines = content.split('\n');
  
  // Check filename
  const basename = path.basename(file_path, path.extname(file_path));
  if (!basename.includes('.test') && !basename.includes('.spec') && basename !== 'index') {
    if (!is_snake_case(basename)) {
      violations.push({
        type: 'filename',
        name: basename,
        file: file_path,
        line: 0,
        expected: 'snake_case'
      });
    } else if (verbose) {
      console.log(`${GREEN}✓${RESET} File: ${basename}`);
    }
  }
  
  // Patterns to check
  const patterns = [
    // Function declarations
    {
      regex: /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      type: 'function',
      expected: 'snake_case',
      check: (name: string, line?: string) => !is_snake_case(name)
    },
    // Const/let/var declarations (not in test files for mocks)
    {
      regex: /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      type: 'variable',
      expected: 'snake_case',
      check: (name: string, line?: string) => {
        // Skip if it's a Schema, Spec, Error, Annotation, or other PascalCase convention
        if (name.endsWith('Schema') || name.endsWith('Spec') || name.endsWith('Error') || 
            name.endsWith('Annotation') || name.includes('Schema') || 
            name.endsWith('Type') || name.endsWith('Config')) {
          return !is_pascal_case(name);
        }
        
        // Check if it's an all-caps constant (like MEMORY_NAMESPACES)
        if (is_upper_snake_case(name)) {
          return false; // Valid UPPER_SNAKE_CASE constant
        }
        
        // Variables that ARE schemas/specs themselves should be PascalCase
        // But variables holding results from schema/spec methods should be snake_case
        if (line && name.includes('Schema') && 
            (line.includes('.omit(') || line.includes('.pick(') || 
             line.includes('.extend(') || line.includes('.merge('))) {
          return !is_pascal_case(name);
        }
        
        // Annotation types should be PascalCase
        if (line && name.includes('Annotation') && line.includes('Annotation.')) {
          return !is_pascal_case(name);
        }
        
        // Check if it's a literal constant (could be UPPER_SNAKE_CASE or snake_case)
        if (line && line.includes('=') && (line.includes('"') || line.includes("'") || /=\s*\d+/.test(line))) {
          return !is_snake_case(name) && !is_upper_snake_case(name);
        }
        
        return !is_snake_case(name);
      }
    },
    // Class declarations
    {
      regex: /(?:export\s+)?class\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      type: 'class',
      expected: 'PascalCase',
      check: (name: string, line?: string) => !is_pascal_case(name)
    },
    // Interface declarations
    {
      regex: /(?:export\s+)?interface\s+([a-zA-Z_][a-zA-Z0-9_]*)/g,
      type: 'interface',
      expected: 'PascalCase',
      check: (name: string, line?: string) => !is_pascal_case(name)
    },
    // Type declarations
    {
      regex: /(?:export\s+)?type\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g,
      type: 'type',
      expected: 'PascalCase',
      check: (name: string, line?: string) => !is_pascal_case(name)
    }
  ];
  
  lines.forEach((line, index) => {
    // Skip comments
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    
    patterns.forEach(pattern => {
      pattern.regex.lastIndex = 0; // Reset regex
      let match;
      while ((match = pattern.regex.exec(line)) !== null) {
        const name = match[1];
        if (should_skip(name, file_path)) continue;
        
        const has_violation = pattern.check(name, line);
          
        if (has_violation) {
          violations.push({
            type: pattern.type,
            name,
            file: file_path,
            line: index + 1,
            expected: pattern.expected
          });
        } else if (verbose) {
          console.log(`${GREEN}✓${RESET} ${pattern.type}: ${name}`);
        }
      }
    });
  });
  
  return violations;
}

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v') || args.includes('--verbose');
  const fix = args.includes('--fix');
  
  console.log('🔍 Checking TypeScript/JavaScript naming conventions...');
  console.log('='.repeat(60));
  
  const patterns = [
    'vscode/src/**/*.ts',
    'vscode/src/**/*.tsx', 
    'browser-extension/src/**/*.ts',
    'browser-extension/src/**/*.tsx',
    'browser-extension/src/**/*.js',
    'browser-extension/src/**/*.jsx'
  ];
  
  const all_violations: Violation[] = [];
  
  for (const pattern of patterns) {
    const files = await glob(pattern, {
      ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts', '**/__mocks__/**']
    });
    
    for (const file of files) {
      const violations = await check_file(file, verbose);
      all_violations.push(...violations);
    }
  }
  
  // Print report
  console.log('\n' + '='.repeat(60));
  
  if (all_violations.length === 0) {
    console.log(`${GREEN}✅ All naming conventions are correct!${RESET}`);
    process.exit(0);
  }
  
  console.log(`${RED}❌ Found ${all_violations.length} naming convention violations:${RESET}\n`);
  
  // Group by type
  const by_type = all_violations.reduce((acc, v) => {
    if (!acc[v.type]) acc[v.type] = [];
    acc[v.type].push(v);
    return acc;
  }, {} as Record<string, Violation[]>);
  
  for (const [type, violations] of Object.entries(by_type)) {
    console.log(`\n${YELLOW}${type.charAt(0).toUpperCase() + type.slice(1)} violations:${RESET}`);
    for (const v of violations.slice(0, 10)) { // Show first 10 of each type
      console.log(`  ${RED}✗${RESET} ${v.name} should be ${v.expected} at ${v.file}:${v.line}`);
    }
    if (violations.length > 10) {
      console.log(`  ... and ${violations.length - 10} more`);
    }
  }
  
  if (fix) {
    console.log(`\n${YELLOW}--fix flag detected but not yet implemented${RESET}`);
  }
  
  process.exit(1);
}

if (require.main === module) {
  main().catch(console.error);
}