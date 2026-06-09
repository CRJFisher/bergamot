import { DuckDB, get_webpage_capture } from "../duck_db";
import { store_capture } from "./store_capture";

/**
 * Verifies capture storage: a capture writes a metadata-only row keyed by
 * page_session_id (url, title, content type, capture timestamp). Uses a real
 * in-memory DuckDB. Page content is read back by re-downloading the public URL
 * (the re-download corpus, task-39.2), not from this store.
 */
describe("store_capture", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
  });

  afterEach(async () => {
    await db.close();
  });

  it("stores the browsing metadata for a visit", async () => {
    const meta = await store_capture(db, {
      page_session_id: "p1",
      url: "https://example.com/a",
      title: "Understanding zstd & capture",
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    expect(meta).toEqual({
      page_session_id: "p1",
      url: "https://example.com/a",
      title: "Understanding zstd & capture",
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });
  });

  it("persists the metadata view, read back by page_session_id", async () => {
    await store_capture(db, {
      page_session_id: "p4",
      url: "https://example.com/d",
      title: "Only Title",
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    const meta = await get_webpage_capture(db, "p4");
    expect(meta?.title).toBe("Only Title");
    expect(meta?.content_type).toBe("text/html");
    expect(meta?.url).toBe("https://example.com/d");
  });

  it("stores zero page content (metadata only)", async () => {
    await store_capture(db, {
      page_session_id: "p5",
      url: "https://example.com/e",
      title: "No Content",
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    const meta = await get_webpage_capture(db, "p5");
    // The record carries no content field of any kind.
    expect(meta && "content" in meta).toBe(false);
    expect(meta && "content_compressed" in meta).toBe(false);
  });

  it("returns null when no capture exists", async () => {
    expect(await get_webpage_capture(db, "missing")).toBeNull();
  });
});
