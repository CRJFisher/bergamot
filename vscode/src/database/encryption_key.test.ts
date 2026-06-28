import * as vscode from "vscode";
import {
  CONTENT_CACHE_KEY_SECRET,
  get_or_create_store_key,
  METADATA_DB_KEY_SECRET,
} from "./encryption_key";

/** In-memory SecretStorage fake: a Map behind the get/store/delete surface. */
function fake_secret_storage(): vscode.SecretStorage {
  const store = new Map<string, string>();
  const on_did_change: vscode.Event<vscode.SecretStorageChangeEvent> = () => ({
    dispose: () => undefined,
  });
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    onDidChange: on_did_change,
  };
}

describe("get_or_create_store_key", () => {
  it("generates a 32-byte hex key on first run and persists it", async () => {
    const secrets = fake_secret_storage();

    const key = await get_or_create_store_key(secrets, METADATA_DB_KEY_SECRET, false);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await secrets.get(METADATA_DB_KEY_SECRET)).toBe(key);
  });

  it("returns the stored key on subsequent runs", async () => {
    const secrets = fake_secret_storage();

    const first = await get_or_create_store_key(secrets, METADATA_DB_KEY_SECRET, false);
    const second = await get_or_create_store_key(secrets, METADATA_DB_KEY_SECRET, true);

    expect(second).toBe(first);
  });

  it("holds independent keys for the two stores in one SecretStorage", async () => {
    const secrets = fake_secret_storage();

    const metadata_key = await get_or_create_store_key(
      secrets,
      METADATA_DB_KEY_SECRET,
      false
    );
    const cache_key = await get_or_create_store_key(
      secrets,
      CONTENT_CACHE_KEY_SECRET,
      false
    );

    expect(metadata_key).not.toBe(cache_key);
    expect(await secrets.get(METADATA_DB_KEY_SECRET)).toBe(metadata_key);
    expect(await secrets.get(CONTENT_CACHE_KEY_SECRET)).toBe(cache_key);
  });

  it("refuses to mint a new key when a store file already exists", async () => {
    // An empty SecretStorage read for an existing store can be a transient
    // keystore failure; silently re-keying would brick the store forever.
    const secrets = fake_secret_storage();

    await expect(
      get_or_create_store_key(secrets, METADATA_DB_KEY_SECRET, true)
    ).rejects.toThrow(/key is missing/);
    // Crucially, nothing was written: the real key (if recoverable) survives.
    expect(await secrets.get(METADATA_DB_KEY_SECRET)).toBeUndefined();
  });

  it("fails loudly when SecretStorage does not persist the new key", async () => {
    const secrets = fake_secret_storage();
    const broken: vscode.SecretStorage = {
      ...secrets,
      store: async () => {
        // Persistence silently no-ops (e.g. keystore write failure).
      },
    };

    await expect(
      get_or_create_store_key(broken, METADATA_DB_KEY_SECRET, false)
    ).rejects.toThrow(/did not persist/);
  });

  it("fails loudly when SecretStorage reads back a different key than written", async () => {
    const secrets = fake_secret_storage();
    let written = false;
    const corrupting: vscode.SecretStorage = {
      ...secrets,
      get: async (key: string) =>
        written ? "deadbeef".repeat(8) : secrets.get(key),
      store: async (key: string, value: string) => {
        written = true;
        return secrets.store(key, value);
      },
    };

    await expect(
      get_or_create_store_key(corrupting, METADATA_DB_KEY_SECRET, false)
    ).rejects.toThrow(/did not persist/);
  });
});
