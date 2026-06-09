import * as crypto from "crypto";
import * as vscode from "vscode";

/**
 * `SecretStorage` key under which the metadata-store data-encryption key
 * lives. `SecretStorage` is backed by the OS keystore (Keychain on macOS,
 * libsecret on Linux, DPAPI on Windows), so the key is never written to a
 * plaintext file.
 */
export const METADATA_DB_KEY_SECRET = "bergamot.metadata_db_encryption_key";

/**
 * Returns the data-encryption key for the DuckDB metadata store, generating
 * and persisting a fresh one on first run.
 *
 * The key is 32 random bytes, hex-encoded — characters [0-9a-f] only, so it
 * embeds safely in the `ATTACH ... (ENCRYPTION_KEY '...')` statement that
 * opens the store.
 *
 * Losing the key (e.g. deleting it from the OS keystore) makes the store
 * unrecoverable: there is no plaintext fallback and no key escrow. That is
 * accepted data loss — the durable record can only be rebuilt by browsing
 * (see docs/threat-model.md).
 */
export async function get_or_create_metadata_db_key(
  secrets: vscode.SecretStorage
): Promise<string> {
  const existing = await secrets.get(METADATA_DB_KEY_SECRET);
  if (existing) {
    return existing;
  }
  const key = crypto.randomBytes(32).toString("hex");
  await secrets.store(METADATA_DB_KEY_SECRET, key);
  return key;
}
