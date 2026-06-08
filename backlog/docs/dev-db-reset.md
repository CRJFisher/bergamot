# Destructive dev-DB reset procedure

Bergamot has no DuckDB migration framework: tables are created with `CREATE TABLE IF NOT EXISTS` and there is no `schema_version` column or `ALTER` path. LanceDB only drops and recreates the `webpage_content` table on an embedding-dimension mismatch (`database_manager.ts` → `drop_table_if_vector_dim_mismatch`); adding or reshaping non-dimension fields does **not** trigger an auto-drop.

Because the project follows the no-backwards-compatibility constitution and all data so far is throwaway dev data, schema changes are applied by **wiping the stores and letting first run recreate them in the new shape** — never with `ALTER`/backfill/migration code.

## When to use

Run this after any change that alters a persisted schema:

- a DuckDB `CREATE TABLE` column add/remove/rename (e.g. `webpage_capture`, `webpage_analysis`, `webpage_tree_intentions`). `webpage_capture` holds **metadata only** (visit id, URL, page-load timestamp, title, navigation/session graph); no captured page content is stored at capture, so there is no `content_compressed`/`content_encoding`/`original_byte_size` column.
- a reshape of the LanceDB `webpage_content` record, even when the embedding dimension is unchanged (no auto-drop fires, so stale rows would otherwise drift against the new shape). This record is a **derived re-download cache** — vectors and any cached content built from re-downloading public URLs in post-processing, not a capture-time store.

## The stores

All persistent stores live under the resolved storage base (`get_storage_base`, `config/storage_path.ts`):

- **DuckDB file** — `<storage_base>/webpage_categorizations.db`
- **LanceDB directory** — `<storage_base>/webpage_memory.db/`
- **Visit inbox** — `<storage_base>/visit_inbox/`

During F5 debugging `BERGAMOT_STORAGE_PATH` points the storage base at the repo-local `.dev-storage/` (see `.vscode/launch.json`). An installed extension uses the per-extension `globalStorageUri` instead.

## The procedure (single step)

Stop the Extension Development Host (and any running MCP server), then delete the DuckDB file and the LanceDB directory:

```bash
# Dev (F5) — repo-local .dev-storage
rm -rf .dev-storage/webpage_categorizations.db .dev-storage/webpage_memory.db
```

Deleting the whole `.dev-storage/` directory is equivalent and also clears the visit inbox and dev log:

```bash
rm -rf .dev-storage
```

The next F5 run recreates the DuckDB file with the current `CREATE TABLE` definitions and recreates the LanceDB `webpage_content` table from scratch, so any reshaped fields take effect with no stale rows.

For an installed extension, delete the same two entries under the extension's `globalStorageUri` directory.

## Why not ALTER

Migrations and backfills are explicitly out of scope: they are backwards-compatibility shims for data we are willing to discard. Every schema-changing subtask references this procedure as its migration step and writes no `ALTER`/backfill code.
