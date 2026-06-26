---
name: bergamot-clusters
description: >-
  Surface and act on the topic clusters Bergamot detects from your browsing. Answers
  in-context recall ("what have I been reading about X lately"), drafts Map-of-Content
  note stubs into bergamot.staging/ (summarise then draft a stub — the hero loop), and
  records cluster curation (suppress / rename / never-cluster-this-origin). Runs on demand
  or on a weekly cadence as a digest. Reads only ~/.bergamot/port.json and the loopback
  /query/cluster* routes — it does no database access of its own. Use when the user asks
  what they have been researching, wants a note seeded from their browsing, or wants to
  hide/rename a cluster or block a site from clustering.
allowed-tools: Bash, Read
---

# bergamot-clusters

The host-agnostic actionability layer over Bergamot's Temporal Topic Detection.
Every command is a thin call to a loopback route exposed by the running Bergamot
VS Code extension (or the future standalone daemon); the skill never touches
DuckDB. Run the bundled script with `node`:

```
node ${CLAUDE_SKILL_DIR}/scripts/bergamot_clusters.js <command> [flags]
```

All commands accept `--json` for machine-readable output. Cluster ids rotate every
time clustering recomputes, so always take an id from a fresh `recent` call in the
SAME turn and pass it straight to `cluster` / `stub` / `suppress` / `rename`; never
reuse an id from an earlier session.

## In-context recall — "what have I been reading about X?"

```
node scripts/bergamot_clusters.js recent --days 7        # current threads, newest first
node scripts/bergamot_clusters.js cluster --id <id>      # one thread: exemplar + member pages
node scripts/bergamot_clusters.js page --page-session-id <id>   # which thread a page is in
```

`recent` returns clusters with their label, scope, size, coherence, and id. Read
them back to the user; use `cluster --id` to pull the member pages (with live URLs)
into the conversation so they can cite or link them while writing. `page` reports
`page_status` ∈ {clustered, noise, unseen} — "noise" honestly means "you read this
but it was a one-off in its window."

## The hero loop — summarise, then draft a staged stub

```
node scripts/bergamot_clusters.js cluster --id <id>      # the material to summarise
node scripts/bergamot_clusters.js stub --id <id>         # write a promotable stub
```

Compose a one-line summary from the `cluster` payload, then `stub --id` writes an
agent-authored Map-of-Content note into `bergamot.staging/`. The stub is a DRAFT in
a quarantined directory — tell the user to review it and promote it by hand; Bergamot
never writes into canonical notes (constitution principle 8). The writer is
idempotent: re-running on the same thread overwrites its own un-promoted draft and
never recreates one the user has promoted or discarded. Use `--dry-run` to preview
without writing.

## Curation — required day-one controls

```
node scripts/bergamot_clusters.js suppress --id <id>             # hide a cluster
node scripts/bergamot_clusters.js rename   --id <id> --label "My project"
node scripts/bergamot_clusters.js block    --origin bank.com     # never cluster this site
node scripts/bergamot_clusters.js unsuppress --id <id> | unrename --id <id> | unblock --origin <d>
```

These write to Bergamot's own control tables (never the PKM), and persist across
recomputes by keying on a stable identity rather than the per-run cluster id.
`block` also keeps the origin out of future re-downloads and clustering. Because the
skill runs on every host, these controls work everywhere — they do not depend on any
VS Code panel.

## Weekly digest (the host-agnostic push anchor)

The pull commands above answer questions on demand. To anchor the weekly-review
habit on hosts without a panel, schedule the skill to run a digest. Use the Claude
Code routine/cron mechanism (the `/schedule` command); a weekly cadence — e.g.
**Monday 08:00 local** — invokes this skill with a prompt like:

> Run the bergamot-clusters weekly digest: list last week's clusters and their
> coverage, summarise the notable threads, and stage a weekly-review stub.

The routine should run:

```
node scripts/bergamot_clusters.js recent --days 7
node scripts/bergamot_clusters.js coverage --days 7
```

then summarise the result into a short digest. This is the only digest config — the
routine you create with `/schedule` IS the cadence; change the cron there to retune
it.

Keep it quiet by design (the notification-fatigue lesson): the digest is pull-first
and triaged, not a firehose. Writing a staged weekly-review stub (`stub --id`) and
any desktop notification are OPT-IN, and a quiet week (no new clusters) produces no
stub and no notification — `recent` simply reports "No clusters in this window."

## Guardrails

- The skill performs no canonical-note writes; the only writes are staged stubs
  (into `bergamot.staging/`, via `stub`) and curation rows (via the control routes).
- If the script reports "Bergamot server not running," the extension is not open —
  ask the user to open it (the routes live on its loopback server).
