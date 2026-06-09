import { createHash } from "crypto";

/**
 * SHA-256 hex digest of the re-downloaded page. Recorded as fidelity metadata so
 * that content drift (the same URL returning different content on a later fetch)
 * is visible. Hex, not base64, so digests are grep-able and compare by equality.
 */
export function sha256_hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
