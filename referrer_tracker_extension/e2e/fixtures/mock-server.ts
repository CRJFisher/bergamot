import { createServer, Server } from "http";
import { URL } from "url";

export interface RequestLog {
  endpoint: string;
  method: string;
  body: any;
  timestamp: number;
}

export class MockPKMServer {
  private server: Server;
  private requests: RequestLog[] = [];
  private port: number;
  private started = false;

  constructor(port = 0) {
    // Use 0 for dynamic port assignment
    this.port = port;
    this.server = createServer(this.handleRequest.bind(this));
  }

  private handleRequest(req: any, res: any) {
    // Enable CORS for the extension
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk: any) => {
        body += chunk.toString();
      });

      req.on("end", () => {
        try {
          const parsedBody = JSON.parse(body);
          const url = new URL(req.url, `http://localhost:${this.port}`);

          this.requests.push({
            endpoint: url.pathname,
            method: req.method,
            body: parsedBody,
            timestamp: Date.now(),
          });

          console.log(
            `Mock server received ${req.method} ${url.pathname}:`,
            parsedBody
          );

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "success" }));
        } catch (error) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
    } else {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.started) {
        resolve();
        return;
      }

      this.server.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err);
        } else {
          this.started = true;
          // Get the actual port assigned by the system
          const address = this.server.address();
          this.port = (address as any)?.port || this.port;
          console.log(`Mock PKM server started on port ${this.port}`);
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.started) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.started = false;
        console.log("Mock PKM server stopped");
        resolve();
      });
    });
  }

  getRequests(): RequestLog[] {
    return [...this.requests];
  }

  getRequestsByEndpoint(endpoint: string): RequestLog[] {
    return this.requests.filter((req) => req.endpoint === endpoint);
  }

  clearRequests(): void {
    this.requests = [];
  }

  isRunning(): boolean {
    return this.started;
  }

  getPort(): number {
    return this.port;
  }
}
