# Bergamot — Intention Tree

Privacy is the core organizing principle. Bergamot captures **browsing metadata only, never page content**, stores that metadata locally as the durable source of truth, and re-downloads public pages later to understand them — pages behind a login wall fail to re-download and are thereby excluded.

The full constitution — inviolable principles, operating policy, scope, amendment process — lives in [docs/constitution.md](docs/constitution.md). This file holds the intention tree every task is justified against.

## Root

Turn a user's passive browsing into a durable, local-only, queryable knowledge base that surfaces the projects and interests they are actually working on — capturing metadata only, never content.

## The spine (in sequence)

```text
ROOT — local, durable, queryable knowledge base from passive browsing
│
├── CAPTURE  (shipped — metadata-only)
│     Passively, deterministically capture METADATA ONLY: visit id, URL,
│     load timestamp, title, and the navigation/session graph (referrer
│     chains, tab-opener relationships, group/session ids, SPA events).
│     Zero-LLM, deterministic. Page content is NEVER stored at capture.
│     Browsing metadata is the durable source of truth.
│
├── STORE  (shipped — encrypted metadata store + encrypted content-cache tier)
│     Durable, local-only persistence of the metadata record. DuckDB
│     metadata store + derived stores; no raw-content capture row. Any
│     content cached after re-download is a separate, on-demand, encrypted,
│     scoped, deletable tier — never the source of truth.
│
└── UNDERSTAND / SURFACE  (in progress — the hero loop)
      Post-process re-downloads public page content from stored URLs
      (login-walled pages excluded), embeds and groups it into the projects
      the user is working on, and pushes them as editable note stubs in the
      PKM. Temporal Topic Detection runs first over the re-downloaded corpus.
```

## Deferred branches (gated on the spine proving value)

```text
(b) Research tools over the archive — read-only RAG sub-agent over re-downloaded
    / on-demand content, AFTER Temporal Topic Detection.
    Unlock: a working retrieval baseline the eval harness validates.

(c) Note-linking — connect existing notes to relevant visited pages.
    Unlock: a bootstrapped note corpus exists to link against.

(a) Autonomous research agents — budget-bounded research on the user's behalf.
    The LAST pillar. Unlock: a demonstrated-trustworthy project-surfacing loop
    plus the full agent-governance suite.
```

## Admissibility rule (constitution, principle 11)

> A task is admissible only if it is the cheapest change that advances a named node of this tree. If it cannot be tied to a node, it is surplus and is rejected.

Every new task answers three standing questions at creation: (1) which intention-tree node does this advance? (2) is this the cheapest change that advances it? (3) what is the destructive-delete plan for what it replaces?
