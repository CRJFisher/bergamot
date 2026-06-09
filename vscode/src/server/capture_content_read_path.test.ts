import type { Application } from "express";
import request from "supertest";
import { ServerManager } from "./server_manager";
import { DuckDB } from "../duck_db";
import { ContentCorpus, CorpusEntry } from "../redownload/corpus";

jest.mock("vscode");

/**
 * Verifies the content read path (AC#5): `/query/capture_content` serves
 * re-downloaded content for an ok page and reports unavailable (no content) for
 * an excluded page. A fake corpus is injected so the route is tested without a
 * browser; the real re-download path is covered by the fetcher integration test.
 */
const fake_corpus: ContentCorpus = {
  async get_content(page_session_id: string): Promise<CorpusEntry | null> {
    if (page_session_id === "ok1") {
      return {
        outcome: "ok",
        content: {
          page_session_id: "ok1",
          url: "https://example.com/public",
          title: "Public Title",
          content: "<html><body>public</body></html>",
          site_name: "Example",
          author: "Ada",
          published_at: null,
          lang: "en",
          fetched_at: "2026-06-09T00:00:00.000Z",
          http_status: 200,
          content_hash: "a".repeat(64),
        },
      };
    }
    if (page_session_id === "auth1") {
      return {
        outcome: "auth_redirect",
        page_session_id: "auth1",
        url: "https://example.com/members",
        reason: "redirected to login",
      };
    }
    if (page_session_id === "boom") {
      // Simulates a re-download infrastructure failure (e.g. browser launch).
      throw new Error("headless browser failed to launch");
    }
    return null;
  },
  // eslint-disable-next-line require-yield
  async *iter_public_pages() {
    return;
  },
};

describe("/query/capture_content read path", () => {
  let db: DuckDB;
  let server: ServerManager;
  let app: Application;

  beforeAll(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    server = new ServerManager({ duck_db: db, content_corpus: fake_corpus });
    server.prepare();
    app = (server as object as { app: Application }).app;
  });

  afterAll(async () => {
    await server.stop();
    await db.close();
  });

  it("serves re-downloaded content for an ok page", async () => {
    const res = await request(app)
      .get("/query/capture_content")
      .query({ page_session_id: "ok1" })
      .expect(200);
    expect(res.body.outcome).toBe("ok");
    expect(res.body.content.content).toContain("public");
    expect(res.body.content.title).toBe("Public Title");
  });

  it("reports unavailable (no content) for an excluded page", async () => {
    const res = await request(app)
      .get("/query/capture_content")
      .query({ page_session_id: "auth1" })
      .expect(200);
    expect(res.body.outcome).toBe("auth_redirect");
    expect(res.body.content).toBeUndefined();
    expect(res.body.reason).toContain("login");
  });

  it("returns null when no metadata row exists", async () => {
    const res = await request(app)
      .get("/query/capture_content")
      .query({ page_session_id: "missing" })
      .expect(200);
    expect(res.body).toBeNull();
  });

  it("rejects a missing page_session_id with 400", async () => {
    await request(app).get("/query/capture_content").expect(400);
  });

  it("reports 503 unavailable when the re-download infrastructure fails", async () => {
    const res = await request(app)
      .get("/query/capture_content")
      .query({ page_session_id: "boom" })
      .expect(503);
    expect(res.body.outcome).toBe("unavailable");
    expect(res.body.reason).toMatch(/launch/i);
  });
});
