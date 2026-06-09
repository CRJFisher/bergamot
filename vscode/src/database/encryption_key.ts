import * as crypto from "crypto";
import * as vscode from "vscode";

/**
 * `SecretStorage` key under which the metadata-store data-encryption key
 * lives. `SecretStorage` persists the value encrypted under a wrapping key
 * held in the OS keystore (Keychain on macOS, libsecret on Linux, DPAPI on
 * Windows), so the data-encryption key is never on disk in plaintext.
 */
export const METADATA_DB_KEY_SECRET = "bergamot.metadata_db_encryption_key";

/**
 * `SecretStorage` key for the re-download content cache's data-encryption
 * key. The cache uses its own key, separate from the metadata store's, so
 * destroying the cache key destroys only the cache (which can always be
 * rebuilt by re-downloading) and never the durable metadata record.
 */
export const CONTENT_CACHE_KEY_SECRET =
  "bergamot.content_cache_encryption_key";

/**
 * Returns the data-encryption key for an encrypted store, generating and
 * persisting a fresh one on first run.
 *
 * The key is 32 random bytes, hex-encoded — the format the `DuckDB` wrapper
 * requires, and characters [0-9a-f] only, so it embeds safely in the
 * `ATTACH ... (ENCRYPTION_KEY '...')` statement that opens the store.
 *
 * A fresh key is generated only when no store file exists yet. If a store
 * file exists but `SecretStorage` returns no key, this throws rather than
 * minting a new one: an empty read can mean a transient keystore failure
 * (locked keychain, missing Linux keyring), and silently re-keying would
 * overwrite the only copy of the real key — turning a recoverable hiccup
 * into permanent loss of the store.
 *
 * Genuinely losing a key (e.g. deleting it from the OS keystore) makes its
 * store unrecoverable: there is no plaintext fallback and no key escrow.
 * That is accepted data loss — the metadata record can only be rebuilt by
 * browsing, the content cache by re-downloading (see docs/threat-model.md).
 */
export async function get_or_create_store_key(
  secrets: vscode.SecretStorage,
  secret_name: string,
  store_file_exists: boolean
): Promise<string> {
  const existing = await secrets.get(secret_name);
  if (existing) {
    return existing;
  }
  if (store_file_exists) {
    throw new Error(
      `An encrypted store exists but its key is missing from SecretStorage ` +
        `(${secret_name}). If the OS keystore is locked or unavailable, ` +
        `unlock it and reload; if the key was deleted, the store is ` +
        `unrecoverable — delete the store file to start fresh.`
    );
  }
  const key = crypto.randomBytes(32).toString("hex");
  await secrets.store(secret_name, key);
  // A store() that silently fails to persist would create a database whose
  // key dies with this session; verify before using the key.
  const persisted = await secrets.get(secret_name);
  if (persisted !== key) {
    throw new Error(
      `SecretStorage did not persist the encryption key (${secret_name}); ` +
        `refusing to create a store whose key would be lost on reload`
    );
  }
  return key;
}
