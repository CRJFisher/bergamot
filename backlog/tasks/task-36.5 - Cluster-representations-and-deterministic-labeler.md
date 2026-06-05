---
id: TASK-36.5
title: Cluster representations and deterministic labeler
status: To Do
assignee: []
created_date: "2026-06-05 19:23"
updated_date: "2026-06-05 19:23"
labels: []
dependencies:
  - TASK-36.4
references:
  - backlog/drafts/tdt-hdbscan-micro-tier-plan.md
parent_task_id: TASK-36
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Give each cluster a representative page and a human-readable label without an LLM. The representative is the eom exemplar (exemplarIndices\_), falling back to select_medoids when no exemplar is defined; noise (-1) has no representative. Each cluster also gets a frozen L2-normalized representative vector — consumed now for labeling/ranking and banked as the input the later cross-window tracker needs.

The deterministic labeler produces label fields stored separately (never one baked string) so the UI can recompose and a later LLM can consume the bundle: headline_title (the exemplar page's title), scope (registrable-domain distribution), cheap keyphrases from already-available <head> metadata, a composed display_label, and a representation_version. No LLM and no window-relative c-TF-IDF in this slice. The LLM-naming path is left as a documented interface seam only — not implemented, and no dead config flag is shipped.

Design reference: backlog/drafts/tdt-hdbscan-micro-tier-plan.md §7 (Cluster representation & labeling).

<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->

- [ ] #1 Each cluster exposes a representative page_session_id (eom exemplar, else select_medoids fallback) and a frozen L2-normalized representative vector; noise has no representative
- [ ] #2 A deterministic labeler produces headline_title, scope (registrable-domain distribution), keyphrases, display_label, and representation_version as separate fields, with no LLM and no per-window c-TF-IDF
- [ ] #3 Label fields recompose into a display string, and unit tests assert determinism and recomposition
- [ ] #4 The LLM-naming seam (interface boundary plus stable-core fingerprint) is documented but not implemented, and no default-off config flag for it is shipped
<!-- AC:END -->
