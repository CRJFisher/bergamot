# Querying the Bergamot tracking record

Bergamot records every web-page visit and stitches visits into cross-page
navigation sessions. Other processes can read that record three ways: **MCP
tools** (for agents), the **HTTP query API** (for scripts), and **direct DuckDB
access** (when the extension is not running).

## Where the data lives

The VS Code extension owns the data under its global storage directory:

- **DuckDB** — `webpage_categorizations.db`: the canonical relational metadata record and the durable source of truth (visit id, URL, page-load timestamp, title, navigation/session graph). No page content is captured here.
- **LanceDB** — `webpage_memory.db/`: page text + embeddings for semantic search, **derived** from re-downloading public URLs during post-processing — a cache, not a source of truth.

DuckDB is single-writer: while the extension is running it holds the connection,
so other processes query through the HTTP API / MCP rather than opening the file.

## DuckDB schema

```
webpage_trees                 -- one row per navigation session (a "tree")
  id                  TEXT PK  -- hash of the root page session id + load time
  first_load_time     TEXT     -- ISO timestamp of the first page load
  latest_activity_time TEXT    -- ISO timestamp of the most recent activity

webpage_activity_sessions     -- one row per page visit
  id                       TEXT PK   -- hash of url + page_loaded_at
  url                      TEXT
  referrer                 TEXT
  referrer_page_session_id TEXT      -- the visit this one came from
  page_loaded_at           TEXT      -- ISO timestamp
  tree_id                  TEXT FK -> webpage_trees(id)

webpage_analysis              -- LLM analysis per visit
  page_session_id  TEXT PK FK -> webpage_activity_sessions(id)
  title            TEXT
  summary          TEXT
  intentions       TEXT        -- JSON array

webpage_tree_intentions       -- derived intentions per (tree, visit)
  tree_id             TEXT FK -> webpage_trees(id)
  activity_session_id TEXT FK -> webpage_activity_sessions(id)
  intentions          TEXT     -- JSON array
  PRIMARY KEY (tree_id, activity_session_id)
```

Re-downloaded page **content** and **embeddings** live in LanceDB (`webpage_content`), keyed by
`page_session_id`, alongside a duplicate of `url`/`title`. This content is obtained by
re-downloading the public URL in post-processing — pages behind a login wall fail to re-download
and are excluded, so they appear in the DuckDB metadata record but not here.

## MCP tools

The extension spawns an MCP server (`mcp_server_standalone.js`, stdio). Tools:

| Tool                                   | Returns                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `semantic_search(query, limit?)`       | vector search over page content                        |
| `get_webpage_content(page_session_id)` | full stored content for one visit                      |
| `get_visit_by_url(url)`                | latest visit for an exact URL (url, title, visited_at) |
| `search_by_title(title)`               | a page's content by title                              |
| `get_navigation_tree(tree_id)`         | all visits in a navigation session                     |
| `list_recent_navigation_trees(limit?)` | recent sessions + members + analysis                   |

The relational tools proxy to the HTTP API below (the extension owns DuckDB).

## HTTP query API

The extension runs a localhost server on the first free port in **5000–5009**
and writes the chosen port to `~/.bergamot/port.json` (`{ "port": N }`). CORS is
restricted to the extension origin, but origin-less callers (curl, scripts) are
allowed. Endpoints:

- `GET /status` → `{ "service": "bergamot", ... }`
- `GET /query/visit_by_url?url=<url>`
- `GET /query/page_by_title?title=<title>`
- `GET /query/tree?tree_id=<id>`
- `GET /query/recent_trees?limit=<n>`

Dependency-free example (only `curl` + `jq`):

```bash
PORT=$(jq -r .port ~/.bergamot/port.json)
curl -s "http://localhost:$PORT/status"
curl -s "http://localhost:$PORT/query/recent_trees?limit=3" | jq .
curl -s "http://localhost:$PORT/query/visit_by_url?url=https://example.com" | jq .
```

## Direct DuckDB access (extension not running)

When VS Code is closed, any DuckDB client can open the file read-only:

```python
import duckdb, pathlib
db = pathlib.Path.home() / ".config/Code/User/globalStorage/bergamot.bergamot/webpage_categorizations.db"
con = duckdb.connect(str(db), read_only=True)
print(con.sql("SELECT url, page_loaded_at FROM webpage_activity_sessions ORDER BY page_loaded_at DESC LIMIT 10"))
```

(The exact globalStorage path varies by OS/VS Code build; check the extension's
configured storage directory.)
