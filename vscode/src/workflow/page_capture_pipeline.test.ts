import { run_page_capture, CaptureDeps } from "./page_capture_pipeline";
import { DuckDB } from "../duck_db";
import * as duckDbQueries from "../duck_db";
import { PageActivitySession } from "../duck_db_models";

// duck_db is auto-mocked, so insert_webpage_capture is a jest.fn(); store_capture
// itself runs for real over the mocked insert.
jest.mock("../duck_db");

describe("run_page_capture (capture pipeline)", () => {
  const deps: CaptureDeps = { duck_db: {} as DuckDB };

  const inputs = {
    new_page: {
      id: "page-2",
      url: "https://example.com/page2",
      referrer: null,
      tree_id: "tree-123",
      page_loaded_at: "2024-01-01T12:00:00Z",
    } as PageActivitySession,
    title: "Page Two",
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(duckDbQueries, "insert_webpage_capture").mockResolvedValue(undefined);
  });

  it("stores a visit's metadata", async () => {
    await run_page_capture(deps, inputs);

    expect(duckDbQueries.insert_webpage_capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        page_session_id: "page-2",
        url: "https://example.com/page2",
        title: "Page Two",
        content_type: "text/html",
      })
    );
  });

  it("stores every visit — there is no capture gate", async () => {
    // A previously gate-dropped shape (empty-ish title) is still stored: the
    // capture gate is gone; auth/redirect filtering lives in re-download.
    await run_page_capture(deps, { ...inputs, title: "" });

    expect(duckDbQueries.insert_webpage_capture).toHaveBeenCalledTimes(1);
  });

  it("propagates capture errors", async () => {
    jest
      .spyOn(duckDbQueries, "insert_webpage_capture")
      .mockRejectedValue(new Error("disk full"));
    await expect(run_page_capture(deps, inputs)).rejects.toThrow("disk full");
  });
});
