# Work Priority

## Current Status

Bergamot is mid **privacy-core reorientation**: capture is metadata-only, content is re-downloaded from public URLs in post-processing, and the login wall is the privacy filter. Canonical references: [docs/constitution.md](../docs/constitution.md), [CLAUDE.md](../CLAUDE.md), [docs/decisions/privacy-core-reorientation.md](../docs/decisions/privacy-core-reorientation.md), and the migration plan [backlog/drafts/privacy-reorientation-plan.md](drafts/privacy-reorientation-plan.md).

Documentation is reoriented. Remaining work, in order:

1. **Capture code + DuckDB schema reset** (metadata-only): stop `outerHTML`/zstd in the browser, stop decompress+store in the server, drop the `content_compressed` BLOB, rewrite the affected tests/fixtures — destructive, no shims.
2. **Re-download / post-processing content fetcher** — the keystone, upstream of TDT, RAG, and image extraction; must land with or before the stored-content read path is removed.
3. **Task backlog** rescope to the new model (task-39 → re-download mechanism; task-36/36.3, task-31.\*, task-32), plus the metadata-store and content-cache encryption tasks.
4. **Hero loop**: Temporal Topic Detection ([task-36](tasks)) over the re-downloaded public corpus.
