#!/usr/bin/env npx tsx
/**
 * Master test runner for all E2E navigation tests
 * Runs all test suites and collects results
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestSuite {
  name: string;
  script: string;
  description: string;
}

interface TestRunResult {
  suite: string;
  passed: boolean;
  duration_ms: number;
  output: string;
  error?: string;
}

class E2ETestRunner {
  private test_suites: TestSuite[] = [
    {
      name: 'Basic Navigation',
      script: 'navigation_e2e_tests.ts',
      description: 'Traditional navigation, forms, redirects, iframes'
    },
    {
      name: 'SPA Navigation',
      script: 'spa_navigation_tests.ts',
      description: 'Single Page Application navigation patterns'
    },
    {
      name: 'Multi-Tab Navigation',
      script: 'multi_tab_navigation_tests.ts',
      description: 'Tab relationships and cross-tab navigation'
    },
    {
      name: 'Edge Cases',
      script: 'edge_cases_tests.ts',
      description: 'Special scenarios and error conditions'
    }
  ];

  private results: TestRunResult[] = [];
  private start_time: number = 0;

  async run_all_tests(): Promise<void> {
    console.log('🚀 PKM Assistant E2E Test Suite Runner');
    console.log('='.repeat(60));
    console.log('Running all navigation tracking tests...\n');

    this.start_time = Date.now();

    // Build the extension first
    console.log('📦 Building extension...');
    await this.run_command('npm', ['run', 'build']);
    console.log('✅ Build complete\n');

    // Run each test suite
    for (const suite of this.test_suites) {
      await this.run_test_suite(suite);
    }

    // Print summary
    this.print_summary();

    // Save results to file
    await this.save_results();
  }

  private async run_test_suite(suite: TestSuite): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 Running: ${suite.name}`);
    console.log(`   ${suite.description}`);
    console.log('-'.repeat(60));

    const suite_start = Date.now();
    const script_path = path.join(__dirname, suite.script);

    try {
      const output = await this.run_command('npx', ['tsx', script_path]);
      const duration = Date.now() - suite_start;

      // Check if tests passed based on output
      const passed = output.includes('All tests passed') || 
                     output.includes('All SPA navigation tests passed') ||
                     output.includes('All multi-tab navigation tests passed') ||
                     output.includes('All edge case tests passed') ||
                     (output.includes('OVERALL:') && !output.includes('failed'));

      this.results.push({
        suite: suite.name,
        passed,
        duration_ms: duration,
        output
      });

      if (passed) {
        console.log(`✅ ${suite.name} completed successfully (${duration}ms)`);
      } else {
        console.log(`⚠️  ${suite.name} completed with failures (${duration}ms)`);
      }

    } catch (error) {
      const duration = Date.now() - suite_start;
      
      this.results.push({
        suite: suite.name,
        passed: false,
        duration_ms: duration,
        output: '',
        error: String(error)
      });

      console.log(`❌ ${suite.name} failed with error (${duration}ms)`);
      console.error(error);
    }
  }

  private run_command(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      let output = '';
      let error_output = '';

      const proc = spawn(command, args, {
        cwd: path.join(__dirname, '..'),
        shell: true
      });

      proc.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });

      proc.stderr?.on('data', (data) => {
        const text = data.toString();
        error_output += text;
        process.stderr.write(text);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command failed with code ${code}: ${error_output}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  private print_summary(): void {
    const total_duration = Date.now() - this.start_time;
    const passed_suites = this.results.filter(r => r.passed).length;
    const total_suites = this.results.length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 E2E TEST SUITE SUMMARY');
    console.log('='.repeat(60));

    // Individual suite results
    console.log('\nTest Suite Results:');
    for (const result of this.results) {
      const status = result.passed ? '✅ PASSED' : '❌ FAILED';
      const time = `${(result.duration_ms / 1000).toFixed(1)}s`;
      console.log(`  ${status} - ${result.suite} (${time})`);
      
      if (result.error) {
        console.log(`    Error: ${result.error.split('\n')[0]}`);
      }
    }

    // Extract test counts from outputs
    let total_tests = 0;
    let passed_tests = 0;

    for (const result of this.results) {
      const match = result.output.match(/(\d+)\/(\d+) tests? passed/);
      if (match) {
        passed_tests += parseInt(match[1]);
        total_tests += parseInt(match[2]);
      }
    }

    // Overall statistics
    console.log('\nOverall Statistics:');
    console.log(`  Suites: ${passed_suites}/${total_suites} passed`);
    if (total_tests > 0) {
      console.log(`  Tests: ${passed_tests}/${total_tests} passed`);
      console.log(`  Pass Rate: ${((passed_tests / total_tests) * 100).toFixed(1)}%`);
    }
    console.log(`  Total Duration: ${(total_duration / 1000).toFixed(1)}s`);

    console.log('\n' + '='.repeat(60));
    
    if (passed_suites === total_suites) {
      console.log('🎉 All E2E test suites passed successfully!');
    } else {
      console.log(`⚠️  ${total_suites - passed_suites} test suite(s) failed.`);
      console.log('Please review the failures above and debug the failing tests.');
    }
    
    console.log('='.repeat(60));
  }

  private async save_results(): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - this.start_time,
      suites: this.results.map(r => ({
        name: r.suite,
        passed: r.passed,
        duration_ms: r.duration_ms,
        error: r.error
      })),
      summary: {
        total_suites: this.results.length,
        passed_suites: this.results.filter(r => r.passed).length,
        failed_suites: this.results.filter(r => !r.passed).length
      }
    };

    const report_path = path.join(__dirname, 'test_results.json');
    await fs.writeFile(report_path, JSON.stringify(report, null, 2));
    
    console.log(`\n📄 Test results saved to: ${report_path}`);
  }
}

// Run if executed directly
const runner = new E2ETestRunner();
runner.run_all_tests()
  .then(() => {
    console.log('\n✅ E2E test runner completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ E2E test runner failed:', error);
    process.exit(1);
  });