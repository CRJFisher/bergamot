import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  persist_replay_visit,
  list_replay_visits,
  load_replay_visit,
} from "./visit_replay";
import { ExtendedPageVisit } from "./visit_queue_processor";

const make_visit = (visit_id: string, url: string): ExtendedPageVisit => ({
  id: visit_id,
  url,
  referrer: "",
  page_loaded_at: "2026-06-02T00:00:00.000Z",
  visit_id,
  title: "<html></html>",
});

const captures_dir = (base: string): string => path.join(base, "captures");

describe("visit_replay", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-replay-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when no captures directory exists", () => {
    expect(list_replay_visits(dir)).toEqual([]);
  });

  it("persists a visit and lists it as a summary", () => {
    persist_replay_visit(dir, make_visit("v1", "https://a.com"));

    const summaries = list_replay_visits(dir);
    expect(summaries).toEqual([
      {
        visit_id: "v1",
        url: "https://a.com",
        page_loaded_at: "2026-06-02T00:00:00.000Z",
      },
    ]);
  });

  it("lists visits most recent first by mtime", () => {
    persist_replay_visit(dir, make_visit("older", "https://older.com"));
    persist_replay_visit(dir, make_visit("newer", "https://newer.com"));

    const older_file = path.join(captures_dir(dir), "older.json");
    const newer_file = path.join(captures_dir(dir), "newer.json");
    fs.utimesSync(older_file, new Date(1000), new Date(1000));
    fs.utimesSync(newer_file, new Date(2000), new Date(2000));

    expect(list_replay_visits(dir).map((s) => s.visit_id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("prunes to the most recent MAX_REPLAY_VISITS by mtime", () => {
    for (let i = 0; i < 25; i++) {
      persist_replay_visit(dir, make_visit(`v${i}`, `https://${i}.com`));
      const file = path.join(captures_dir(dir), `v${i}.json`);
      fs.utimesSync(file, new Date(1000 + i), new Date(1000 + i));
    }

    const remaining = list_replay_visits(dir);
    expect(remaining).toHaveLength(20);
    expect(remaining[0].visit_id).toBe("v24");
    expect(remaining.map((s) => s.visit_id)).not.toContain("v4");
    expect(fs.existsSync(path.join(captures_dir(dir), "v0.json"))).toBe(false);
  });

  it("loads a specific persisted visit by id", () => {
    persist_replay_visit(dir, make_visit("a", "https://a.com"));
    persist_replay_visit(dir, make_visit("b", "https://b.com"));

    const loaded = load_replay_visit(dir, "b");
    expect(loaded?.visit_id).toBe("b");
    expect(loaded?.url).toBe("https://b.com");
    expect(loaded?.title).toBe("<html></html>");
  });

  it("returns null when loading a visit that was never persisted", () => {
    expect(load_replay_visit(dir, "missing")).toBeNull();
  });

  it("drops an entry missing required fields from the list", () => {
    persist_replay_visit(dir, make_visit("good", "https://good.com"));
    const incomplete = path.join(captures_dir(dir), "incomplete.json");
    fs.writeFileSync(
      incomplete,
      JSON.stringify({
        id: "incomplete",
        url: "https://incomplete.com",
        referrer: "",
        page_loaded_at: "2026-06-02T00:00:00.000Z",
      })
    );

    expect(list_replay_visits(dir).map((s) => s.visit_id)).toEqual(["good"]);
  });

  it("returns null when loading an entry missing required fields", () => {
    const dir_captures = captures_dir(dir);
    fs.mkdirSync(dir_captures, { recursive: true });
    fs.writeFileSync(
      path.join(dir_captures, "incomplete.json"),
      JSON.stringify({
        id: "incomplete",
        url: "https://incomplete.com",
        page_loaded_at: "2026-06-02T00:00:00.000Z",
      })
    );

    expect(load_replay_visit(dir, "incomplete")).toBeNull();
  });

  it("sanitizes a browser-supplied visit id when keying the replay file", () => {
    persist_replay_visit(dir, make_visit("../../etc/passwd", "https://x.com"));

    const files = fs.readdirSync(captures_dir(dir));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("/");
    expect(load_replay_visit(dir, "../../etc/passwd")?.url).toBe(
      "https://x.com"
    );
  });
});
