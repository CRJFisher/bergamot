/**
 * A local, ephemeral HTTP server that serves re-download test fixtures over real
 * loopback HTTP. The headless fetcher navigates genuine `http://127.0.0.1:<port>`
 * URLs so real status codes, redirects, and content types exercise the
 * classifier — not mocked responses. Bound to 127.0.0.1 on an OS-assigned port;
 * the suite never touches the network.
 */
import http from "http";
import { AddressInfo } from "net";

/** A clean public article with the `<meta>` fields AC#3 parses from re-download. */
export const ARTICLE_HTML = `<!doctype html>
<html lang="en-GB">
<head>
  <title>Re-download Works</title>
  <meta property="og:site_name" content="Bergamot Times" />
  <meta name="author" content="Ada Lovelace" />
  <meta property="article:published_time" content="2026-01-02T03:04:05Z" />
</head>
<body><article><h1>Re-download Works</h1><p>${"public informational content ".repeat(
  40
)}</p></article></body>
</html>`;

const LOGIN_HTML = `<!doctype html><html lang="en"><head><title>Sign in</title></head>
<body><form><input type="password" name="pw" /><button>Sign in</button></form></body></html>`;

const PAYWALL_HTML = `<!doctype html><html lang="en"><head><title>Members Only</title>
<script type="application/ld+json">{"@type":"Article","isAccessibleForFree":false}</script></head>
<body><article class="meteredContent"><p>Teaser…</p><div data-paywall>Subscribe to continue</div></article></body></html>`;

export interface FixtureServer {
  /** Builds an absolute URL for a fixture path on this server. */
  url(path: string): string;
  /** Stops the server. */
  close(): Promise<void>;
}

/** Starts the fixture server and resolves once it is listening. */
export function start_fixture_server(): Promise<FixtureServer> {
  // First hit to /flaky returns 429; subsequent hits succeed — exercises retry.
  let flaky_hits = 0;

  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    switch (path) {
      case "/article":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(ARTICLE_HTML);
        return;
      case "/protected":
        res.writeHead(302, { location: "/login" });
        res.end();
        return;
      case "/login":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(LOGIN_HTML);
        return;
      case "/paywall":
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PAYWALL_HTML);
        return;
      case "/forbidden":
        res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>Forbidden</body></html>");
        return;
      case "/missing":
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>Not found</body></html>");
        return;
      case "/document.pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        res.end("%PDF-1.4 fake pdf body");
        return;
      case "/flaky":
        flaky_hits++;
        if (flaky_hits === 1) {
          res.writeHead(429, { "retry-after": "0" });
          res.end("too many requests");
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(ARTICLE_HTML);
        return;
      default:
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end("<html><body>unknown fixture</body></html>");
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: (path: string) => `http://127.0.0.1:${port}${path}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
