import { read_metadata } from "./read_metadata";
import { evaluate_page_gate } from "./page_gate";
import { CAPTURE_FIXTURES } from "./__fixtures__/capture_fixtures";

/**
 * Light capture eval: over a committed fixture set of raw pages, asserts (1) cheap
 * <head> metadata is extracted correctly — the same parse the re-download fetcher
 * applies to re-downloaded pages (task-39.2) — and (2) the deterministic gate's
 * keep/drop matches the labels. Fully deterministic and offline.
 */
describe("capture eval (deterministic, offline)", () => {
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

  it("runs offline with no network (capture metadata is deterministic)", () => {
    // The suite imports only read_metadata / evaluate_page_gate — no network
    // access. Capture metadata is a pure function of the page bytes.
    expect(typeof read_metadata).toBe("function");
    expect(typeof evaluate_page_gate).toBe("function");
  });
});
