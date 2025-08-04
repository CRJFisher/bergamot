"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPKMServer = void 0;
const http_1 = require("http");
const url_1 = require("url");
class MockPKMServer {
    server;
    requests = [];
    port;
    started = false;
    constructor(port = 0) {
        // Use 0 for dynamic port assignment
        this.port = port;
        this.server = (0, http_1.createServer)(this.handleRequest.bind(this));
    }
    handleRequest(req, res) {
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
            req.on("data", (chunk) => {
                body += chunk.toString();
            });
            req.on("end", () => {
                try {
                    const parsedBody = JSON.parse(body);
                    const url = new url_1.URL(req.url, `http://localhost:${this.port}`);
                    this.requests.push({
                        endpoint: url.pathname,
                        method: req.method,
                        body: parsedBody,
                        timestamp: Date.now(),
                    });
                    console.log(`Mock server received ${req.method} ${url.pathname}:`, parsedBody);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ status: "success" }));
                }
                catch (error) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid JSON" }));
                }
            });
        }
        else {
            res.writeHead(405, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Method not allowed" }));
        }
    }
    async start() {
        return new Promise((resolve, reject) => {
            if (this.started) {
                resolve();
                return;
            }
            this.server.listen(this.port, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    this.started = true;
                    // Get the actual port assigned by the system
                    const address = this.server.address();
                    this.port = address?.port || this.port;
                    console.log(`Mock PKM server started on port ${this.port}`);
                    resolve();
                }
            });
        });
    }
    async stop() {
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
    getRequests() {
        return [...this.requests];
    }
    getRequestsByEndpoint(endpoint) {
        return this.requests.filter((req) => req.endpoint === endpoint);
    }
    clearRequests() {
        this.requests = [];
    }
    isRunning() {
        return this.started;
    }
    getPort() {
        return this.port;
    }
}
exports.MockPKMServer = MockPKMServer;
//# sourceMappingURL=mock-server.js.map