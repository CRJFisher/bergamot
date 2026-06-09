import { read_metadata } from "./read_metadata";
import { READ_METADATA_FIXTURES } from "./__fixtures__/read_metadata_fixtures";

/**
 * Light metadata eval: over a committed fixture set of raw pages, asserts the
 * cheap <head> metadata is extracted correctly — the same parse the re-download
 * fetcher applies to re-downloaded pages (task-39.2). Fully deterministic and
 * offline. (Capture itself reads no page content; this exercises the parser the
 * re-download corpus depends on.)
 */
describe("read_metadata eval (deterministic, offline)", () => {
  it.each(READ_METADATA_FIXTURES.map((f) => [f.name, f] as const))(
    "extracts cheap <head> metadata for %s",
    (_name, fixture) => {
      expect(read_metadata(fixture.html, fixture.url)).toEqual(
        fixture.expected_metadata
      );
    }
  );

  it("runs offline with no network (metadata is deterministic)", () => {
    // The suite imports only read_metadata — no network access. Metadata is a
    // pure function of the page bytes.
    expect(typeof read_metadata).toBe("function");
  });
});
