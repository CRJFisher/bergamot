import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ensure_inbox, persist_visit, remove_visit, load_inbox } from "./visit_inbox";
import { ExtendedPageVisit } from "./visit_queue_processor";

const make_visit = (id: string, url: string): ExtendedPageVisit =>
  ({
    id,
    url,
    referrer: "",
    page_loaded_at: "2026-06-02T00:00:00.000Z",
    raw_content: "<html></html>",
  } as ExtendedPageVisit);

describe("visit_inbox", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-inbox-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("persists and reloads visits across a simulated restart", () => {
    ensure_inbox(dir);
    persist_visit(dir, make_visit("a", "https://a.com"));
    persist_visit(dir, make_visit("b", "https://b.com"));

    const reloaded = load_inbox(dir).sort((x, y) => x.id.localeCompare(y.id));
    expect(reloaded.map((v) => v.id)).toEqual(["a", "b"]);
    expect(reloaded[0].url).toBe("https://a.com");
    expect(reloaded[0].raw_content).toBe("<html></html>");
  });

  it("removes a processed visit so it is not reloaded", () => {
    ensure_inbox(dir);
    persist_visit(dir, make_visit("a", "https://a.com"));
    persist_visit(dir, make_visit("b", "https://b.com"));

    remove_visit(dir, "a");

    expect(load_inbox(dir).map((v) => v.id)).toEqual(["b"]);
  });

  it("returns an empty list for a missing inbox and tolerates double-remove", () => {
    expect(load_inbox(path.join(dir, "missing"))).toEqual([]);
    expect(() => remove_visit(dir, "never-existed")).not.toThrow();
  });
});
