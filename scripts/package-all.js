#!/usr/bin/env node

/**
 * PKM Assistant - Package All Extensions Script (Node.js)
 * Cross-platform script to package all extensions for release
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

// Helper functions for colored output
const printStatus = (msg) => console.log(`${colors.green}[✓]${colors.reset} ${msg}`);
const printError = (msg) => console.log(`${colors.red}[✗]${colors.reset} ${msg}`);
const printInfo = (msg) => console.log(`${colors.yellow}[→]${colors.reset} ${msg}`);

// Get root directory
const ROOT_DIR = path.resolve(__dirname, '..');

// Main packaging function
async function packageAll() {
  console.log('================================================');
  console.log('PKM Assistant - Extension Packaging Script');
  console.log('================================================');

  try {
    // Clean up old packages
    printInfo('Cleaning up old packages...');
    const vscodePath = path.join(ROOT_DIR, 'vscode');
    const browserPath = path.join(ROOT_DIR, 'browser');
    
    // Remove old VSIX files
    const vsixFiles = fs.readdirSync(vscodePath).filter(f => f.endsWith('.vsix'));
    vsixFiles.forEach(f => fs.unlinkSync(path.join(vscodePath, f)));
    
    // Remove old ZIP files
    ['chrome-extension.zip', 'firefox-extension.zip'].forEach(f => {
      const zipPath = path.join(browserPath, f);
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    });
    printStatus('Old packages cleaned');

    // Package VS Code Extension
    console.log('\n📦 Packaging VS Code Extension...');
    console.log('--------------------------------');
    process.chdir(vscodePath);
    
    printInfo('Compiling TypeScript...');
    execSync('npm run compile', { stdio: 'inherit' });
    printStatus('TypeScript compiled');
    
    printInfo('Running vsce package...');
    execSync('npm run package', { stdio: 'inherit' });
    printStatus('VS Code extension packaged');
    
    // Find the created VSIX file
    const newVsixFiles = fs.readdirSync(vscodePath).filter(f => f.endsWith('.vsix'));
    const vsixFile = newVsixFiles[0];
    if (vsixFile) {
      printStatus(`Created: vscode/${vsixFile}`);
    }

    // Package Browser Extensions
    console.log('\n📦 Packaging Browser Extensions...');
    console.log('----------------------------------');
    process.chdir(browserPath);
    
    printInfo('Building browser extension...');
    execSync('npm run build', { stdio: 'inherit' });
    printStatus('Browser extension built');
    
    // Package Chrome Extension
    printInfo('Packaging Chrome extension...');
    const chromePath = path.join(browserPath, 'chrome');
    const chromeZipPath = path.join(browserPath, 'chrome-extension.zip');
    
    // Create zip using Node.js (cross-platform)
    const archiver = require('archiver');
    const output = fs.createWriteStream(chromeZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    await new Promise((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(chromePath, false);
      archive.finalize();
    });
    printStatus('Chrome extension packaged: browser/chrome-extension.zip');
    
    // Package Firefox Extension
    printInfo('Packaging Firefox extension...');
    const firefoxPath = path.join(browserPath, 'firefox');
    const firefoxZipPath = path.join(browserPath, 'firefox-extension.zip');
    
    const firefoxOutput = fs.createWriteStream(firefoxZipPath);
    const firefoxArchive = archiver('zip', { zlib: { level: 9 } });
    
    await new Promise((resolve, reject) => {
      firefoxOutput.on('close', resolve);
      firefoxArchive.on('error', reject);
      firefoxArchive.pipe(firefoxOutput);
      firefoxArchive.directory(firefoxPath, false);
      firefoxArchive.finalize();
    });
    printStatus('Firefox extension packaged: browser/firefox-extension.zip');

    // Summary
    console.log('\n================================================');
    console.log('📋 Package Summary');
    console.log('================================================\n');
    
    if (vsixFile) {
      const vsixPath = path.join(vscodePath, vsixFile);
      const vsixSize = (fs.statSync(vsixPath).size / 1024).toFixed(1);
      console.log('✅ VS Code Extension:');
      console.log(`   → ${vsixPath}`);
      console.log(`   → Size: ${vsixSize} KB\n`);
    }
    
    const chromeSize = (fs.statSync(chromeZipPath).size / 1024).toFixed(1);
    console.log('✅ Chrome Extension:');
    console.log(`   → ${chromeZipPath}`);
    console.log(`   → Size: ${chromeSize} KB\n`);
    
    const firefoxSize = (fs.statSync(firefoxZipPath).size / 1024).toFixed(1);
    console.log('✅ Firefox Extension:');
    console.log(`   → ${firefoxZipPath}`);
    console.log(`   → Size: ${firefoxSize} KB\n`);
    
    console.log('================================================');
    console.log('🚀 All extensions packaged successfully!');
    console.log('================================================\n');
    console.log('Next steps:');
    console.log('  1. Test the packaged extensions');
    console.log('  2. VS Code: Upload to VS Code Marketplace');
    console.log('  3. Chrome: Upload to Chrome Web Store');
    console.log('  4. Firefox: Upload to Firefox Add-ons');
    
  } catch (error) {
    printError(`Packaging failed: ${error.message}`);
    process.exit(1);
  }
}

// Check if archiver is available
try {
  require.resolve('archiver');
  packageAll();
} catch (e) {
  console.log('Note: For cross-platform zip creation, install archiver:');
  console.log('  npm install -g archiver');
  console.log('\nFalling back to command-line zip...\n');
  
  // Fallback to command-line approach
  const { spawnSync } = require('child_process');
  
  // Simple fallback without archiver
  async function simplePackage() {
    try {
      process.chdir(path.join(ROOT_DIR, 'vscode'));
      execSync('npm run compile && npm run package', { stdio: 'inherit' });
      
      process.chdir(path.join(ROOT_DIR, 'browser'));
      execSync('npm run build', { stdio: 'inherit' });
      
      // Use platform-specific zip command
      if (process.platform === 'win32') {
        // Windows PowerShell compress
        execSync('powershell Compress-Archive -Path chrome/* -DestinationPath chrome-extension.zip -Force');
        execSync('powershell Compress-Archive -Path firefox/* -DestinationPath firefox-extension.zip -Force');
      } else {
        // Unix-like zip command
        execSync('cd chrome && zip -r ../chrome-extension.zip . -x "*.DS_Store"');
        execSync('cd firefox && zip -r ../firefox-extension.zip . -x "*.DS_Store"');
      }
      
      console.log('\n✅ All extensions packaged successfully!');
    } catch (error) {
      console.error('Packaging failed:', error.message);
      process.exit(1);
    }
  }
  
  simplePackage();
}