import { md5_hash } from "./hash_utils";

// Pins the exact persisted identity-key encoding against well-known MD5 vectors.
// A silent change here would orphan every existing tree_id and fetch_id.
describe("md5_hash", () => {
  it("hashes the empty string to the known MD5 vector", () => {
    expect(md5_hash("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("hashes \"abc\" to the known MD5 vector", () => {
    expect(md5_hash("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("returns a stable lowercase 32-char hex digest", () => {
    const digest = md5_hash("https://example.com:1700000000000");
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    expect(digest).toBe(md5_hash("https://example.com:1700000000000"));
  });
});
