/**
 * Main orchestrator for browser integration setup
 */

import * as vscode from 'vscode';
import { 
  SetupState, 
  SetupResult, 
  InstallationStatus,
  BrowserInfo,
  EXTENSION_STORES 
} from './models';
import { BrowserDetector } from './browser_detector';
import { NativeHostInstaller } from './native_host_installer';
import { SetupWizard } from './setup_wizard';
import { ConnectionVerifier } from './connection_verifier';

/**
 * Main class for browser integration setup
 * Provides zero-friction installation with Node.js native host
 */
export class BrowserIntegrationSetup {
  private state: SetupState = SetupState.IDLE;
  private wizard: SetupWizard;
  private detector: BrowserDetector;
  private installer: NativeHostInstaller;
  private verifier: ConnectionVerifier;

  constructor(private context: vscode.ExtensionContext) {
    this.wizard = new SetupWizard();
    this.detector = new BrowserDetector();
    this.installer = new NativeHostInstaller(context);
    this.verifier = new ConnectionVerifier();
  }

  /**
   * Checks the current installation status
   */
  async check_installation(): Promise<InstallationStatus> {
    const status: InstallationStatus = {
      isComplete: false,
      hasNativeHost: false,
      hasBrowserExtension: false,
      isConnected: false,
      installedBrowsers: [],
      errors: []
    };

    try {
      // Check native host
      status.hasNativeHost = await this.installer.is_installed();
      
      // Detect browsers
      status.installedBrowsers = await this.detector.detect_all_browsers();
      
      // Check connection
      if (status.hasNativeHost) {
        status.isConnected = await this.verifier.verify_connection(5000);
        status.hasBrowserExtension = status.isConnected;
      }

      status.isComplete = status.hasNativeHost && 
                         status.hasBrowserExtension && 
                         status.isConnected;

    } catch (error) {
      status.errors.push(error.message);
    }

    return status;
  }

  /**
   * Runs the complete setup process
   */
  async run_setup(): Promise<SetupResult> {
    const result: SetupResult = {
      success: false,
      state: SetupState.IDLE
    };

    try {
      // Show welcome
      const welcomeChoice = await this.wizard.show_welcome();
      if (welcomeChoice === 'later') {
        result.state = SetupState.CANCELLED;
        return result;
      }
      if (welcomeChoice === 'never') {
        await this.context.globalState.update('browserIntegration.neverAsk', true);
        result.state = SetupState.CANCELLED;
        return result;
      }

      // Run setup with progress
      await this.wizard.show_progress(
        'Setting up browser integration',
        async (progress) => {
          // Step 1: Check existing installation
          this.set_state(SetupState.CHECKING_EXISTING);
          progress.report({ message: 'Checking existing installation...', increment: 10 });
          
          const status = await this.check_installation();
          if (status.isComplete) {
            this.set_state(SetupState.COMPLETE);
            result.success = true;
            result.state = SetupState.COMPLETE;
            await this.wizard.show_success(status.installedBrowsers[0]);
            return;
          }

          // Step 2: Detect browsers
          this.set_state(SetupState.DETECTING_BROWSERS);
          progress.report({ message: 'Detecting installed browsers...', increment: 10 });
          
          const browsers = await this.detector.detect_all_browsers();
          if (browsers.length === 0) {
            throw new Error('No supported browsers found. Please install Chrome, Firefox, or Edge.');
          }

          // Step 3: Select browser
          this.set_state(SetupState.SELECTING_BROWSER);
          progress.report({ message: 'Selecting browser...', increment: 10 });
          
          const selectedBrowser = await this.wizard.select_browser(browsers);
          if (!selectedBrowser) {
            this.set_state(SetupState.CANCELLED);
            result.state = SetupState.CANCELLED;
            return;
          }
          result.browser = selectedBrowser;

          // Step 4: Install native host
          this.set_state(SetupState.INSTALLING_NATIVE_HOST);
          progress.report({ message: 'Installing native messaging host...', increment: 20 });
          
          const { manifestPath, hostPath } = await this.installer.install(selectedBrowser);
          result.manifestPath = manifestPath;
          result.installationPath = hostPath;

          // Step 5: Open browser extension store
          this.set_state(SetupState.OPENING_EXTENSION_STORE);
          progress.report({ message: 'Opening browser extension store...', increment: 20 });
          
          await this.wizard.show_extension_instructions(selectedBrowser);
          const storeUrl = EXTENSION_STORES[selectedBrowser.type];
          if (storeUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(storeUrl));
          }

          // Step 6: Wait for extension installation
          this.set_state(SetupState.WAITING_FOR_EXTENSION);
          progress.report({ message: 'Waiting for browser extension...', increment: 20 });
          
          const waitingIndicator = this.wizard.show_waiting_for_extension();
          const extensionInstalled = await this.verifier.wait_for_extension(30000);
          waitingIndicator.dispose();

          if (!extensionInstalled) {
            // Don't fail completely, user might install later
            vscode.window.showInformationMessage(
              'Browser extension not detected yet. Please install it from the store and restart VS Code.',
              'OK'
            );
          }

          // Step 7: Verify connection
          this.set_state(SetupState.VERIFYING_CONNECTION);
          progress.report({ message: 'Verifying connection...', increment: 10 });
          
          const isConnected = await this.verifier.verify_connection();
          if (isConnected) {
            this.set_state(SetupState.COMPLETE);
            result.success = true;
            result.state = SetupState.COMPLETE;
            await this.wizard.show_success(selectedBrowser);
          } else {
            vscode.window.showWarningMessage(
              'Setup completed but connection not verified. The extension should work once you install the browser extension.',
              'OK'
            );
            result.success = true; // Partial success
            result.state = SetupState.COMPLETE;
          }
        }
      );

    } catch (error: any) {
      this.set_state(SetupState.ERROR);
      result.state = SetupState.ERROR;
      result.error = error;

      const retryChoice = await this.wizard.show_error(error);
      if (retryChoice === 'retry') {
        return this.run_setup();
      }
    } finally {
      this.cleanup();
    }

