import { createHash } from "crypto";

// Output feeds persisted identity keys (tree_id, fetch_id); the algorithm and
// hex encoding are fixed so ids stay stable across runs. Changing either orphans
// every existing id.
export function md5_hash(input: string): string {
  const hash = createHash("md5");
  hash.update(input);
  return hash.digest("hex");
}
