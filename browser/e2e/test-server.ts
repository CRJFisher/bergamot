/**
 * Mock server for E2E testing
 * Provides controlled test scenarios with different website types
 */

import express from 'express';
import { Server } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class TestServer {
  private app: express.Application;
  private server: Server | null = null;
  private port: number;
  
  constructor(port: number = 3456) {
    this.port = port;
    this.app = express();
    this.setupRoutes();
  }
  
  private setupRoutes(): void {
    // Serve static files
    this.app.use('/static', express.static(path.join(__dirname, 'test-sites')));
    
    // Traditional multi-page site
    this.app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Test Home</title></head>
        <body>
          <h1>PKM Test Site</h1>
          <nav>
            <a href="/page1">Page 1</a>
            <a href="/page2">Page 2</a>
            <a href="/spa">SPA Demo</a>
            <a href="/github-mock">GitHub Mock</a>
          </nav>
        </body>
        </html>
      `);
    });
    
    this.app.get('/page1', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Page 1</title></head>
        <body>
          <h1>Page 1</h1>
          <a href="/page2">Go to Page 2</a>
          <a href="/">Back Home</a>
          <a href="/page3" target="_blank">Open Page 3 in New Tab</a>
          <button onclick="window.open('/popup', 'popup', 'width=400,height=300')">Open Popup</button>
        </body>
        </html>
      `);
    });
    
    this.app.get('/page2', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Page 2</title></head>
        <body>
          <h1>Page 2</h1>
          <a href="/page1">Back to Page 1</a>
          <a href="/">Home</a>
          <form action="/form-result" method="get">
            <input type="text" name="query" placeholder="Search...">
            <button type="submit">Submit</button>
          </form>
        </body>
        </html>
      `);
    });
    
    this.app.get('/page3', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Page 3 - New Tab</title></head>
        <body>
          <h1>Page 3 (Opened in New Tab)</h1>
          <p>This page was opened in a new tab</p>
          <a href="/page1">Go to Page 1</a>
        </body>
        </html>
      `);
    });
    
    this.app.get('/popup', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Popup Window</title></head>
        <body>
          <h1>Popup Window</h1>
          <p>This is a popup window</p>
          <button onclick="window.close()">Close</button>
        </body>
        </html>
      `);
    });
    
    this.app.get('/form-result', (req, res) => {
      const query = req.query.query || '';
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Search Results</title></head>
        <body>
          <h1>Search Results for: ${query}</h1>
          <a href="/page2">Back to Search</a>
        </body>
        </html>
      `);
    });
    
    // Server-side redirect
    this.app.get('/redirect', (req, res) => {
      res.redirect('/page1');
    });
    
    // Meta refresh redirect
    this.app.get('/meta-redirect', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Redirecting...</title>
          <meta http-equiv="refresh" content="2;url=/page2">
        </head>
        <body>
          <p>Redirecting in 2 seconds...</p>
        </body>
        </html>
      `);
    });
    
    // SPA with React-like routing
    this.app.get('/spa*', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>SPA Demo</title></head>
        <body>
          <div id="app">
            <nav>
              <a href="#" data-route="/">Home</a>
              <a href="#" data-route="/about">About</a>
              <a href="#" data-route="/contact">Contact</a>
              <a href="#" data-route="/products">Products</a>
            </nav>
            <div id="content">Loading...</div>
          </div>
          <script>
            // Simple SPA router
            const routes = {
              '/': '<h1>SPA Home</h1><p>Welcome to the SPA</p>',
              '/about': '<h1>About Us</h1><p>This is the about page</p>',
              '/contact': '<h1>Contact</h1><p>Contact us here</p>',
              '/products': '<h1>Products</h1><ul><li>Product 1</li><li>Product 2</li></ul>'
            };
            
            function navigate(path) {
              const content = routes[path] || '<h1>404</h1>';
              document.getElementById('content').innerHTML = content;
              history.pushState({ path }, '', '/spa' + path);
              document.title = 'SPA - ' + path;
            }
            
            // Handle navigation
            document.querySelectorAll('[data-route]').forEach(link => {
              link.addEventListener('click', (e) => {
                e.preventDefault();
                navigate(e.target.dataset.route);
              });
            });
            
            // Handle browser back/forward
            window.addEventListener('popstate', (e) => {
              if (e.state && e.state.path) {
                navigate(e.state.path);
              }
            });
            
            // Initial load
            navigate('/');
          </script>
        </body>
        </html>
      `);
    });
    
    // GitHub-like mock
    this.app.get('/github-mock*', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>GitHub Mock</title></head>
        <body>
          <div id="app">
            <header>
              <h1>GitHub Mock</h1>
              <nav>
                <a href="#" data-pjax="/user/repo">Repository</a>
                <a href="#" data-pjax="/user/repo/issues">Issues</a>
                <a href="#" data-pjax="/user/repo/pulls">Pull Requests</a>
                <a href="#" data-pjax="/user/repo/wiki">Wiki</a>
                <a href="#" data-pjax="/user/repo/settings">Settings</a>
              </nav>
            </header>
            <main id="content">
              <div class="repo-content">Loading...</div>
            </main>
          </div>
          <script>
            // GitHub-like PJAX navigation
            const repoContent = {
              '/user/repo': '<h2>Code</h2><div class="file-list">README.md<br>package.json<br>src/</div>',
              '/user/repo/issues': '<h2>Issues</h2><ul><li>Issue #1: Bug fix</li><li>Issue #2: Feature request</li></ul>',
              '/user/repo/pulls': '<h2>Pull Requests</h2><ul><li>PR #1: Add feature X</li><li>PR #2: Fix bug Y</li></ul>',
              '/user/repo/wiki': '<h2>Wiki</h2><p>Documentation goes here</p>',
              '/user/repo/settings': '<h2>Settings</h2><p>Repository settings</p>'
            };
            
            function loadContent(path) {
              const content = repoContent[path] || '<h2>404 - Not Found</h2>';
              document.querySelector('.repo-content').innerHTML = content;
              history.pushState({ path }, '', '/github-mock' + path);
              document.title = 'GitHub Mock - ' + path;
            }
            
            // Handle PJAX navigation
            document.querySelectorAll('[data-pjax]').forEach(link => {
              link.addEventListener('click', (e) => {
                e.preventDefault();
                loadContent(e.target.dataset.pjax);
              });
            });
            
            // Handle browser navigation
            window.addEventListener('popstate', (e) => {
              if (e.state && e.state.path) {
                loadContent(e.state.path);
              }
            });
            
            // Initial load
            loadContent('/user/repo');
          </script>
        </body>
        </html>
      `);
    });
    
    // Page with iframes
    this.app.get('/iframe-test', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Iframe Test</title></head>
        <body>
          <h1>Page with Iframes</h1>
          <iframe src="/page1" width="400" height="300"></iframe>
          <iframe src="/spa" width="400" height="300"></iframe>
          <a href="/page2">Navigate away</a>
        </body>
        </html>
      `);
    });
    
    // Hash-based routing
    this.app.get('/hash-router', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Hash Router Demo</title></head>
        <body>
          <nav>
            <a href="#home">Home</a>
            <a href="#about">About</a>
            <a href="#contact">Contact</a>
          </nav>
          <div id="content">Select a page</div>
          <script>
            function handleHashChange() {
              const hash = window.location.hash.slice(1) || 'home';
              const content = {
                'home': '<h2>Home Page</h2>',
                'about': '<h2>About Page</h2>',
                'contact': '<h2>Contact Page</h2>'
              };
              document.getElementById('content').innerHTML = content[hash] || '<h2>404</h2>';
            }
            window.addEventListener('hashchange', handleHashChange);
            handleHashChange();
          </script>
        </body>
        </html>
      `);
    });
  }
  
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`Test server running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }
  
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
  
  getUrl(path: string = '/'): string {
    return `http://localhost:${this.port}${path}`;
  }
}