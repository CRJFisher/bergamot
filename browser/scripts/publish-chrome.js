#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * Chrome Web Store Publishing Script
 * 
 * This script handles publishing to Chrome Web Store using the API.
 * 
 * Required environment variables:
 * - CHROME_CLIENT_ID: OAuth2 client ID
 * - CHROME_CLIENT_SECRET: OAuth2 client secret
 * - CHROME_REFRESH_TOKEN: OAuth2 refresh token
 * - CHROME_EXTENSION_ID: Chrome Web Store extension ID
 */

class ChromeWebStorePublisher {
  constructor() {
    this.client_id = process.env.CHROME_CLIENT_ID;
    this.client_secret = process.env.CHROME_CLIENT_SECRET;
    this.refresh_token = process.env.CHROME_REFRESH_TOKEN;
    this.extension_id = process.env.CHROME_EXTENSION_ID;
    
    if (!this.client_id || !this.client_secret || !this.refresh_token || !this.extension_id) {
      throw new Error('Missing required environment variables. Please set CHROME_CLIENT_ID, CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN, and CHROME_EXTENSION_ID');
    }
  }
  
  async get_access_token() {
    const token_url = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
      client_id: this.client_id,
      client_secret: this.client_secret,
      refresh_token: this.refresh_token,
      grant_type: 'refresh_token'
    });
    
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': params.toString().length
        }
      };
      
      const req = https.request(token_url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.access_token) {
              resolve(response.access_token);
            } else {
              reject(new Error('Failed to get access token: ' + data));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.write(params.toString());
      req.end();
    });
  }
  
  async upload_extension(zip_path, access_token) {
    const upload_url = `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${this.extension_id}`;
    const zip_data = fs.readFileSync(zip_path);
    
    return new Promise((resolve, reject) => {
      const options = {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'x-goog-api-version': '2',
          'Content-Type': 'application/zip',
          'Content-Length': zip_data.length
        }
      };
      
      const req = https.request(upload_url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.uploadState === 'SUCCESS') {
              resolve(response);
            } else {
              reject(new Error('Upload failed: ' + data));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.write(zip_data);
      req.end();
    });
  }
  
  async publish_extension(access_token) {
    const publish_url = `https://www.googleapis.com/chromewebstore/v1.1/items/${this.extension_id}/publish`;
    
    return new Promise((resolve, reject) => {
      const options = {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'x-goog-api-version': '2',
          'Content-Length': 0
        }
      };
      
      const req = https.request(publish_url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (response.status && response.status.includes('OK')) {
              resolve(response);
            } else {
              reject(new Error('Publish failed: ' + data));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }
  
  async publish(zip_path) {
    try {
      console.log('🔐 Getting access token...');
      const access_token = await this.get_access_token();
      
      console.log('📤 Uploading extension to Chrome Web Store...');
      const upload_result = await this.upload_extension(zip_path, access_token);
      console.log('✅ Upload successful:', upload_result);
      
      console.log('🚀 Publishing extension...');
      const publish_result = await this.publish_extension(access_token);
      console.log('✅ Extension published successfully:', publish_result);
      
      console.log(`\n🎉 Extension published to Chrome Web Store!`);
      console.log(`🔗 View at: https://chrome.google.com/webstore/detail/${this.extension_id}`);
      
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
    const zip_path = path.join(root_dir, 'builds', `v${version}`, 'chrome-extension.zip');
    
    if (!fs.existsSync(zip_path)) {
      console.error(`❌ Extension package not found at: ${zip_path}`);
      console.error('Run "npm run build:production" first');
      process.exit(1);
    }
    
    const publisher = new ChromeWebStorePublisher();
    await publisher.publish(zip_path);
    
  } else {
    // Use provided zip file
    const zip_path = path.resolve(args[0]);
    
    if (!fs.existsSync(zip_path)) {
      console.error(`❌ File not found: ${zip_path}`);
      process.exit(1);
    }
    
    const publisher = new ChromeWebStorePublisher();
    await publisher.publish(zip_path);
  }
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Chrome Web Store Publisher

Usage:
  node scripts/publish-chrome.js [zip-file]

Options:
  [zip-file]    Path to the extension ZIP file (optional, uses latest build by default)
  --help, -h    Show this help message

Environment Variables:
  CHROME_CLIENT_ID       OAuth2 client ID
  CHROME_CLIENT_SECRET   OAuth2 client secret  
  CHROME_REFRESH_TOKEN   OAuth2 refresh token
  CHROME_EXTENSION_ID    Chrome Web Store extension ID

Example:
  npm run publish:chrome
  `);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});