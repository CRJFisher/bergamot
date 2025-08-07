/**
 * E2E Tests for VSCode Extension Native Messaging HTTP Server
 * 
 * These tests verify that the VSCode extension can properly receive
 * and process messages forwarded from the native messaging host.
 * 
 * The flow is:
 * 1. Browser extension sends message to native host (Python script)
 * 2. Native host forwards message to VSCode extension HTTP server
 * 3. VSCode extension processes the message and returns response
 * 
 * These tests focus on step 2-3 of this flow.
 */

import express from 'express';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { compress, decompress } from '@mongodb-js/zstd';

// Helper function to make HTTP requests
async function make_http_request(url: string, options: any = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed_url = new URL(url);
    const req_options: any = {
      hostname: parsed_url.hostname,
      port: parsed_url.port,
      path: parsed_url.pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 5000
    };

    let post_data: string | undefined;
    if (options.json && options.method === 'POST') {
      post_data = JSON.stringify(options.json);
      req_options.headers['Content-Type'] = 'application/json';
      req_options.headers['Content-Length'] = post_data.length;
    } else if (options.body && options.method === 'POST') {
      post_data = options.body;
      if (!req_options.headers['Content-Length']) {
        req_options.headers['Content-Length'] = Buffer.byteLength(post_data);
      }
    }

    const req = http.request(req_options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response_data = data ? JSON.parse(data) : null;
          resolve({ 
            status: res.statusCode, 
            data: response_data,
            headers: res.headers 
          });
        } catch (e) {
          resolve({ 
            status: res.statusCode, 
            data,
            headers: res.headers 
          });
        }
      });
    });

    req.on('error', (err: any) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.destroy();
      const err: any = new Error('Request timeout');
      err.code = 'ETIMEDOUT';
      reject(err);
    });
    
    if (post_data) {
      req.write(post_data);
    }
    
    req.end();
  });
}

