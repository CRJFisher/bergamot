/**
 * Setup wizard UI for browser integration
 */

import * as vscode from 'vscode';
import { BrowserInfo, SetupState } from './models';

/**
 * Provides user interface for the setup process
 */
export class SetupWizard {
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('PKM Assistant Setup');
  }

  /**
   * Shows the initial setup prompt
   */
  async show_welcome(): Promise<'setup' | 'later' | 'never'> {
    const result = await vscode.window.showInformationMessage(
      'PKM Assistant: Set up browser integration for automatic webpage tracking?',
      { 
        modal: true,
        detail: 'This will:\n' +
                '• Install a native messaging host (no security warnings with Node.js)\n' +
                '• Open your browser extension store\n' +
                '• Verify the connection\n\n' +
                'The entire process takes less than 30 seconds.'
      },
      'Setup Now',
      'Later',
      'Never Ask Again'
    );

    switch (result) {
      case 'Setup Now':
        return 'setup';
      case 'Never Ask Again':
        return 'never';
      default:
        return 'later';
    }
  }

  /**
   * Shows browser selection dialog
   */
  async select_browser(browsers: BrowserInfo[]): Promise<BrowserInfo | undefined> {
    if (browsers.length === 0) {
      await vscode.window.showErrorMessage(
        'No supported browsers found. Please install Chrome, Firefox, or Edge.'
      );
      return undefined;
    }

    if (browsers.length === 1) {
      // Only one browser, use it automatically
      return browsers[0];
    }

    // Sort browsers with default first
    const sortedBrowsers = [...browsers].sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return 0;
    });

    // Create quick pick items
    const items = sortedBrowsers.map(browser => ({
      label: browser.name,
      description: browser.isDefault ? '(Default)' : '',
      detail: `Version ${browser.version}`,
      browser
    }));

    const selected = await vscode.window.showQuickPick(items, {
      title: 'Select Browser for Integration',
      placeHolder: 'Choose which browser to set up'
    });

    return selected?.browser;
  }

  /**
   * Shows progress during setup
   */
  async show_progress<T>(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<T>
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title,
        cancellable: false
      },
      task
    );
  }

  /**
   * Shows status update
   */
  show_status(state: SetupState, message?: string): void {
    const statusMessages: Record<SetupState, string> = {
      [SetupState.IDLE]: 'Ready to begin setup',
      [SetupState.CHECKING_EXISTING]: 'Checking existing installation...',
      [SetupState.DETECTING_BROWSERS]: 'Detecting installed browsers...',
      [SetupState.SELECTING_BROWSER]: 'Selecting browser...',
      [SetupState.INSTALLING_NATIVE_HOST]: 'Installing native messaging host...',
      [SetupState.CONFIGURING_MANIFEST]: 'Configuring browser manifest...',
      [SetupState.OPENING_EXTENSION_STORE]: 'Opening extension store...',
      [SetupState.WAITING_FOR_EXTENSION]: 'Waiting for browser extension installation...',
      [SetupState.VERIFYING_CONNECTION]: 'Verifying connection...',
      [SetupState.COMPLETE]: '✅ Setup complete!',
      [SetupState.ERROR]: '❌ Setup failed',
      [SetupState.CANCELLED]: 'Setup cancelled'
    };

    const statusMessage = message || statusMessages[state];
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${statusMessage}`);
  }

  /**
   * Shows error message with recovery options
   */
  async show_error(error: Error, canRetry: boolean = true): Promise<'retry' | 'cancel'> {
    this.outputChannel.appendLine(`[ERROR] ${error.message}`);
    this.outputChannel.show();

    const options = canRetry ? ['Retry', 'Cancel'] : ['OK'];
    
    const result = await vscode.window.showErrorMessage(
      `Setup failed: ${error.message}`,
      { modal: true },
      ...options
    );

    return result === 'Retry' ? 'retry' : 'cancel';
  }

  /**
   * Shows success message
   */
  async show_success(browser: BrowserInfo): Promise<void> {
    const message = `Browser integration successfully set up for ${browser.name}!\n\n` +
                   'You can now browse the web and your pages will be automatically tracked.';

    await vscode.window.showInformationMessage(message, { modal: true }, 'Great!');
  }

  /**
   * Shows instructions for installing browser extension
   */
  async show_extension_instructions(browser: BrowserInfo): Promise<void> {
    const message = `Please install the PKM Assistant browser extension:\n\n` +
                   `1. Your browser will open to the extension store\n` +
                   `2. Click "Add to ${browser.name}"\n` +
                   `3. The extension will connect automatically\n\n` +
                   `Click OK to open the extension store.`;

    await vscode.window.showInformationMessage(
      message,
      { modal: true },
      'OK'
    );
  }

  /**
   * Shows waiting message while checking for extension
   */
  show_waiting_for_extension(): vscode.Disposable {
    return vscode.window.setStatusBarMessage(
      '$(sync~spin) Waiting for browser extension installation...'
    );
  }

  /**
   * Cleans up resources
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}