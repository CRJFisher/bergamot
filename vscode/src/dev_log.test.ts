import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  format_error_detail,
  record_outcome,
  get_recent_outcomes,
  purge_outcomes,
  is_browser_dev_stage,
  is_dev_log_enabled,
  init_dev_log,
  dev_log,
} from "./dev_log";

describe("format_error_detail", () => {
  it("includes the stack trace for an Error", () => {
    const error = new Error("boom");
    const detail = format_error_detail(error);
    expect(detail).toContain("boom");
    expect(detail).toContain("at ");
    expect(detail).toBe(error.stack);
  });

  it("falls back to name + message when stack is absent", () => {
    const error = new Error("no stack");
    error.stack = undefined;
    expect(format_error_detail(error)).toBe("Error: no stack");
  });

  it("unwinds a nested cause chain", () => {
    const root = new Error("fk constraint violation");
    const wrapper = new Error("workflow failed", { cause: root });
    const detail = format_error_detail(wrapper);
    expect(detail).toContain("workflow failed");
    expect(detail).toContain("Caused by:");
    expect(detail).toContain("fk constraint violation");
  });

  it("handles a non-Error cause", () => {
    const wrapper = new Error("outer", { cause: "raw string cause" });
    expect(format_error_detail(wrapper)).toContain("Caused by: raw string cause");
  });

  it("stringifies non-Error throws", () => {
    expect(format_error_detail("just a string")).toBe("just a string");
    expect(format_error_detail(42)).toBe("42");
  });
});

describe("is_browser_dev_stage", () => {
  it("accepts the browser-relayed stages", () => {
    expect(is_browser_dev_stage("capture_attempted")).toBe(true);
    expect(is_browser_dev_stage("capture_failed")).toBe(true);
  });

  it("rejects server-only and unknown stages", () => {
    expect(is_browser_dev_stage("stored")).toBe(false);
    expect(is_browser_dev_stage("http_received")).toBe(false);
    expect(is_browser_dev_stage("")).toBe(false);
    expect(is_browser_dev_stage("not_a_stage")).toBe(false);
  });
});

describe("outcome ring buffer", () => {
  beforeEach(() => {
    purge_outcomes(() => true);
  });

  it("returns the most recently recorded outcome first", () => {
    record_outcome({ visit_id: "1", url: "https://a.com", decision: "stored" });
    record_outcome({ visit_id: "2", url: "https://b.com", decision: "failed" });

    expect(get_recent_outcomes().map((o) => o.visit_id)).toEqual(["2", "1"]);
  });

  it("stamps each outcome with an ISO timestamp", () => {
    record_outcome({ visit_id: "1", url: "https://a.com", decision: "stored" });

    const [outcome] = get_recent_outcomes();
    expect(outcome.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(Number.isNaN(Date.parse(outcome.at))).toBe(false);
  });

  it("preserves reason and error fields", () => {
    record_outcome({
      visit_id: "1",
      url: "https://a.com",
      decision: "orphan_dropped",
      reason: "expired",
      error: "boom",
    });

    const [outcome] = get_recent_outcomes();
    expect(outcome.reason).toBe("expired");
    expect(outcome.error).toBe("boom");
  });

  it("evicts the oldest entries beyond the cap, keeping the newest 100", () => {
    for (let i = 0; i < 150; i++) {
      record_outcome({ visit_id: String(i), url: `https://x.com/${i}`, decision: "stored" });
    }

    const outcomes = get_recent_outcomes();
    expect(outcomes).toHaveLength(100);
    expect(outcomes[0].visit_id).toBe("149");
    expect(outcomes[99].visit_id).toBe("50");
  });

  it("returns a copy so callers cannot mutate the ring", () => {
    record_outcome({ visit_id: "1", url: "https://a.com", decision: "stored" });

    const snapshot = get_recent_outcomes();
    snapshot.pop();

    expect(get_recent_outcomes()).toHaveLength(1);
  });
});

describe("purge_outcomes", () => {
  beforeEach(() => {
    purge_outcomes(() => true);
  });

  it("removes only the entries whose URL matches the selector", () => {
    record_outcome({ visit_id: "1", url: "https://secret.com/a", decision: "stored" });
    record_outcome({ visit_id: "2", url: "https://kept.com/b", decision: "stored" });
    record_outcome({ visit_id: "3", url: "https://secret.com/c", decision: "failed" });

    purge_outcomes((url) => url.startsWith("https://secret.com"));

    expect(get_recent_outcomes().map((o) => o.url)).toEqual(["https://kept.com/b"]);
  });

  it("removes every entry when the selector matches all", () => {
    record_outcome({ visit_id: "1", url: "https://a.com", decision: "stored" });
    record_outcome({ visit_id: "2", url: "https://b.com", decision: "stored" });

    purge_outcomes(() => true);

    expect(get_recent_outcomes()).toEqual([]);
  });

  it("leaves the ring untouched when nothing matches", () => {
    record_outcome({ visit_id: "1", url: "https://a.com", decision: "stored" });
    record_outcome({ visit_id: "2", url: "https://b.com", decision: "stored" });

    purge_outcomes(() => false);

    expect(get_recent_outcomes().map((o) => o.visit_id)).toEqual(["2", "1"]);
  });

  it("removes adjacent matching entries without skipping any", () => {
    record_outcome({ visit_id: "1", url: "https://drop.com/a", decision: "stored" });
    record_outcome({ visit_id: "2", url: "https://drop.com/b", decision: "stored" });
    record_outcome({ visit_id: "3", url: "https://drop.com/c", decision: "stored" });
    record_outcome({ visit_id: "4", url: "https://keep.com/d", decision: "stored" });

    purge_outcomes((url) => url.startsWith("https://drop.com"));

    expect(get_recent_outcomes().map((o) => o.url)).toEqual(["https://keep.com/d"]);
  });
});

describe("dev_log enable gating", () => {
  let storage_base: string;

  beforeEach(() => {
    storage_base = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-devlog-"));
  });

  afterEach(() => {
    init_dev_log(storage_base, false);
    fs.rmSync(storage_base, { recursive: true, force: true });
  });

  it("reports the enabled flag passed at init", () => {
    init_dev_log(storage_base, false);
    expect(is_dev_log_enabled()).toBe(false);

    init_dev_log(storage_base, true);
    expect(is_dev_log_enabled()).toBe(true);
  });

  it("writes no JSONL entries while disabled", () => {
    init_dev_log(storage_base, false);

    dev_log("http_received", { visit_id: "1", url: "https://a.com" });

    expect(fs.existsSync(path.join(storage_base, "dev-log.jsonl"))).toBe(false);
  });

  it("appends a JSONL entry containing the stage and fields while enabled", async () => {
    init_dev_log(storage_base, true);

    dev_log("http_received", { visit_id: "1", url: "https://a.com" });

    const log_path = path.join(storage_base, "dev-log.jsonl");
    let contents = "";
    for (let attempt = 0; attempt < 50 && !contents; attempt++) {
      await new Promise((resolve) => setImmediate(resolve));
      contents = fs.existsSync(log_path) ? fs.readFileSync(log_path, "utf8") : "";
    }

    const entry = JSON.parse(contents.trim());
    expect(entry.stage).toBe("http_received");
    expect(entry.visit_id).toBe("1");
    expect(entry.url).toBe("https://a.com");
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });
});
