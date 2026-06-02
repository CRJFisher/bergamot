/**
 * Static page server for e2e tests. The content script only runs on http/https
 * URLs (not data:/about:), so cross-tab and SPA scenarios need real pages with
 * real links. Each page sets a distinct title and carries links that open new
 * tabs, navigate in-place, and drive SPA history changes.
 */

import * as http from "http";

const PAGES: Record<string, string> = {
  "/page-a": `<!doctype html><html><head><title>Page A</title></head><body>
    <h1>Page A</h1>
    <a id="to-b-new-tab" href="/page-b" target="_blank">open B in new tab</a>
    <a id="to-c-same-tab" href="/page-c">go to C</a>
    <button id="open-d" onclick="window.open('/page-d', '_blank')">window.open D</button>
  </body></html>`,
  "/page-b": `<!doctype html><html><head><title>Page B</title></head><body><h1>Page B</h1></body></html>`,
  "/page-c": `<!doctype html><html><head><title>Page C</title></head><body><h1>Page C</h1></body></html>`,
  "/page-d": `<!doctype html><html><head><title>Page D</title></head><body><h1>Page D</h1></body></html>`,
  "/spa": `<!doctype html><html><head><title>SPA Root</title></head><body>
    <h1>SPA</h1>
    <button id="push-sub1" onclick="history.pushState({}, '', '/spa/sub1')">push sub1</button>
    <button id="push-sub2" onclick="history.pushState({}, '', '/spa/sub2')">push sub2</button>
  </body></html>`,
};

export class TestPageServer {
  private server: http.Server | null = null;
  private port = 0;

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const pathname = (req.url || "/").split("?")[0];
        // SPA sub-routes resolve to the SPA root document.
        const key = pathname.startsWith("/spa/") ? "/spa" : pathname;
        const body = PAGES[key];
        if (body === undefined) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(body);
      });
      this.server.listen(0, () => {
        const address = this.server!.address();
        this.port = typeof address === "object" && address ? address.port : 0;
        resolve();
      });
      this.server.on("error", reject);
    });
  }

  url(pathname: string): string {
    return `http://localhost:${this.port}${pathname}`;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        // The browser holds keep-alive connections; close() alone would block
        // until they idle out. Force them shut so teardown is prompt.
        this.server.closeAllConnections?.();
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
