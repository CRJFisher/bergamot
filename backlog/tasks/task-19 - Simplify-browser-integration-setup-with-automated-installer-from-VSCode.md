---
id: task-19
title: Simplify browser integration setup with automated installer from VSCode
status: To Do
assignee: []
created_date: '2025-08-07 21:36'
updated_date: '2025-08-07 23:30'
labels: []
dependencies: []
---

## Description

Currently users must manually run shell scripts and edit configuration files to set up the browser integration with native messaging. This is terrible UX. The VSCode extension should automate the entire setup process, installing both the native messaging host and guiding users to install the browser extension with a single command.

## Acceptance Criteria

- [ ] VSCode extension can install native messaging host automatically
- [ ] One-click setup command in VSCode
- [ ] Automatic detection of Chrome/Firefox installation
- [ ] Native host manifest files created with correct paths
- [ ] Python dependencies installed automatically
- [ ] Browser opened to extension installation page
- [ ] Clear progress indicators during setup
- [ ] Works on macOS, Linux, and Windows
- [ ] Graceful handling of errors with helpful messages
- [ ] No manual file editing required by users

## Implementation Plan

1. Add VSCode command `pkm-assistant.setupBrowserIntegration`
2. Create setup wizard with progress notifications
3. Detect OS and browser installations
4. Bundle native host Python script with VSCode extension
5. Implement automated native host installation
6. Generate and write manifest files with correct paths
7. Install Python dependencies via child_process
8. Open browser extension store page or local install
9. Add first-run detection to prompt for setup
10. Test on all platforms (macOS, Linux, Windows)

## Technical Design

### User Flow

```
1. User installs VSCode extension from marketplace
2. Extension shows: "Set up browser integration? [Setup Now]"
3. User clicks "Setup Now"
4. Automated installation runs:
   - Copies Python script to ~/.pkm-assistant/
   - Creates native messaging manifest
   - Installs Python dependencies
   - Opens browser to extension install page
5. User installs browser extension (one click)
6. Done! Everything connected and working
```

### Implementation Details

```typescript
// In extension.ts activation
async function activate(context: vscode.ExtensionContext) {
  // Check if first run or not set up
  if (!isNativeHostInstalled()) {
    const result = await vscode.window.showInformationMessage(
      'PKM Assistant: Set up browser integration for webpage tracking?',
      'Setup Now', 'Later'
    );
    
    if (result === 'Setup Now') {
      await vscode.commands.executeCommand('pkm-assistant.setupBrowserIntegration');
    }
  }
}

// Setup command implementation
async function setupBrowserIntegration(context: vscode.ExtensionContext) {
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Setting up browser integration",
    cancellable: false
  }, async (progress) => {
    // Step 1: Create directories
    progress.report({ message: 'Creating directories...' });
    const installDir = path.join(os.homedir(), '.pkm-assistant');
    await fs.promises.mkdir(installDir, { recursive: true });
    
    // Step 2: Copy native host
    progress.report({ message: 'Installing native messaging host...' });
    const pythonScript = path.join(context.extensionPath, 'resources', 'native_host.py');
    const targetPath = path.join(installDir, 'native_host.py');
    await fs.promises.copyFile(pythonScript, targetPath);
    await fs.promises.chmod(targetPath, 0o755);
    
    // Step 3: Create manifest
    progress.report({ message: 'Configuring manifest...' });
    const manifest = {
      name: "com.pkm_assistant.native",
      description: "PKM Assistant Native Host",
      path: targetPath,
      type: "stdio",
      allowed_origins: [
        "chrome-extension://PENDING/"  // Updated when extension installed
      ]
    };
    
    // Step 4: Write manifest to browser-specific location
    const manifestPath = await writeManifestForBrowser(manifest);
    
    // Step 5: Install Python dependencies
    progress.report({ message: 'Installing Python dependencies...' });
    await exec('pip3 install --user requests');
    
    // Step 6: Open browser extension page
    progress.report({ message: 'Opening browser extension page...' });
    const browserUrl = await getBrowserExtensionUrl();
    await vscode.env.openExternal(vscode.Uri.parse(browserUrl));
    
    vscode.window.showInformationMessage(
      'Setup complete! Please install the browser extension to finish.'
    );
  });
}
```

### Platform-Specific Paths

**macOS:**

- Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
- Firefox: `~/Library/Application Support/Mozilla/NativeMessagingHosts/`

**Linux:**

- Chrome: `~/.config/google-chrome/NativeMessagingHosts/`
- Firefox: `~/.mozilla/native-messaging-hosts/`

**Windows:**

- Registry keys (more complex, needs special handling)

### Benefits Over Current Approach

- ✅ **One-click setup** instead of manual script running
- ✅ **No terminal/command line** knowledge required
- ✅ **Integrated into VSCode** where users are comfortable
- ✅ **Automatic browser detection** and configuration
- ✅ **Clear progress feedback** throughout installation
- ✅ **Error handling** with helpful messages
- ✅ **Cross-platform** support handled automatically
