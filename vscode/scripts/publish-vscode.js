#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * VS Code Marketplace Publishing Script
 * 
 * Publishes the VS Code extension to the official Visual Studio Marketplace.
 * 
 * Required environment variable:
 * - VSCE_PAT: Personal Access Token from Azure DevOps
 */

class VSCodeMarketplacePublisher {
  constructor() {
    this.pat = process.env.VSCE_PAT || process.env.VSCE_TOKEN;
    this.package_json = JSON.parse(
      fs.readFileSync(path.join(root_dir, 'package.json'), 'utf8')
    );
    this.publisher = this.package_json.publisher;
    this.name = this.package_json.name;
    this.version = this.package_json.version;
    
    if (!this.pat) {
      throw new Error(
        'Missing Personal Access Token. Please set VSCE_PAT environment variable.\n' +
        'Get your token from: https://dev.azure.com/[your-org]/_usersSettings/tokens'
      );
    }
    
    if (!this.publisher) {
      throw new Error(
        'Missing publisher in package.json. Please add a "publisher" field.'
      );
    }
  }
  
  ensure_vsce() {
    try {
      execSync('npx vsce --version', { stdio: 'ignore' });
      console.log('✅ vsce is available');
    } catch {
      console.log('📦 Installing vsce...');
      execSync('npm install -D @vscode/vsce', { 
        cwd: root_dir, 
        stdio: 'inherit' 
      });
    }
  }
  
  verify_publisher() {
    console.log('🔍 Verifying publisher...');
    
    try {
      const result = execSync(
        `npx vsce show ${this.publisher}.${this.name} --json`,
        { 
          cwd: root_dir,
          encoding: 'utf8',
          stdio: 'pipe'
        }
      );
      
      const extension_info = JSON.parse(result);
      console.log(`✅ Extension found: ${extension_info.displayName} v${extension_info.version}`);
      
      // Check if we're trying to publish an older version
      const current_version = extension_info.version;
      if (this.compare_versions(this.version, current_version) <= 0) {
        throw new Error(
          `Version ${this.version} is not greater than published version ${current_version}`
        );
      }
      
    } catch (error) {
      if (error.message.includes('Extension not found')) {
        console.log('ℹ️  Extension not yet published, this will be the first version');
      } else if (error.message.includes('Version')) {
        throw error;
      } else {
        console.log('ℹ️  Could not verify extension, proceeding...');
      }
    }
  }
  
  compare_versions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if (parts1[i] > parts2[i]) return 1;
      if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
  }
  
  pre_publish_checks() {
    console.log('🔍 Running pre-publish checks...');
    
    // Check README exists
    const readme_path = path.join(root_dir, 'README.md');
    if (!fs.existsSync(readme_path)) {
      throw new Error('README.md is required for publishing');
    }
    
    // Check LICENSE exists
    const license_path = path.join(root_dir, 'LICENSE');
    if (!fs.existsSync(license_path)) {
      console.warn('⚠️  No LICENSE file found, recommended for open source');
    }
    
    // Check for icon
    if (!this.package_json.icon) {
      console.warn('⚠️  No icon specified in package.json');
    }
    
    // Check repository field
    if (!this.package_json.repository) {
      console.warn('⚠️  No repository field in package.json');
    }
    
    console.log('✅ Pre-publish checks passed');
  }
  
  async publish_from_vsix(vsix_path) {
    console.log(`📤 Publishing ${path.basename(vsix_path)} to VS Code Marketplace...`);
    
    try {
      const command = `npx vsce publish --packagePath "${vsix_path}" --pat "${this.pat}"`;
      
      execSync(command, {
        cwd: root_dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          VSCE_PAT: this.pat
        }
      });
      
      console.log('✅ Successfully published to VS Code Marketplace!');
      console.log(`🔗 View at: https://marketplace.visualstudio.com/items?itemName=${this.publisher}.${this.name}`);
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('⚠️  This version already exists in the marketplace');
      } else {
        throw error;
      }
    }
  }
  
  async publish() {
    console.log(`🚀 Publishing ${this.name} v${this.version} to VS Code Marketplace\n`);
    
    try {
      // Ensure vsce is available
      this.ensure_vsce();
      
      // Verify publisher and extension
      this.verify_publisher();
      
      // Run pre-publish checks
      this.pre_publish_checks();
      
      // Check if VSIX already exists
      const vsix_name = `${this.name}-${this.version}.vsix`;
      const vsix_path = path.join(root_dir, 'builds', `v${this.version}`, vsix_name);
      
      if (fs.existsSync(vsix_path)) {
        // Publish existing VSIX
        await this.publish_from_vsix(vsix_path);
      } else {
        // Build and publish
        console.log('📦 Building and publishing...');
        
        const command = `npx vsce publish --pat "${this.pat}"`;
        
        execSync(command, {
          cwd: root_dir,
          stdio: 'inherit',
          env: {
            ...process.env,
            VSCE_PAT: this.pat
          }
        });
        
        console.log('✅ Successfully published to VS Code Marketplace!');
        console.log(`🔗 View at: https://marketplace.visualstudio.com/items?itemName=${this.publisher}.${this.name}`);
      }
      
    } catch (error) {
      console.error('❌ Publishing failed:', error.message);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0 && args[0].endsWith('.vsix')) {
    // Publish specific VSIX file
    const vsix_path = path.resolve(args[0]);
    
    if (!fs.existsSync(vsix_path)) {
      console.error(`❌ File not found: ${vsix_path}`);
      process.exit(1);
    }
    
    const publisher = new VSCodeMarketplacePublisher();
    await publisher.publish_from_vsix(vsix_path);
    
  } else {
    // Publish current version
    const publisher = new VSCodeMarketplacePublisher();
    await publisher.publish();
  }
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
VS Code Marketplace Publisher

Usage:
  node scripts/publish-vscode.js [vsix-file]

Options:
  [vsix-file]   Path to specific VSIX file (optional)
  --help, -h    Show this help message

Environment Variables:
  VSCE_PAT      Personal Access Token from Azure DevOps (required)

Setup:
  1. Create a publisher at: https://marketplace.visualstudio.com/manage
  2. Generate PAT at: https://dev.azure.com/[your-org]/_usersSettings/tokens
     - Scopes needed: Marketplace > Manage
  3. Set VSCE_PAT environment variable

Examples:
  npm run publish:vscode
  VSCE_PAT=your-token npm run publish:vscode
  node scripts/publish-vscode.js builds/v1.0.0/extension.vsix
  `);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});