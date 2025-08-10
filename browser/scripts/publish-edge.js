#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root_dir = path.resolve(__dirname, '..');

/**
 * Edge Add-ons Publishing Script
 * 
 * This script handles publishing to Microsoft Edge Add-ons store.
 * 
 * Required environment variables:
 * - EDGE_CLIENT_ID: Azure AD application client ID
 * - EDGE_CLIENT_SECRET: Azure AD application client secret
 * - EDGE_PRODUCT_ID: Edge Add-ons product ID
 * - EDGE_ACCESS_TOKEN_URL: Azure AD access token URL
 */

class EdgeAddonsPublisher {
  constructor() {
    this.client_id = process.env.EDGE_CLIENT_ID;
    this.client_secret = process.env.EDGE_CLIENT_SECRET;
    this.product_id = process.env.EDGE_PRODUCT_ID;
    this.access_token_url = process.env.EDGE_ACCESS_TOKEN_URL || 
      'https://login.microsoftonline.com/5c9eedce-81bc-42f3-8823-48ba6258b391/oauth2/v2.0/token';
    
    if (!this.client_id || !this.client_secret || !this.product_id) {
      throw new Error('Missing required environment variables. Please set EDGE_CLIENT_ID, EDGE_CLIENT_SECRET, and EDGE_PRODUCT_ID');
    }
  }
  
  async get_access_token() {
    const params = new URLSearchParams({
      client_id: this.client_id,
      client_secret: this.client_secret,
      grant_type: 'client_credentials',
      scope: 'https://api.addons.microsoftedge.microsoft.com/.default'
    });
    
    return new Promise((resolve, reject) => {
      const url = new URL(this.access_token_url);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': params.toString().length
        }
      };
      
      const req = https.request(options, (res) => {
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
  
  async upload_package(zip_path, access_token) {
    const api_url = `https://api.addons.microsoftedge.microsoft.com/v1/products/${this.product_id}/submissions`;
    const zip_data = fs.readFileSync(zip_path);
    
    // Create multipart form data
    const boundary = '----FormBoundary' + Date.now();
    const form_parts = [];
    
    // Add file part
    form_parts.push(`--${boundary}`);
    form_parts.push('Content-Disposition: form-data; name="file"; filename="extension.zip"');
    form_parts.push('Content-Type: application/zip');
    form_parts.push('');
    form_parts.push(zip_data);
    form_parts.push(`--${boundary}--`);
    
    const body = Buffer.concat(
      form_parts.map(part => 
        Buffer.isBuffer(part) ? part : Buffer.from(part + '\r\n')
      )
    );
    
    return new Promise((resolve, reject) => {
      const url = new URL(api_url);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (res.statusCode === 202 || res.statusCode === 200) {
              resolve(response);
            } else {
              reject(new Error(`Upload failed (${res.statusCode}): ${data}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  
  async check_status(submission_id, access_token) {
    const api_url = `https://api.addons.microsoftedge.microsoft.com/v1/products/${this.product_id}/submissions/${submission_id}`;
    
    return new Promise((resolve, reject) => {
      const url = new URL(api_url);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${access_token}`
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            resolve(response);
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }
  
  async publish_submission(submission_id, access_token) {
    const api_url = `https://api.addons.microsoftedge.microsoft.com/v1/products/${this.product_id}/submissions/${submission_id}/publish`;
    
    return new Promise((resolve, reject) => {
      const url = new URL(api_url);
      const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Length': 0
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(data);
            if (res.statusCode === 202 || res.statusCode === 200) {
              resolve(response);
            } else {
              reject(new Error(`Publish failed (${res.statusCode}): ${data}`));
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
      
      console.log('📤 Uploading extension to Edge Add-ons...');
      const upload_result = await this.upload_package(zip_path, access_token);
      const submission_id = upload_result.id;
      console.log(`✅ Upload successful. Submission ID: ${submission_id}`);
      
      // Wait for processing
      console.log('⏳ Waiting for package validation...');
      let status;
      let attempts = 0;
      const max_attempts = 30; // 5 minutes max wait
      
      do {
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
        status = await this.check_status(submission_id, access_token);
        console.log(`   Status: ${status.status}`);
        attempts++;
      } while (
        status.status === 'InProgress' && 
        attempts < max_attempts
      );
      
      if (status.status === 'Failed') {
        throw new Error('Package validation failed: ' + JSON.stringify(status.statusDetails));
      }
      
      if (status.status === 'Succeeded' || status.status === 'ReadyToPublish') {
        console.log('🚀 Publishing extension...');
        const publish_result = await this.publish_submission(submission_id, access_token);
        console.log('✅ Extension published successfully:', publish_result);
      }
      
      console.log(`\n🎉 Extension published to Edge Add-ons!`);
      console.log(`🔗 View at: https://microsoftedge.microsoft.com/addons/detail/${this.product_id}`);
      
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
    // Use default production build (Edge uses Chrome package)
    const package_json = JSON.parse(fs.readFileSync(path.join(root_dir, 'package.json'), 'utf8'));
    const version = package_json.version;
    const zip_path = path.join(root_dir, 'builds', `v${version}`, 'edge-extension.zip');
    
    if (!fs.existsSync(zip_path)) {
      console.error(`❌ Extension package not found at: ${zip_path}`);
      console.error('Run "npm run build:production" first');
      process.exit(1);
    }
    
    const publisher = new EdgeAddonsPublisher();
    await publisher.publish(zip_path);
    
  } else {
    // Use provided zip file
    const zip_path = path.resolve(args[0]);
    
    if (!fs.existsSync(zip_path)) {
      console.error(`❌ File not found: ${zip_path}`);
      process.exit(1);
    }
    
    const publisher = new EdgeAddonsPublisher();
    await publisher.publish(zip_path);
  }
}

// Check for help flag
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Edge Add-ons Publisher

Usage:
  node scripts/publish-edge.js [zip-file]

Options:
  [zip-file]    Path to the extension ZIP file (optional, uses latest build by default)
  --help, -h    Show this help message

Environment Variables:
  EDGE_CLIENT_ID         Azure AD application client ID
  EDGE_CLIENT_SECRET     Azure AD application client secret
  EDGE_PRODUCT_ID        Edge Add-ons product ID
  EDGE_ACCESS_TOKEN_URL  Azure AD token URL (optional)

Example:
  npm run publish:edge
  
Note: Edge Add-ons uses the same package format as Chrome extensions.
  `);
  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});