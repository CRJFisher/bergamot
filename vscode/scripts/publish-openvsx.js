#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * Open VSX Registry Publishing Script
 * 
 * Publishes the VS Code extension to the Open VSX Registry.
 * 
 * Required environment variable:
 * - OVSX_PAT: Personal Access Token from open-vsx.org
 */

class OpenVSXPublisher {
  constructor() {
    this.pat = process.env.OVSX_PAT || process.env.OVSX_TOKEN;
    this.registry_url = process.env.OVSX_REGISTRY_URL || 'https://open-vsx.org';
    this.package_json = JSON.parse(
      fs.readFileSync(path.join(root_dir, 'package.json'), 'utf8')
    );
    this.publisher = this.package_json.publisher;
    this.name = this.package_json.name;
    this.version = this.package_json.version;
    
    if (!this.pat) {
      throw new Error(
        'Missing Personal Access Token. Please set OVSX_PAT environment variable.\n' +
        'Get your token from: https://open-vsx.org/user-settings/tokens'
      );
    }
    
    if (!this.publisher) {
      throw new Error(
        'Missing publisher in package.json. Please add a "publisher" field.'
      );
    }
  }
  
  ensure_ovsx() {
    try {
      execSync('npx ovsx --version', { stdio: 'ignore' });
      console.log('✅ ovsx CLI is available');
    } catch {
      console.log('📦 Installing ovsx...');
      execSync('npm install -D ovsx', { 
        cwd: root_dir, 
        stdio: 'inherit' 
      });
    }
  }
  
  verify_namespace() {
    console.log('🔍 Verifying namespace...');
    
    try {
      // Try to get extension info
      const result = execSync(
        `npx ovsx get ${this.publisher}.${this.name} --registryUrl "${this.registry_url}"`,
        { 
          cwd: root_dir,
          encoding: 'utf8',
          stdio: 'pipe'
        }
      );
      
      // Parse the version from the output
      const version_match = result.match(/version: ([\d.]+)/);
      if (version_match) {
        const current_version = version_match[1];
        console.log(`✅ Extension found: v${current_version}`);
        
        // Check if we're trying to publish an older version
        if (this.compare_versions(this.version, current_version) <= 0) {
          throw new Error(
            `Version ${this.version} is not greater than published version ${current_version}`
          );
        }
      }
      
    } catch (error) {
      if (error.message.includes('Extension not found') || 
          error.message.includes('404')) {
        console.log('ℹ️  Extension not yet published, this will be the first version');
      } else if (error.message.includes('Version')) {
        throw error;
      } else {
        // Namespace might not exist, we'll create it
        console.log('ℹ️  Namespace might not exist, will create if needed');
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
  
  create_namespace() {
    console.log(`📝 Creating namespace '${this.publisher}'...`);
    
    try {
      const command = `npx ovsx create-namespace "${this.publisher}" --pat "${this.pat}" --registryUrl "${this.registry_url}"`;
      
      execSync(command, {
        cwd: root_dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          OVSX_PAT: this.pat
        }
      });
      
      console.log('✅ Namespace created successfully');
      
    } catch (error) {
      if (error.message.includes('already exists') || 
          error.message.includes('already taken')) {
        console.log('✅ Namespace already exists');
      } else {
        console.warn('⚠️  Could not create namespace, it might already exist');
      }
    }
  }
  
  pre_publish_checks() {
    console.log('🔍 Running pre-publish checks...');
    
    // Check README exists
    const readme_path = path.join(root_dir, 'README.md');
    if (!fs.existsSync(readme_path)) {
      throw new Error('README.md is required for publishing');
    }
    
    // Check LICENSE exists (recommended for Open VSX)
    const license_path = path.join(root_dir, 'LICENSE');
    if (!fs.existsSync(license_path)) {
      console.warn('⚠️  No LICENSE file found, strongly recommended for Open VSX');
    }
    
    // Check license field in package.json
    if (!this.package_json.license) {
      console.warn('⚠️  No license field in package.json, required for Open VSX');
    }
    
    // Check repository field (required for Open VSX)
    if (!this.package_json.repository) {
      throw new Error('Repository field is required in package.json for Open VSX');
    }
    
    console.log('✅ Pre-publish checks passed');
  }
  
  async publish_from_vsix(vsix_path) {
    console.log(`📤 Publishing ${path.basename(vsix_path)} to Open VSX Registry...`);
    
    try {
      const command = `npx ovsx publish "${vsix_path}" --pat "${this.pat}" --registryUrl "${this.registry_url}"`;
      
      execSync(command, {
        cwd: root_dir,
        stdio: 'inherit',
        env: {
          ...process.env,
          OVSX_PAT: this.pat,
          OVSX_REGISTRY_URL: this.registry_url
        }
      });
      
      console.log('✅ Successfully published to Open VSX Registry!');
      console.log(`🔗 View at: ${this.registry_url}/extension/${this.publisher}/${this.name}`);
      
    } catch (error) {
      if (error.message.includes('already published')) {
        console.log('⚠️  This version already exists in Open VSX');
      } else {
        throw error;
      }
    }
  }
  
  async publish() {
    console.log(`🚀 Publishing ${this.name} v${this.version} to Open VSX Registry\n`);
    
    try {
      // Ensure ovsx is available
      this.ensure_ovsx();
      
      // Create namespace if needed
      this.create_namespace();
      
      // Verify namespace and extension
      this.verify_namespace();
      
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
        
        // First ensure we have a package
        console.log('📦 Packaging extension...');
        execSync('npx vsce package', {
          cwd: root_dir,
          stdio: 'inherit'
        });
        
        // Find the generated VSIX
        const generated_vsix = path.join(root_dir, vsix_name);
        
        if (!fs.existsSync(generated_vsix)) {
          throw new Error('Failed to generate VSIX package');
        }
        
        // Publish it
        const command = `npx ovsx publish "${generated_vsix}" --pat "${this.pat}" --registryUrl "${this.registry_url}"`;
        
        execSync(command, {
          cwd: root_dir,
          stdio: 'inherit',
          env: {
            ...process.env,
            OVSX_PAT: this.pat,
            OVSX_REGISTRY_URL: this.registry_url
          }
        });
        
        console.log('✅ Successfully published to Open VSX Registry!');
        console.log(`🔗 View at: ${this.registry_url}/extension/${this.publisher}/${this.name}`);
        
        // Clean up
        fs.unlinkSync(generated_vsix);
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
    
    const publisher = new OpenVSXPublisher();
    await publisher.publish_from_vsix(vsix_path);
    
  } else {
    // Publish current version
    const publisher = new OpenVSXPublisher();
    await publisher.publish();
  }
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Open VSX Registry Publisher

Usage:
  node scripts/publish-openvsx.js [vsix-file]

Options:
  [vsix-file]         Path to specific VSIX file (optional)
  --help, -h          Show this help message

Environment Variables:
  OVSX_PAT            Personal Access Token from open-vsx.org (required)
  OVSX_REGISTRY_URL   Registry URL (optional, defaults to https://open-vsx.org)

Setup:
  1. Create account at: https://open-vsx.org
  2. Sign publisher agreement
  3. Generate token at: https://open-vsx.org/user-settings/tokens
  4. Set OVSX_PAT environment variable

Examples:
  npm run publish:openvsx
  OVSX_PAT=your-token npm run publish:openvsx
  node scripts/publish-openvsx.js builds/v1.0.0/extension.vsix
  
Note: Open VSX requires:
  - Valid license field in package.json
  - Repository field in package.json
  - README.md file
  - Preferably a LICENSE file
  `);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});