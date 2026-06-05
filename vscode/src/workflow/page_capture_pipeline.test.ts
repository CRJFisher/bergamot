import { run_page_capture, CaptureDeps } from "./page_capture_pipeline";
import { DuckDB } from "../duck_db";
import * as pageGate from "./page_gate";
import * as duckDbQueries from "../duck_db";
import * as gateMetrics from "./gate_metrics";
import { PageActivitySessionWithoutContent } from "../duck_db_models";

// duck_db is auto-mocked, so insert_webpage_capture is a jest.fn(); store_capture
// itself runs for real (real zstd compress + metadata parse over the mocked
// insert). The pipeline makes no LLM calls and touches no vector store.
jest.mock("../duck_db");

describe("run_page_capture (zero-LLM capture pipeline)", () => {
  const deps: CaptureDeps = { duck_db: {} as DuckDB };

  const article_html = `<html><head><title>T</title></head><body><article><p>${"Real standalone content. ".repeat(
    20
  )}</p></article></body></html>`;

  const inputs = {
    new_page: {
      id: "page-2",
      url: "https://example.com/page2",
      tree_id: "tree-123",
      page_loaded_at: "2024-01-01T12:00:00Z",
    } as PageActivitySessionWithoutContent,
    raw_content: article_html,
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest.spyOn(duckDbQueries, "insert_webpage_capture").mockResolvedValue(undefined);
    jest.spyOn(gateMetrics, "record_gate_decision").mockImplementation(() => {});
  });

  it("captures a kept page (no LLM, no vector store)", async () => {
    await run_page_capture(deps, inputs);

    expect(gateMetrics.record_gate_decision).toHaveBeenCalledWith(true, undefined);
    expect(duckDbQueries.insert_webpage_capture).toHaveBeenCalled();
  });

  it("drops a page the gate rejects, before capture", async () => {
    jest
      .spyOn(pageGate, "evaluate_page_gate")
      .mockReturnValue({ keep: false, reason: "auth" });

    await run_page_capture(deps, inputs);

    expect(gateMetrics.record_gate_decision).toHaveBeenCalledWith(false, "auth");
    expect(duckDbQueries.insert_webpage_capture).not.toHaveBeenCalled();
  });

  it("drops an empty page as content_empty", async () => {
    await run_page_capture(deps, { ...inputs, raw_content: "   \n  " });

    expect(gateMetrics.record_gate_decision).toHaveBeenCalledWith(
      false,
      "content_empty"
    );
    expect(duckDbQueries.insert_webpage_capture).not.toHaveBeenCalled();
  });

  it("propagates capture errors", async () => {
    jest
      .spyOn(duckDbQueries, "insert_webpage_capture")
      .mockRejectedValue(new Error("disk full"));
    await expect(run_page_capture(deps, inputs)).rejects.toThrow("disk full");
  });
});
