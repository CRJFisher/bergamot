#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * Firefox Add-ons Publishing Script
 * 
 * This script handles publishing to Firefox Add-ons using web-ext.
 * 
 * Required environment variables:
 * - FIREFOX_API_KEY: Add-ons API key (JWT issuer)
 * - FIREFOX_API_SECRET: Add-ons API secret (JWT secret)
 */

class FirefoxAddonsPublisher {
  constructor() {
    this.api_key = process.env.FIREFOX_API_KEY;
    this.api_secret = process.env.FIREFOX_API_SECRET;
    
    if (!this.api_key || !this.api_secret) {
      throw new Error('Missing required environment variables. Please set FIREFOX_API_KEY and FIREFOX_API_SECRET');
    }
  }
  
  ensure_web_ext() {
    try {
      execSync('web-ext --version', { stdio: 'ignore' });
      console.log('✅ web-ext is installed');
    } catch {
      console.log('📦 Installing web-ext...');
      execSync('npm install -g web-ext', { stdio: 'inherit' });
    }
  }
  
  prepare_source_dir(zip_path) {
    // Extract the zip to a temporary directory for web-ext
    const temp_dir = path.join(root_dir, '.firefox-publish-temp');
    
    // Clean up any existing temp directory
    if (fs.existsSync(temp_dir)) {
      fs.rmSync(temp_dir, { recursive: true });
    }
    fs.mkdirSync(temp_dir);
    
    // Extract the zip
    console.log('📦 Extracting extension package...');
    execSync(`unzip -q "${zip_path}" -d "${temp_dir}"`, { stdio: 'inherit' });
    
    return temp_dir;
  }
  
  async publish(zip_path) {
    try {
      // Ensure web-ext is installed
      this.ensure_web_ext();
      
      // Prepare source directory
      const source_dir = this.prepare_source_dir(zip_path);
      
      console.log('🚀 Publishing to Firefox Add-ons...');
      
      // Build and sign with web-ext
      const command = [
        'web-ext sign',
        `--source-dir="${source_dir}"`,
        `--api-key="${this.api_key}"`,
        `--api-secret="${this.api_secret}"`,
        '--channel=listed',
        '--no-input',
        '--artifacts-dir=./builds/firefox-signed'
      ].join(' ');
      
      try {
        execSync(command, {
          cwd: root_dir,
          stdio: 'inherit',
          env: {
            ...process.env,
            WEB_EXT_API_KEY: this.api_key,
            WEB_EXT_API_SECRET: this.api_secret
          }
        });
        
        console.log('\n✅ Extension published successfully to Firefox Add-ons!');
        console.log('🔗 View at: https://addons.mozilla.org/developers/addon/pkm-navigation-tracker/');
        
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⚠️  This version already exists on Firefox Add-ons');
          console.log('ℹ️  Update the version number in package.json and rebuild');
        } else {
          throw error;
        }
      } finally {
        // Clean up temp directory
        if (fs.existsSync(source_dir)) {
          fs.rmSync(source_dir, { recursive: true });
        }
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
  
  if (args.length === 0) {
    // Use default production build
    const package_json = JSON.parse(fs.readFileSync(path.join(root_dir, 'package.json'), 'utf8'));
    const version = package_json.version;
    const zip_path = path.join(root_dir, 'builds', `v${version}`, 'firefox-extension.zip');
    
    if (!fs.existsSync(zip_path)) {
      console.error(`❌ Extension package not found at: ${zip_path}`);
      console.error('Run "npm run build:production" first');
      process.exit(1);
    }
    
    const publisher = new FirefoxAddonsPublisher();
    await publisher.publish(zip_path);
    
  } else {
    // Use provided zip file
    const zip_path = path.resolve(args[0]);
    
    if (!fs.existsSync(zip_path)) {
      console.error(`❌ File not found: ${zip_path}`);
      process.exit(1);
    }
    
    const publisher = new FirefoxAddonsPublisher();
    await publisher.publish(zip_path);
  }
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Firefox Add-ons Publisher

Usage:
  node scripts/publish-firefox.js [zip-file]

Options:
  [zip-file]    Path to the extension ZIP file (optional, uses latest build by default)
  --help, -h    Show this help message

Environment Variables:
  FIREFOX_API_KEY      Add-ons API key (JWT issuer)
  FIREFOX_API_SECRET   Add-ons API secret (JWT secret)

Example:
  npm run publish:firefox
  
Note: This script uses web-ext for publishing. If not installed, it will be installed automatically.
  `);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});