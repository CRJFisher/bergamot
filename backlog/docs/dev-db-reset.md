# Destructive dev-DB reset procedure

Bergamot has no DuckDB migration framework: tables are created with `CREATE TABLE IF NOT EXISTS` and there is no `schema_version` column or `ALTER` path. Because the project follows the no-backwards-compatibility constitution and all data so far is throwaway dev data, schema changes are applied by **wiping the stores and letting first run recreate them in the new shape** — never with `ALTER`/backfill/migration code.

## When to use

Run this after any change that alters a persisted schema — a DuckDB `CREATE TABLE` column add/remove/rename (e.g. `webpage_capture`, `webpage_activity_sessions`, `webpage_fetch`). `webpage_capture` holds **metadata only** (visit id, URL, page-load timestamp, title, navigation/session graph); no page content is stored at capture.

## The stores

All persistent stores live under the resolved storage base (`get_storage_base`, `config/storage_path.ts`):

- **DuckDB file** — `<storage_base>/webpage_categorizations.db`, encrypted at rest with DuckDB native encryption
- **Visit inbox** — `<storage_base>/visit_inbox/`

During F5 debugging `BERGAMOT_STORAGE_PATH` points the storage base at the repo-local `.dev-storage/` (see `.vscode/launch.json`). An installed extension uses the per-extension `globalStorageUri` instead.

### The encryption key is not part of a reset

The DuckDB file is encrypted with a key held in the OS keystore via VS Code `SecretStorage` (`bergamot.metadata_db_encryption_key`, see `database/encryption_key.ts`). Deleting the database file does **not** require touching the key: the next run reads the keystore entry and creates a fresh encrypted store with the same key. Deleting the key as well is harmless once the file is gone (a new key is generated on first run) — but deleting the key while keeping the file makes the file permanently unreadable, by design (no plaintext fallback; see `docs/threat-model.md`).

## The procedure (single step)

Stop the Extension Development Host (and any running MCP server), then delete the DuckDB file:

```bash
# Dev (F5) — repo-local .dev-storage
rm -rf .dev-storage/webpage_categorizations.db
```

Deleting the whole `.dev-storage/` directory is equivalent and also clears the visit inbox and dev log:

```bash
rm -rf .dev-storage
```

The next F5 run recreates the DuckDB file — encrypted — with the current `CREATE TABLE` definitions.

For an installed extension, delete the same entry under the extension's `globalStorageUri` directory.

## Why not ALTER

Migrations and backfills are explicitly out of scope: they are backwards-compatibility shims for data we are willing to discard. Every schema-changing subtask references this procedure as its migration step and writes no `ALTER`/backfill code.
