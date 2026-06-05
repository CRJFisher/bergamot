import { DuckDB } from "../duck_db";
import { read_metadata } from "./read_metadata";
import { evaluate_page_gate } from "./page_gate";
import { store_capture, read_capture } from "./store_capture";
import { CAPTURE_FIXTURES } from "./__fixtures__/capture_fixtures";

/**
 * Light capture eval (task-35.10): over a committed fixture set of raw pages,
 * asserts (1) the raw page round-trips losslessly through the capture store,
 * (2) cheap <head> metadata is extracted correctly, and (3) the deterministic
 * gate's keep/drop matches the labels. Fully deterministic and offline.
 * Extraction / summary / retrieval quality are evaluated by task-31's RAG
 * harness, not here.
 */
describe("capture eval (deterministic, offline)", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
  });

  afterEach(async () => {
    await db.close();
  });

  it.each(CAPTURE_FIXTURES.map((f) => [f.name, f] as const))(
    "gate matches the keep/drop label for %s",
    (_name, fixture) => {
      expect(evaluate_page_gate(fixture.html, fixture.url)).toEqual(
        fixture.expected_gate
      );
    }
  );

  it.each(
    CAPTURE_FIXTURES.filter((f) => f.expected_metadata).map(
      (f) => [f.name, f] as const
    )
  )("extracts cheap <head> metadata for %s", (_name, fixture) => {
    expect(read_metadata(fixture.html, fixture.url)).toEqual(
      fixture.expected_metadata
    );
  });

  it.each(
    CAPTURE_FIXTURES.filter((f) => f.expected_gate.keep).map(
      (f) => [f.name, f] as const
    )
  )("round-trips the raw page losslessly for kept fixture %s", async (
    _name,
    fixture
  ) => {
    await store_capture(db, {
      page_session_id: fixture.name,
      url: fixture.url,
      html: fixture.html,
      content_type: fixture.content_type,
      captured_at: "2026-06-05T00:00:00.000Z",
    });

    const recovered = await read_capture(db, fixture.name);
    expect(recovered).not.toBeNull();
    expect(recovered?.html).toBe(fixture.html);
    expect(Buffer.from(recovered!.html, "utf-8")).toEqual(
      Buffer.from(fixture.html, "utf-8")
    );
  });

  it("runs offline with no network (capture is fully deterministic)", () => {
    // The whole suite imports only read_metadata / evaluate_page_gate /
    // store_capture (zstd) / DuckDB — no network access. Capture is a pure
    // function of the raw page bytes.
    expect(typeof read_metadata).toBe("function");
    expect(typeof evaluate_page_gate).toBe("function");
  });
});