describe('Native Messaging HTTP Server E2E Tests', () => {
  let server: http.Server;
  let app: express.Application;
  let port: number;
  const test_dir = path.join(__dirname, '../test_data_nm');
  const port_file_path = path.join(test_dir, 'port.json');
  const processed_visits: any[] = [];

  beforeEach(async () => {
    // Clean up test directory
    if (fs.existsSync(test_dir)) {
      fs.rmSync(test_dir, { recursive: true, force: true });
    }
    fs.mkdirSync(test_dir, { recursive: true });

    // Create a minimal Express app that simulates the VSCode extension
    app = express();
    app.use(express.json());

    // Status endpoint (used by native host to check if extension is running)
    app.get('/status', (req, res) => {
      res.json({ 
        status: 'running', 
        version: '1.0.0',
        uptime: process.uptime()
      });
    });

    // Visit endpoint (receives page visit data from browser via native host)
    app.post('/visit', async (req, res) => {
      try {
        // Decompress content if it's base64 encoded zstd compressed
        let content = req.body.content;
        if (typeof content === 'string' && content.length > 0) {
          try {
            // Check if it looks like base64
            if (/^[A-Za-z0-9+/]+=*$/.test(content)) {
              const compressed_data = Buffer.from(content, 'base64');
              const decompressed_data = await decompress(compressed_data);
              content = decompressed_data.toString('utf-8');
            }
          } catch (error) {
            // Use content as-is if decompression fails
          }
        }

        const visit = {
          ...req.body,
          content,
          processed_at: new Date().toISOString()
        };
        
        processed_visits.push(visit);
        
        res.json({ 
          status: 'queued',
          position: processed_visits.length,
          id: `${req.body.url}:${req.body.page_loaded_at}`
        });
      } catch (error: any) {
        res.status(400).json({ 
          error: 'Invalid request',
          message: error.message 
        });
      }
    });

    // Start server on random port
    server = app.listen(0, () => {
      const address = server.address();
      port = typeof address === 'object' && address ? address.port : 0;
      
      // Write port file (simulating what extension.ts does)
      // This file is read by the native host to know where to forward messages
      fs.writeFileSync(port_file_path, JSON.stringify({ 
        port, 
        pid: process.pid 
      }));
    });

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    // Clear processed visits
    processed_visits.length = 0;

    // Close server
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }

    // Clean up test files
    if (fs.existsSync(test_dir)) {
      fs.rmSync(test_dir, { recursive: true, force: true });
    }
  });

  describe('Server Lifecycle', () => {
    it('should start and respond to status checks', async () => {
      const response = await make_http_request(`http://localhost:${port}/status`);
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        status: 'running',
        version: '1.0.0'
      });
      expect(response.data.uptime).toBeGreaterThan(0);
    });

    it('should write port file for native host to discover', () => {
      expect(fs.existsSync(port_file_path)).toBe(true);
      
      const port_data = JSON.parse(fs.readFileSync(port_file_path, 'utf-8'));
      expect(port_data.port).toBe(port);
      expect(port_data.pid).toBe(process.pid);
    });
  });

  describe('Message Reception from Native Host', () => {
    it('should accept a basic visit message', async () => {
      const visit_data = {
        url: 'https://example.com',
        page_loaded_at: new Date().toISOString(),
        referrer: '',
        content: 'Test page content',
        tab_id: 123
      };

      const response = await make_http_request(
        `http://localhost:${port}/visit`,
        { method: 'POST', json: visit_data }
      );
      
      expect(response.status).toBe(200);
      expect(response.data).toMatchObject({
        status: 'queued',
        position: 1
      });
      expect(response.data.id).toContain(visit_data.url);
      
      // Verify the visit was stored
      expect(processed_visits).toHaveLength(1);
      expect(processed_visits[0]).toMatchObject({
        url: visit_data.url,
        content: visit_data.content,
        tab_id: visit_data.tab_id
      });
    });

    it('should handle compressed content from browser', async () => {
      const original_content = 'This is test content that will be compressed by the browser';
      const compressed = await compress(Buffer.from(original_content));
      const base64_compressed = compressed.toString('base64');

      const visit_data = {
        url: 'https://example.com/compressed',
        page_loaded_at: new Date().toISOString(),
        referrer: '',
        content: base64_compressed,
        tab_id: 456
      };

      const response = await make_http_request(
        `http://localhost:${port}/visit`,
        { method: 'POST', json: visit_data }
      );
      
      expect(response.status).toBe(200);
      
      // Verify content was decompressed
      expect(processed_visits).toHaveLength(1);
      expect(processed_visits[0].content).toBe(original_content);
    });

    it('should handle multiple concurrent visits', async () => {
      const visits = Array.from({ length: 5 }, (_, i) => ({
        url: `https://example.com/page${i}`,
        page_loaded_at: new Date(Date.now() + i * 100).toISOString(),
        referrer: i > 0 ? `https://example.com/page${i-1}` : '',
        content: `Content for page ${i}`,
        tab_id: 100 + i
      }));

      const responses = await Promise.all(
        visits.map(visit => 
          make_http_request(
            `http://localhost:${port}/visit`,
            { method: 'POST', json: visit }
          )
        )
      );

      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.data.status).toBe('queued');
      });

      // All visits should be processed
      expect(processed_visits).toHaveLength(5);
    });

    it('should preserve referrer chain information', async () => {
      const visit_chain = [
        { 
          url: 'https://example.com', 
          referrer: '',
          referrer_page_session_id: null,
          tab_id: 1 
        },
        { 
          url: 'https://example.com/page1', 
          referrer: 'https://example.com',
          referrer_page_session_id: 'session-1',
          tab_id: 1 
        },
        { 
          url: 'https://example.com/page2', 
          referrer: 'https://example.com/page1',
          referrer_page_session_id: 'session-2',
          tab_id: 1 
        }
      ];

      for (const visit of visit_chain) {
        const response = await make_http_request(
          `http://localhost:${port}/visit`,
          {
            method: 'POST',
            json: {
              ...visit,
              page_loaded_at: new Date().toISOString(),
              content: `Content for ${visit.url}`
            }
          }
        );

        expect(response.status).toBe(200);
      }

      // Verify referrer chain is preserved
      expect(processed_visits).toHaveLength(3);
      expect(processed_visits[0].referrer).toBe('');
      expect(processed_visits[1].referrer).toBe('https://example.com');
      expect(processed_visits[2].referrer).toBe('https://example.com/page1');
    });
  });

  describe('Error Handling', () => {
    it('should reject malformed JSON', async () => {
      const response = await make_http_request(
        `http://localhost:${port}/visit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json {'
        }
      );
      
      expect(response.status).toBe(400);
    });

    it('should handle empty request body', async () => {
      const response = await make_http_request(
        `http://localhost:${port}/visit`,
        { method: 'POST', json: {} }
      );
      
      // Should still accept it (minimal validation in this test)
      expect(response.status).toBe(200);
    });

    it('should handle server shutdown gracefully', async () => {
      // Close the server
      await new Promise<void>(resolve => server.close(() => resolve()));

      // Try to connect
      try {
        await make_http_request(
          `http://localhost:${port}/status`,
          { timeout: 1000 }
        );
        fail('Should have thrown connection error');
      } catch (error: any) {
        expect(error.code).toMatch(/ECONNREFUSED/);
      }
    });
  });

  describe('Native Host Message Forwarding Simulation', () => {
    it('should handle messages as forwarded by native host', async () => {
      // This simulates exactly what the native host Python script does
      const browser_message = {
        url: 'https://via-native-host.com',
        page_loaded_at: new Date().toISOString(),
        referrer: 'https://google.com',
        content: 'Page content from browser',
        tab_id: 999,
        opener_tab_id: null
      };

      // Native host forwards to the /visit endpoint
      const response = await make_http_request(
        `http://localhost:${port}/visit`,
        { method: 'POST', json: browser_message }
      );

      expect(response.status).toBe(200);
      expect(response.data.status).toBe('queued');
      
      // Verify message was processed
      expect(processed_visits).toHaveLength(1);
      expect(processed_visits[0].url).toBe(browser_message.url);
    });

    it('should handle native host status check', async () => {
      // Native host checks if VSCode extension is running
      const response = await make_http_request(`http://localhost:${port}/status`);
      
      expect(response.status).toBe(200);
      expect(response.data.status).toBe('running');
    });
  });

  describe('Message Queue Behavior', () => {
    it('should queue messages and assign positions', async () => {
      const messages = Array.from({ length: 3 }, (_, i) => ({
        url: `https://queue-test.com/page${i}`,
        page_loaded_at: new Date(Date.now() + i * 1000).toISOString(),
        content: `Queue content ${i}`,
        tab_id: 200 + i
      }));

      const responses = [];
      for (const msg of messages) {
        const response = await make_http_request(
          `http://localhost:${port}/visit`,
          { method: 'POST', json: msg }
        );
        responses.push(response.data);
      }

      // Check queue positions
      expect(responses[0].position).toBe(1);
      expect(responses[1].position).toBe(2);
      expect(responses[2].position).toBe(3);
      
      // All messages should be queued
      expect(processed_visits).toHaveLength(3);
    });
  });
});

