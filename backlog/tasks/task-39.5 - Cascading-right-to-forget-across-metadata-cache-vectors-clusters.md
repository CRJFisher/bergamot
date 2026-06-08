---
id: TASK-39.5
title: "Cascading right-to-forget across metadata, content cache, vectors, and clusters"
status: To Do
assignee: []
created_date: "2026-06-08 13:30"
labels:
  - privacy
  - storage
dependencies:
  - TASK-39.3
references:
  - backlog/drafts/privacy-preserving-capture-model.md
  - docs/constitution.md
parent_task_id: TASK-39
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Implement the constitution's inviolable right-to-forget (principle 4) as a core-spine primitive. Deleting — by URL, by origin, or by time-range — atomically removes the metadata row(s) AND every derived artifact: the encrypted re-download content cache (task-39.3), derived vectors, and cluster memberships.

Forgetting is deletion, not hiding: no derived artifact may continue to encode forgotten content. The operation is atomic across the cascade (a partial delete that leaves vectors or cache entries behind is a failure). Coordinates with the TDT (task-36) and RAG (task-31) derived stores as those land — the cascade must cover whatever derived stores exist.

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Delete-by-URL, delete-by-origin, and delete-by-time-range are available
- [ ] #2 A delete atomically removes the metadata row(s), the encrypted content-cache entries, derived vectors, and cluster memberships
- [ ] #3 Deletion is real, not a tombstone — verified that no derived artifact still encodes the forgotten content
- [ ] #4 The cascade is covered by tests across all derived stores that exist
<!-- AC:END -->
