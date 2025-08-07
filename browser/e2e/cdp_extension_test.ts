import CDP from 'chrome-remote-interface';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface ConsoleMessage {
  timestamp: string;
  context_id: number;
  message: string;
}

interface TabHistoryDebugInfo {
  tab_id: number;
  current_url?: string;
  previous_url?: string;
  opener_tab_id?: number;
  timestamp: number;
}

export class ExtensionTestRunner {
  private chrome_process: ChildProcess | null = null;
  private client: CDP.Client | null = null;
  private user_data_dir: string | null = null;
  private debugging_port: number = 9222;
  private console_logs: ConsoleMessage[] = [];
  private headless: boolean = false;

  async setup(options: { headless?: boolean } = {}): Promise<void> {
    this.headless = options.headless || false;
    // Create isolated user data directory
    this.user_data_dir = path.join(os.tmpdir(), `chrome-ext-test-${Date.now()}`);
    await fs.mkdir(this.user_data_dir, { recursive: true });

    const extension_path = path.resolve(__dirname, '../chrome');
    
    // Chrome launch arguments for isolation
    const chrome_args = [
      `--user-data-dir=${this.user_data_dir}`,
      `--remote-debugging-port=${this.debugging_port}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--disable-translate',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-device-discovery-notifications',
      `--disable-extensions-except=${extension_path}`,
      `--load-extension=${extension_path}`,
      '--window-size=1280,800',
      '--window-position=100,100'
    ];
    
    // Add headless flags if requested
    if (this.headless) {
      chrome_args.push('--headless=new'); // Use new headless mode
      chrome_args.push('--disable-gpu');
    }

    console.log('🚀 Starting isolated Chrome instance...');
    console.log(`📁 User data dir: ${this.user_data_dir}`);
    console.log(`🔌 Debug port: ${this.debugging_port}`);
    
    // Find Chrome executable
    const chrome_path = await this.find_chrome_executable();
    
    this.chrome_process = spawn(chrome_path, chrome_args, {
      detached: false,
      stdio: 'pipe'
    });

    this.chrome_process.on('error', (err) => {
      console.error('Chrome process error:', err);
    });

    // Wait for Chrome to be ready
    await this.wait_for_chrome();

    // Connect via CDP
    this.client = await CDP({ port: this.debugging_port });
    console.log('✅ Connected to Chrome via CDP');
  }

  private async find_chrome_executable(): Promise<string> {
    const possible_paths = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
      '/usr/bin/google-chrome', // Linux
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // Windows
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];

    for (const chrome_path of possible_paths) {
      try {
        await fs.access(chrome_path);
        return chrome_path;
      } catch {
        // Try next path
      }
    }

    // Try to find in PATH
    return 'google-chrome';
  }

  private async wait_for_chrome(max_attempts: number = 30): Promise<void> {
    console.log('⏳ Waiting for Chrome to start...');
    
    for (let i = 0; i < max_attempts; i++) {
      try {
        const targets = await CDP.List({ port: this.debugging_port });
        if (targets.length > 0) {
          console.log('✅ Chrome is ready');
          return;
        }
      } catch (e) {
        // Chrome not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Chrome failed to start within timeout');
  }

  async enable_console_monitoring(): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    
    const { Runtime, Page } = this.client;
    
    // Enable necessary domains
    await Runtime.enable();
    await Page.enable();

    // Monitor console API calls from all contexts
    Runtime.consoleAPICalled((params) => {
      const timestamp = new Date().toISOString();
      const context_id = params.executionContextId;
      const messages = params.args.map(arg => {
        if (arg.value !== undefined) return String(arg.value);
        if (arg.description) return arg.description;
        return arg.type;
      }).join(' ');
      
      const log_entry: ConsoleMessage = {
        timestamp,
        context_id,
        message: messages
      };
      
      this.console_logs.push(log_entry);
      console.log(`[${timestamp}] [Context ${context_id}] ${messages}`);
    });

    // Also monitor runtime exceptions
    Runtime.exceptionThrown((params) => {
      console.error('Runtime exception:', params.exceptionDetails);
    });
  }

  async navigate_to(url: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    
    console.log(`📍 Navigating to: ${url}`);
    const { Page } = this.client;
    
    await Page.navigate({ url });
    
    // For simple test pages, just wait for DOM content instead of full load
    try {
      await Promise.race([
        Page.domContentEventFired(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DOM timeout')), 500))
      ]);
    } catch (error) {
      // Continue anyway - our test pages are simple and load fast
    }
    
    // Wait a bit for extension to initialize and send visit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async open_new_tab(url: string): Promise<string> {
    if (!this.client) throw new Error('Client not connected');
    
    console.log(`📑 Opening new tab: ${url}`);
    const { Target } = this.client;
    
    const { targetId } = await Target.createTarget({ url });
    
    // Wait for new tab to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return targetId;
  }

  async click_link_in_new_tab(selector: string): Promise<void> {
    if (!this.client) throw new Error('Client not connected');
    
    const { Runtime } = this.client;
    
    // Simulate Ctrl+Click (Cmd+Click on Mac) to open in new tab
    await Runtime.evaluate({
      expression: `
        const link = document.querySelector('${selector}');
        if (link) {
          const event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            ctrlKey: true, // or metaKey for Mac
            button: 0
          });
          link.dispatchEvent(event);
        }
      `
    });
    
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  async get_extension_id(): Promise<string | null> {
    if (!this.extension_path) return null;
    
    // Wait a bit for extension to be loaded
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get the extension ID from Chrome's management API
    // Since we're loading unpacked, we need to get it from the loaded extensions
    try {
      const targets = await CDP.List({ port: this.debugging_port });
      console.log(`Found ${targets.length} targets:`);
      targets.forEach(t => {
        console.log(`  - ${t.type}: ${t.url || t.title}`);
      });
      
      // Look for any chrome-extension URL
      for (const target of targets) {
        if (target.url?.startsWith('chrome-extension://')) {
          const match = target.url.match(/chrome-extension:\/\/([a-z0-9]+)/);
          if (match && match[1]) {
            console.log(`Found extension ID from URL: ${match[1]}`);
            return match[1];
          }
        }
      }
      
      // Try looking for service worker or background page
      const bg_target = targets.find(t => 
        t.type === 'service_worker' || 
        t.type === 'background_page' ||
        t.title?.includes('PKM') ||
        t.title?.includes('Extension')
      );
      
      if (bg_target && bg_target.url) {
        const match = bg_target.url.match(/chrome-extension:\/\/([a-z0-9]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch (e) {
      console.log('Could not get extension ID:', e);
    }
    
    return null;
  }

  async get_extension_state(): Promise<any> {
    if (!this.client) throw new Error('Client not connected');
    
    const { Runtime } = this.client;
    
    // Get all targets to find background page
    const targets = await CDP.List({ port: this.debugging_port });
    const background_target = targets.find(t => 
      t.type === 'background_page' || 
      t.url?.includes('background')
    );
    
    if (!background_target) {
      throw new Error('Background page not found');
    }
    
    // Connect to background page
    const bg_client = await CDP({ target: background_target.id, port: this.debugging_port });
    await bg_client.Runtime.enable();
    
    // Get tab history state
    const result = await bg_client.Runtime.evaluate({
      expression: `
        (() => {
          const state = [];
          if (typeof get_tab_history_store !== 'undefined') {
            const store = get_tab_history_store();
            for (const [tab_id, history] of store.entries()) {
              state.push({
                tab_id,
                current_url: history.current_url,
                previous_url: history.previous_url,
                opener_tab_id: history.opener_tab_id,
                timestamp: history.timestamp
              });
            }
          }
          return state;
        })()
      `,
      returnByValue: true
    });
    
    await bg_client.close();
    
    return result.result.value;
  }

  async wait_for_console_message(pattern: string | RegExp, timeout: number = 5000): Promise<ConsoleMessage | null> {
    const start_time = Date.now();
    
    while (Date.now() - start_time < timeout) {
      const found = this.console_logs.find(log => {
        if (typeof pattern === 'string') {
          return log.message.includes(pattern);
        } else {
          return pattern.test(log.message);
        }
      });
      
      if (found) return found;
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return null;
  }

  get_console_logs(): ConsoleMessage[] {
    return [...this.console_logs];
  }

  clear_console_logs(): void {
    this.console_logs = [];
  }

  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up...');
    
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    
    if (this.chrome_process) {
      this.chrome_process.kill('SIGTERM');
      
      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (this.chrome_process) {
          this.chrome_process.on('exit', () => resolve());
          setTimeout(() => resolve(), 5000); // Timeout
        } else {
          resolve();
        }
      });
      
      this.chrome_process = null;
    }
    
    // Clean up user data directory
    if (this.user_data_dir) {
      try {
        await fs.rm(this.user_data_dir, { recursive: true, force: true });
        console.log('✅ Cleaned up user data directory');
      } catch (e) {
        console.warn('⚠️  Failed to clean up user data directory:', e);
      }
    }
  }
}

// Example test implementation
export async function test_extension_state_persistence(): Promise<void> {
  const runner = new ExtensionTestRunner();
  
  try {
    await runner.setup();
    await runner.enable_console_monitoring();
    
    console.log('\n=== Extension State Persistence Test ===\n');
    
    // Test 1: Initial navigation
    console.log('📝 Test 1: Initial page load');
    await runner.navigate_to('https://example.com');
    
    // Verify visit was logged
    const visit_log = await runner.wait_for_console_message('Sending visit data');
    console.log('✅ Visit logged:', visit_log?.message);
    
    // Test 2: Navigation with referrer
    console.log('\n📝 Test 2: Navigate to second page');
    await runner.navigate_to('https://example.com/page2');
    
    // Test 3: Open in new tab
    console.log('\n📝 Test 3: Open page in new tab');
    await runner.open_new_tab('https://example.com/page3');
    
    // Wait for extension to process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 4: Verify extension state
    console.log('\n📝 Test 4: Checking extension state');
    const state = await runner.get_extension_state();
    
    console.log('\n📊 Extension State:');
    state.forEach((tab: TabHistoryDebugInfo) => {
      console.log(`  Tab ${tab.tab_id}:`);
      console.log(`    Current: ${tab.current_url}`);
      console.log(`    Previous: ${tab.previous_url || 'none'}`);
      console.log(`    Opener: ${tab.opener_tab_id || 'none'}`);
    });
    
    // Verify state persistence
    const has_multiple_tabs = state.length >= 2;
    const has_referrer = state.some((tab: TabHistoryDebugInfo) => tab.previous_url);
    const has_opener = state.some((tab: TabHistoryDebugInfo) => tab.opener_tab_id);
    
    console.log('\n✅ Test Results:');
    console.log(`  Multiple tabs tracked: ${has_multiple_tabs}`);
    console.log(`  Referrer preserved: ${has_referrer}`);
    console.log(`  Tab opener tracked: ${has_opener}`);
    
    if (has_multiple_tabs && has_referrer && has_opener) {
      console.log('\n🎉 All tests passed! Extension state persists correctly.');
    } else {
      console.log('\n❌ Some tests failed.');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await runner.cleanup();
  }
}

// Only run if this file is executed directly, not imported
// Commented out to prevent auto-execution on import
// test_extension_state_persistence()
//   .then(() => process.exit(0))
//   .catch(() => process.exit(1));