    return result;
  }

  /**
   * Checks if this is the first run and should prompt for setup
   */
  async should_prompt_setup(): Promise<boolean> {
    // Check if user said "never ask again"
    const neverAsk = this.context.globalState.get<boolean>('browserIntegration.neverAsk', false);
    if (neverAsk) {
      return false;
    }

    // Check if already set up
    const status = await this.check_installation();
    if (status.isComplete) {
      return false;
    }

    // Check if we've prompted recently (don't nag)
    const lastPrompt = this.context.globalState.get<number>('browserIntegration.lastPrompt', 0);
    const daysSincePrompt = (Date.now() - lastPrompt) / (1000 * 60 * 60 * 24);
    
    if (daysSincePrompt < 7) {
      return false; // Don't prompt more than once a week
    }

    return true;
  }

  /**
   * Records that we've prompted the user
   */
  async record_prompt(): Promise<void> {
    await this.context.globalState.update('browserIntegration.lastPrompt', Date.now());
  }

  /**
   * Repairs an existing installation
   */
  async repair(): Promise<SetupResult> {
    // Uninstall first
    await this.installer.uninstall();
    
    // Then run setup again
    return this.run_setup();
  }

  /**
   * Uninstalls the browser integration
   */
  async uninstall(): Promise<void> {
    await this.installer.uninstall();
    vscode.window.showInformationMessage('Browser integration has been removed.', 'OK');
  }

  /**
   * Sets the current state and notifies the wizard
   */
  private set_state(state: SetupState): void {
    this.state = state;
    this.wizard.show_status(state);
  }

  /**
   * Cleans up resources
   */
  private cleanup(): void {
    this.verifier.cleanup();
    this.wizard.dispose();
  }
}

/**
 * Registers the browser integration commands
 */
export function register_browser_integration_commands(context: vscode.ExtensionContext): void {
  // Setup command
  context.subscriptions.push(
    vscode.commands.registerCommand('pkm-assistant.setupBrowserIntegration', async () => {
      const setup = new BrowserIntegrationSetup(context);
      await setup.run_setup();
    })
  );

  // Repair command
  context.subscriptions.push(
    vscode.commands.registerCommand('pkm-assistant.repairBrowserIntegration', async () => {
      const setup = new BrowserIntegrationSetup(context);
      await setup.repair();
    })
  );

  // Uninstall command
  context.subscriptions.push(
    vscode.commands.registerCommand('pkm-assistant.uninstallBrowserIntegration', async () => {
      const setup = new BrowserIntegrationSetup(context);
      await setup.uninstall();
    })
  );

  // Check status command
  context.subscriptions.push(
    vscode.commands.registerCommand('pkm-assistant.checkBrowserIntegration', async () => {
      const setup = new BrowserIntegrationSetup(context);
      const status = await setup.check_installation();
      
      const message = status.isComplete 
        ? '✅ Browser integration is working correctly!'
        : '❌ Browser integration is not fully configured.';
      
      const detail = [
        `Native Host: ${status.hasNativeHost ? '✅' : '❌'}`,
        `Browser Extension: ${status.hasBrowserExtension ? '✅' : '❌'}`,
        `Connection: ${status.isConnected ? '✅' : '❌'}`,
        `Browsers Found: ${status.installedBrowsers.map(b => b.name).join(', ') || 'None'}`
      ].join('\n');

      vscode.window.showInformationMessage(message, { modal: true, detail }, 'OK');
    })
  );
}