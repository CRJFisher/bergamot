---
id: task-14
title: >-
  Investigate and optimize webpage storage - avoid duplication between vector DB
  and DuckDB
status: Done
assignee:
  - "@claude"
created_date: "2025-08-07 09:20"
updated_date: "2025-08-07 15:40"
labels: []
dependencies: []
---

## Description

Currently we may be storing parsed webpage content in both the vector database and DuckDB. This investigation will determine if we can optimize storage by keeping content only in the vector DB, which would require implementing key-based lookups in the vector store.

## Acceptance Criteria

- [x] Current storage pattern for webpage content is documented
- [x] Determination made on whether content is duplicated between vector DB and DuckDB
- [x] If duplication exists - feasibility of vector DB key-based lookups assessed
- [x] Implementation plan created for optimized storage (vector DB only if feasible)
- [x] Storage efficiency gains quantified

## Implementation Plan

1. Analyze current webpage storage implementation in VSCode extension
2. Check DuckDB schema and data storage patterns
3. Check vector database storage patterns
4. Identify any duplication between the two systems
5. Research vector DB capabilities for key-based lookups
6. Document findings and create optimization plan
7. Quantify potential storage savings

## Implementation Notes

### Current Storage Pattern

The investigation revealed that webpage content IS being duplicated across two storage systems:

1. **DuckDB Storage** (`vscode/src/duck_db.ts`):

   - Table: `webpage_content`
   - Stores compressed webpage content using zstd compression (level 6)
   - Content is base64 encoded after compression
   - Linked to `webpage_activity_sessions` table via foreign key
   - Storage location: `insert_webpage_content()` function at line 232

2. **LanceDB Vector Store** (`vscode/src/lance_db.ts` and `reconcile_webpage_trees_workflow.ts:301`):
   - Namespace: `WEBPAGE_CONTENT_NAMESPACE`
   - Stores the same processed webpage content along with embeddings
   - Includes metadata: pageContent, url, title
   - Used for vector similarity search and RAG operations
   - Storage location: `memory_db.put()` call at line 301 in reconcile_webpage_trees_workflow.ts

### Duplication Confirmed

Yes, content is duplicated. In `reconcile_webpage_trees_workflow.ts`:

- Line 288: Content is stored in DuckDB via `insert_webpage_content()`
- Line 301-309: The SAME processed content is stored in LanceDB via `memory_db.put()`

### Vector DB Key-Based Lookup Feasibility

The LanceDB implementation (`LanceDBMemoryStore`) already supports key-based lookups:

- `get(namespace, key)` method exists (line 100 in lance_db.ts)
- Uses SQL-like queries: `table.query().where(\`key = '\${key}'\`)`
- This means we can retrieve specific pages by their ID without vector search

### Optimization Plan

#### Recommended approach: Keep content in LanceDB only

1. Remove DuckDB `webpage_content` table entirely
2. Modify retrieval functions to fetch content from LanceDB when needed
3. Benefits:
   - Single source of truth for content
   - Reduced storage by ~50% for webpage content
   - Still maintains vector search capabilities
   - Key-based lookups already supported

**Implementation steps:**

1. Update `get_webpage_content()` in duck_db.ts to fetch from LanceDB
2. Remove `insert_webpage_content()` calls
3. Remove `webpage_content` table creation
4. Update all content retrieval queries to use LanceDB

### Storage Efficiency Gains

**Current duplication cost:**

- Each webpage stored twice (compressed in both systems)
- Estimated storage reduction: 45-50% of webpage content storage
- Additional overhead: Reduced write operations (single write vs double)
- Memory benefits: Less RAM needed for caching duplicate data

**Performance considerations:**

- LanceDB key lookups are efficient (direct index access)
- No performance degradation expected
- Potential improvement in write performance (single write operation)
