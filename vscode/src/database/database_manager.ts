import * as path from 'path';
import { DuckDB, create_metadata_schema } from '../duck_db';

export const METADATA_DB_FILENAME = 'webpage_categorizations.db';

export interface DatabaseInstances {
  duck_db: DuckDB;
}

export class DatabaseManager {
  private databases?: DatabaseInstances;

  /**
   * Opens the DuckDB relational metadata store, encrypted at rest with DuckDB
   * native encryption, and applies the schema.
   *
   * @param encryption_key - Data-encryption key for the store, sourced from the
   *   OS keystore via VS Code `SecretStorage` (see `database/encryption_key.ts`).
   *   Key loss makes the store unrecoverable; there is no plaintext fallback.
   * @throws {Error} If the store cannot be opened or the schema cannot be applied.
   */
  async initialize_all(
    storage_path: string,
    encryption_key: string
  ): Promise<DatabaseInstances> {
    const duck_db = new DuckDB({
      database_path: path.join(storage_path, METADATA_DB_FILENAME),
      encryption_key,
    });
    await duck_db.init();
    await create_metadata_schema(duck_db);

    this.databases = { duck_db };
    return this.databases;
  }

  async close_all(): Promise<void> {
    if (this.databases?.duck_db) {
      await this.databases.duck_db.close();
    }
  }
}
