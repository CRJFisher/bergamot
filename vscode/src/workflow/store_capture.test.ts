import { DuckDB, get_webpage_capture } from "../duck_db";
import { store_capture, read_capture } from "./store_capture";

/**
 * Verifies capture storage: the raw page round-trips losslessly through
 * zstd+DuckDB, and cheap <head> metadata is read non-LLM. Uses a real in-memory
 * DuckDB so the BLOB column behaviour is exercised for real.
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

  const RICH_HTML = `<!doctype html>
<html lang="en-GB">
<head>
  <title>Understanding zstd &amp; capture</title>
  <meta property="og:site_name" content="Bergamot Docs" />
  <meta name="author" content="Ada Lovelace" />
  <meta property="article:published_time" content="2026-01-02T03:04:05Z" />
</head>
<body><h1>Body</h1><p>Some content with binary-ish chars: éü—🚀</p></body>
</html>`;

  it("round-trips the raw page byte-identically", async () => {
    await store_capture(db, {
      page_session_id: "p1",
      url: "https://example.com/a",
      html: RICH_HTML,
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    const recovered = await read_capture(db, "p1");
    expect(recovered).not.toBeNull();
    expect(recovered?.html).toBe(RICH_HTML);
    // Byte-identical when re-encoded to UTF-8 (covers multibyte/emoji).
    expect(Buffer.from(recovered!.html, "utf-8")).toEqual(
      Buffer.from(RICH_HTML, "utf-8")
    );
  });

  it("stores original_byte_size as the decompressed length", async () => {
    const meta = await store_capture(db, {
      page_session_id: "p2",
      url: "https://example.com/b",
      html: RICH_HTML,
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });
    expect(meta.original_byte_size).toBe(Buffer.byteLength(RICH_HTML, "utf-8"));
  });

  it("reads cheap metadata from the <head> with no LLM", async () => {
    const meta = await store_capture(db, {
      page_session_id: "p3",
      url: "https://example.com/c",
      html: RICH_HTML,
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    expect(meta.title).toBe("Understanding zstd & capture");
    expect(meta.site_name).toBe("Bergamot Docs");
    expect(meta.author).toBe("Ada Lovelace");
    expect(meta.published_at).toBe("2026-01-02T03:04:05Z");
    expect(meta.lang).toBe("en-GB");
  });

  it("persists the metadata view without decompressing the page", async () => {
    await store_capture(db, {
      page_session_id: "p4",
      url: "https://example.com/d",
      html: "<html><head><title>Only Title</title></head><body>x</body></html>",
      content_type: "text/html",
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    const meta = await get_webpage_capture(db, "p4");
    expect(meta?.title).toBe("Only Title");
    expect(meta?.site_name).toBeNull();
    expect(meta?.author).toBeNull();
    expect(meta?.content_type).toBe("text/html");
    expect(meta?.url).toBe("https://example.com/d");
  });

  it("returns null when no capture exists", async () => {
    expect(await read_capture(db, "missing")).toBeNull();
    expect(await get_webpage_capture(db, "missing")).toBeNull();
  });
});
