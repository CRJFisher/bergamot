import * as vscode from "vscode";
import {
  get_or_create_metadata_db_key,
  METADATA_DB_KEY_SECRET,
} from "./encryption_key";

/** In-memory SecretStorage fake: a Map behind the get/store/delete surface. */
function fake_secret_storage(): vscode.SecretStorage {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key),
    store: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    onDidChange: jest.fn(),
  } as vscode.SecretStorage;
}

describe("get_or_create_metadata_db_key", () => {
  it("generates a 32-byte hex key on first run and persists it", async () => {
    const secrets = fake_secret_storage();

    const key = await get_or_create_metadata_db_key(secrets);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await secrets.get(METADATA_DB_KEY_SECRET)).toBe(key);
  });

  it("returns the stored key on subsequent runs", async () => {
    const secrets = fake_secret_storage();

    const first = await get_or_create_metadata_db_key(secrets);
    const second = await get_or_create_metadata_db_key(secrets);

    expect(second).toBe(first);
  });

  it("generates distinct keys for distinct stores", async () => {
    const a = await get_or_create_metadata_db_key(fake_secret_storage());
    const b = await get_or_create_metadata_db_key(fake_secret_storage());

    expect(a).not.toBe(b);
  });
});
