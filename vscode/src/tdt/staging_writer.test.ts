import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  stage_note_stub,
  ensure_staging_gitignore,
  sweep_staged_stubs,
} from "./staging_writer";
import { compute_stub_filename } from "./note_stub";
import { make_cluster_detail } from "./__fixtures__/cluster_detail";

const CTX = { run_id: "r1", generated_at: "2026-06-22T08:03:11.000Z" };

describe("staging_writer", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bergamot-staging-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("ensure_staging_gitignore", () => {
    it("creates a self-ignoring .gitignore; idempotent", () => {
      ensure_staging_gitignore(root);
      const gitignore = path.join(root, ".gitignore");
      expect(fs.readFileSync(gitignore, "utf8")).toContain("*");
      const before = fs.readFileSync(gitignore, "utf8");
      ensure_staging_gitignore(root);
      expect(fs.readFileSync(gitignore, "utf8")).toBe(before);
    });
  });

  describe("stage_note_stub", () => {
    it("writes the stub, the ledger and the gitignore on first stage", () => {
      const out = stage_note_stub(root, make_cluster_detail(), CTX);
      expect(out.kind).toBe("written");
      expect(fs.existsSync(path.join(root, out.filename))).toBe(true);
      expect(fs.existsSync(path.join(root, ".bergamot-ledger.json"))).toBe(true);
      expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(true);
    });

    it("skips an unchanged re-run (fingerprint gate)", () => {
      stage_note_stub(root, make_cluster_detail(), CTX);
      const out = stage_note_stub(root, make_cluster_detail(), {
        ...CTX,
        run_id: "r2", // a new run, identical content
      });
      expect(out.kind).toBe("skipped_unchanged");
    });

    it("overwrites in place when content changed", () => {
      stage_note_stub(root, make_cluster_detail(), CTX);
      const out = stage_note_stub(root, make_cluster_detail({ size: 9 }), CTX);
      expect(out.kind).toBe("written");
      const file = fs.readFileSync(path.join(root, out.filename), "utf8");
      expect(file).toMatch(/9 pages cohered/);
    });

    it("never recreates a promoted/discarded stub (ledger has it, file gone)", () => {
      const first = stage_note_stub(root, make_cluster_detail(), CTX);
      fs.unlinkSync(path.join(root, first.filename)); // user promoted/moved it
      const out = stage_note_stub(root, make_cluster_detail({ size: 9 }), CTX);
      expect(out.kind).toBe("skipped_promoted");
      expect(fs.existsSync(path.join(root, first.filename))).toBe(false);
    });

    it("never clobbers a user-owned file absent from the ledger", () => {
      const filename = compute_stub_filename(make_cluster_detail());
      ensure_staging_gitignore(root);
      fs.writeFileSync(path.join(root, filename), "user content");
      const out = stage_note_stub(root, make_cluster_detail(), CTX);
      expect(out.kind).toBe("skipped_promoted");
      expect(fs.readFileSync(path.join(root, filename), "utf8")).toBe("user content");
    });

    it("tolerates a corrupt ledger (treated as empty)", () => {
      ensure_staging_gitignore(root);
      fs.writeFileSync(path.join(root, ".bergamot-ledger.json"), "{ not json");
      const out = stage_note_stub(root, make_cluster_detail(), CTX);
      expect(out.kind).toBe("written");
    });
  });

  describe("sweep_staged_stubs", () => {
    it("deletes a stub citing a forgotten URL and drops its ledger entry", () => {
      const out = stage_note_stub(root, make_cluster_detail(), CTX);
      const removed = sweep_staged_stubs(root, {
        kind: "url",
        url: "https://arxiv.org/abs/hdbscan",
      });
      expect(removed).toBe(1);
      expect(fs.existsSync(path.join(root, out.filename))).toBe(false);
      const ledger = JSON.parse(
        fs.readFileSync(path.join(root, ".bergamot-ledger.json"), "utf8"),
      );
      expect(Object.keys(ledger.entries)).toHaveLength(0);
    });

    it("deletes a stub citing any URL on a forgotten origin", () => {
      stage_note_stub(root, make_cluster_detail(), CTX);
      const removed = sweep_staged_stubs(root, {
        kind: "origin",
        origin: "https://github.com",
      });
      expect(removed).toBe(1);
    });

    it("leaves stubs citing nothing matched", () => {
      const out = stage_note_stub(root, make_cluster_detail(), CTX);
      const removed = sweep_staged_stubs(root, {
        kind: "url",
        url: "https://unrelated.example/x",
      });
      expect(removed).toBe(0);
      expect(fs.existsSync(path.join(root, out.filename))).toBe(true);
    });

    it("time_range deletes a stub whose window overlaps the forget range", () => {
      stage_note_stub(root, make_cluster_detail(), CTX);
      const removed = sweep_staged_stubs(root, {
        kind: "time_range",
        from: "2026-06-20T00:00:00.000Z",
        to: "2026-06-25T00:00:00.000Z",
      });
      expect(removed).toBe(1);
    });

    it("time_range leaves a non-overlapping stub", () => {
      stage_note_stub(root, make_cluster_detail(), CTX);
      const removed = sweep_staged_stubs(root, {
        kind: "time_range",
        from: "2027-01-01T00:00:00.000Z",
        to: "2027-02-01T00:00:00.000Z",
      });
      expect(removed).toBe(0);
    });

    it("is idempotent and never throws on an empty/absent dir", () => {
      expect(sweep_staged_stubs(path.join(root, "nope"), { kind: "url", url: "x" })).toBe(0);
      stage_note_stub(root, make_cluster_detail(), CTX);
      sweep_staged_stubs(root, { kind: "url", url: "https://arxiv.org/abs/hdbscan" });
      expect(sweep_staged_stubs(root, { kind: "url", url: "https://arxiv.org/abs/hdbscan" })).toBe(0);
    });
  });
});
