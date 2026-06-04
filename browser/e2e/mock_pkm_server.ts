/**
 * Mock PKM Server for E2E Testing
 * Simulates the VS Code PKM extension HTTP endpoint
 */

import * as http from 'http';
import * as url from 'url';

export class MockPKMServer {
  private server: http.Server | null = null;
  private port: number;
  private visits: unknown[] = [];
  private requests_received: unknown[] = [];
  
  constructor(port: number = 5000) {
    this.port = port;
  }
  
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // Handle preflight requests
        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }
        
        const parsed_url = url.parse(req.url || '', true);
        const pathname = parsed_url.pathname || '';
        
        // Log the request
        console.log(`📨 Mock PKM Server: ${req.method} ${pathname}`);
        
        if (req.method === 'GET' && pathname === '/status') {
          // Status endpoint
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            // The browser's server discovery only accepts a server whose /status
            // reports this service marker, so the mock must include it too.
            service: 'bergamot',
            status: 'ok',
            mock: true,
            visits_count: this.visits.length
          }));
          
        } else if (req.method === 'POST' && pathname === '/visit') {
          // Visit tracking endpoint
          let body = '';
          
          req.on('data', chunk => {
            body += chunk.toString();
          });
          
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              
              // Store the visit
              this.visits.push({
                timestamp: new Date().toISOString(),
                ...data
              });
              
              this.requests_received.push({
                endpoint: pathname,
                method: req.method,
                timestamp: new Date().toISOString(),
                data
              });
              
              console.log(`✅ Recorded visit to: ${data.url}`);
              
              // Send success response
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                message: 'Visit recorded',
                visit_id: this.visits.length
              }));
              
            } catch (error) {
              console.error('❌ Error processing visit:', error);
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
              }));
            }
          });
          
        } else if (req.method === 'GET' && pathname === '/visits') {
          // Get all visits (for testing)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(this.visits));
          
        } else {
          // Unknown endpoint
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Not found',
            path: pathname
          }));
        }
      });
      
      this.server.listen(this.port, () => {
        console.log(`🚀 Mock PKM Server listening on http://localhost:${this.port}`);
        resolve();
      });
      
      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.log(`⚠️ Port ${this.port} is already in use`);
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(error);
        }
      });
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // Force keep-alive connections shut so teardown does not block on the
        // browser's idle connections.
        this.server.closeAllConnections?.();
        this.server.close(() => {
          console.log('🛑 Mock PKM Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  get_visits(): unknown[] {
    return this.visits;
  }

  get_requests(): unknown[] {
    return this.requests_received;
  }
  
  clear_visits(): void {
    this.visits = [];
    this.requests_received = [];
  }
  
  get_visit_count(): number {
    return this.visits.length;
  }
  
  get_last_visit(): unknown | null {
    return this.visits.length > 0 ? this.visits[this.visits.length - 1] : null;
  }
}

// Allow running as standalone server
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MockPKMServer(5000);
  
  server.start().then(() => {
    console.log('Mock PKM Server is running');
    console.log('Press Ctrl+C to stop');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down...');
      await server.stop();
      process.exit(0);
    });
  }).catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}