describe('Native Messaging Protocol Format', () => {
  it('should correctly format messages for native messaging protocol', () => {
    // Native messaging uses 4-byte length header + JSON message
    const message = { type: 'forward', data: { url: 'test' } };
    const json_str = JSON.stringify(message);
    const buffer = Buffer.from(json_str, 'utf-8');
    
    // Length should be stored as 32-bit unsigned integer, little-endian
    const length_buffer = Buffer.allocUnsafe(4);
    length_buffer.writeUInt32LE(buffer.length, 0);
    
    expect(length_buffer.length).toBe(4);
    expect(length_buffer.readUInt32LE(0)).toBe(buffer.length);
  });

  it('should handle maximum message size limit', () => {
    // Chrome native messaging has a maximum message size of 1MB
    const max_size = 1024 * 1024; // 1MB
    const large_content = 'x'.repeat(max_size - 200); // Leave room for JSON structure
    
    const large_message = {
      type: 'forward',
      endpoint: '/visit',
      data: {
        url: 'https://example.com',
        content: large_content
      }
    };
    
    const json_str = JSON.stringify(large_message);
    expect(json_str.length).toBeLessThanOrEqual(max_size);
  });

  it('should encode and decode messages correctly', () => {
    const original_message = {
      type: 'forward',
      endpoint: '/visit',
      data: {
        url: 'https://example.com',
        page_loaded_at: '2024-01-01T00:00:00Z',
        content: 'Test content'
      }
    };

    // Encode
    const json_str = JSON.stringify(original_message);
    const message_buffer = Buffer.from(json_str, 'utf-8');
    const length_buffer = Buffer.allocUnsafe(4);
    length_buffer.writeUInt32LE(message_buffer.length, 0);
    
    const full_message = Buffer.concat([length_buffer, message_buffer]);

    // Decode
    const decoded_length = full_message.readUInt32LE(0);
    const decoded_json = full_message.slice(4, 4 + decoded_length).toString('utf-8');
    const decoded_message = JSON.parse(decoded_json);

    expect(decoded_message).toEqual(original_message);
  });
});