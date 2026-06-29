import { run_page_capture } from "./page_capture_pipeline";
import { DuckDB } from "../duck_db";
import * as duckDbQueries from "../duck_db";
import * as devLog from "../dev_log";
import { PageActivitySession } from "../duck_db_models";

jest.mock("../duck_db");
jest.mock("../dev_log");

describe("run_page_capture (capture pipeline)", () => {
  const db = {} as DuckDB;

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
    jest
      .spyOn(duckDbQueries, "insert_webpage_capture")
      .mockResolvedValue(undefined);
    jest.spyOn(devLog, "record_outcome").mockReturnValue(undefined);
  });

  it("stores a visit's metadata", async () => {
    await run_page_capture(db, inputs);

    expect(duckDbQueries.insert_webpage_capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        page_session_id: "page-2",
        url: "https://example.com/page2",
        title: "Page Two",
        content_type: "text/html",
        captured_at: expect.any(String),
      })
    );
  });

  it("records a stored outcome keyed by the explicit visit id", async () => {
    await run_page_capture(db, { ...inputs, visit_id: "visit-9" });

    expect(devLog.record_outcome).toHaveBeenCalledWith({
      visit_id: "visit-9",
      url: "https://example.com/page2",
      decision: "stored",
    });
  });

  it("falls back to the page session id as visit id when none is given", async () => {
    await run_page_capture(db, inputs);

    expect(devLog.record_outcome).toHaveBeenCalledWith({
      visit_id: "page-2",
      url: "https://example.com/page2",
      decision: "stored",
    });
  });

  it("stores every visit — there is no capture gate", async () => {
    await run_page_capture(db, { ...inputs, title: "" });

    expect(duckDbQueries.insert_webpage_capture).toHaveBeenCalledTimes(1);
  });

  it("propagates capture errors without recording an outcome", async () => {
    jest
      .spyOn(duckDbQueries, "insert_webpage_capture")
      .mockRejectedValue(new Error("disk full"));

    await expect(run_page_capture(db, inputs)).rejects.toThrow("disk full");
    expect(devLog.record_outcome).not.toHaveBeenCalled();
  });
});
