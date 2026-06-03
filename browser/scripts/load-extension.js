#!/usr/bin/env node

/**
 * Chrome Extension Loader (Node.js) - Cross-platform Chrome extension debugging script
 * 
 * PURPOSE:
 * - Cross-platform support for Windows, Mac, and Linux
 * - Can be used as a Node.js module (exports findChrome and launchChrome functions)
 * - Integrates with npm scripts (used by `npm run chrome` command)
 * - Supports persistent Chrome profiles with --keep-profile flag
 * 
 * FEATURES:
 * - Automatic Chrome detection across different OS and installation paths
 * - Automatic extension building if not already built
 * - Temporary or persistent Chrome profile support
 * - VS Code extension detection
 * - Cleanup on exit
 * 
 * USAGE:
 *   node scripts/load-extension.js                    # Opens chrome://extensions
 *   node scripts/load-extension.js https://google.com # Opens with specific URL
 *   node scripts/load-extension.js --keep-profile     # Keeps profile for next run
 *   
 * PROGRAMMATIC USAGE:
 *   import { findChrome, launchChrome } from './scripts/load-extension.js';
 */

import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration - adjusted for new location in scripts/
const EXTENSION_PATH = path.join(__dirname, '..', 'chrome');
const TEMP_PROFILE = path.join(os.tmpdir(), 'pkm-chrome-debug-profile');

// Chrome executable paths for different platforms
const CHROME_PATHS = {
  darwin: [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ]
};

// Find a Chromium-family browser executable.
// BROWSER_BIN takes priority so callers (e.g. `dev:brave`) can pin a specific
// binary; otherwise the first existing path for the platform wins.
function findChrome() {
  if (process.env.BROWSER_BIN) {
    if (!fs.existsSync(process.env.BROWSER_BIN)) {
      throw new Error(`BROWSER_BIN does not exist: ${process.env.BROWSER_BIN}`);
    }
    return process.env.BROWSER_BIN;
  }

  const platform = os.platform();
  const paths = CHROME_PATHS[platform] || [];

  for (const chromePath of paths) {
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }
  
  // Try to find in PATH
  const which = execSync('which google-chrome || which chromium || echo ""', { encoding: 'utf-8' }).trim();
  if (which) return which;
  
  throw new Error('Chrome not found. Please install Google Chrome.');
}

// Check if extension is built
function checkExtensionBuilt() {
  const backgroundScript = path.join(EXTENSION_PATH, 'dist', 'background.bundle.js');
  if (!fs.existsSync(backgroundScript)) {
    console.log('❌ Extension not built. Building now...');
    execSync('npm run build', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });
  }
}

// Resolve the user-data-dir for this run.
// Brave gets its own persistent profile so it never shares (and corrupts) a
// Chrome profile; persistent profiles also survive across dev iterations.
function resolveProfileDir(chromeBin, keepProfile) {
  const isBrave = /Brave/i.test(chromeBin);
  let profileDir;
  if (isBrave) {
    profileDir = path.join(os.homedir(), '.bergamot-brave-debug-profile');
  } else if (keepProfile) {
    profileDir = path.join(os.homedir(), '.pkm-chrome-debug-profile');
  } else {
    profileDir = TEMP_PROFILE;
  }

  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  return { profileDir, persistent: isBrave || keepProfile };
}

// Launch Chrome with extension
function launchChrome() {
  const chrome = findChrome();
  const keepProfile = process.argv.includes('--keep-profile');
  const { profileDir, persistent } = resolveProfileDir(chrome, keepProfile);
  
  console.log('🚀 Loading PKM Navigation Tracker Extension...');
  console.log('📁 Extension path:', EXTENSION_PATH);
  console.log('🔧 Chrome profile:', profileDir);
  console.log('✅ Chrome found at:', chrome);
  console.log('');
  
  // Check if VS Code extension is running
  http.get('http://localhost:5000', () => {
    console.log('✅ VS Code extension detected on port 5000');
  }).on('error', () => {
    console.log('⚠️  VS Code extension not detected on port 5000');
    console.log('   Make sure to run the VS Code extension from your IDE');
  });
  
  console.log('');
  console.log('📝 Instructions:');
  console.log('  1. Chrome will open with the extension pre-loaded');
  console.log('  2. Go to chrome://extensions to see the extension');
  console.log('  3. Click "service worker" link to debug background script');
  console.log('  4. Press F12 on any webpage to debug content script');
  console.log('');
  if (persistent) {
    console.log('📌 Using persistent profile at:', profileDir);
  }
  console.log('🛑 Press Ctrl+C to stop and cleanup');
  console.log('');
  
  const args = [
    `--user-data-dir=${profileDir}`,
    `--load-extension=${EXTENSION_PATH}`,
    '--auto-open-devtools-for-tabs',
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check'
  ];
  
  // Add headless mode if requested
  if (process.argv.includes('--headless')) {
    args.push('--headless=new');
  }
  
  // Add starting page
  const urlArg = process.argv.find(arg => 
    !arg.startsWith('--') && arg !== process.argv[1] && arg.startsWith('http')
  );
  args.push(urlArg || 'chrome://extensions');
  
  const chromeProcess = spawn(chrome, args, {
    stdio: 'inherit',
    detached: false
  });
  
  // Cleanup on exit
  process.on('SIGINT', () => {
    console.log('\n🧹 Cleaning up...');
    chromeProcess.kill();
    if (!persistent && fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
    process.exit(0);
  });

  chromeProcess.on('close', (code) => {
    console.log(`Chrome exited with code ${code}`);
    if (!persistent && fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  });
}

// Additional utilities
function showHelp() {
  console.log(`
PKM Navigation Tracker - Chrome Extension Loader

Usage:
  node scripts/load-extension.js [options] [url]

Options:
  --help, -h     Show this help message
  --keep-profile Keep the Chrome profile after exit
  --headless     Run Chrome in headless mode (for testing)

Examples:
  node scripts/load-extension.js                    # Opens chrome://extensions
  node scripts/load-extension.js https://google.com # Opens with specific URL
  node scripts/load-extension.js --keep-profile     # Keeps profile for next run
`);
}

// Main execution
function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    showHelp();
    return;
  }
  
  try {
    checkExtensionBuilt();
    launchChrome();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (process.argv[1] === __filename) {
  main();
}

export { findChrome, launchChrome };