import { createHash } from "crypto";

export function md5_hash(input: string): string {
  const hash = createHash("md5");
  hash.update(input);
  return hash.digest("hex");
}
