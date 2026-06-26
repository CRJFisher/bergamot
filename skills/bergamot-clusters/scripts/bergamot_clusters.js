#!/usr/bin/env node
"use strict";

// bergamot-clusters skill — the thin actionability layer over the TDT cluster
// read primitive (TASK-36.8). It does NO database access of its own: every
// subcommand hits a loopback /query/* or write route via port_discovery.js.
//
// Subcommands (each accepts --json for machine output):
//   recent   [--days N | --from ISO --to ISO] [--limit N]   -> list current clusters
//   page     --page-session-id ID                            -> clusters for a page + status
//   cluster  --id ID                                         -> one cluster + members (summarise input)
//   coverage [--days N | --from ISO --to ISO]                -> per-window coverage
//   stub     --id ID [--dry-run]                             -> stage a promotable note stub
//   suppress --id ID                                         -> hide a cluster (curation)
//   rename   --id ID --label "..."                           -> override a cluster's label
//   block    --origin DOMAIN                                 -> never-cluster-this-origin
//   unblock  --origin DOMAIN | unsuppress --id ID | unrename --id ID
//
// Cluster ids dangle across recomputes, so always obtain an id from `recent`
// THIS invocation and pass it straight on; never cache an id across runs.
//
// Dependency-free (runs from an installed .claude dir); Node >= 18 (global fetch).

const { get, post } = require("./port_discovery");

const USAGE =
  "usage: bergamot_clusters.js <recent|page|cluster|coverage|stub|suppress|rename|block|unblock|unsuppress|unrename> [flags]";

function parse_flags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key === "json" || key === "dry-run") {
      flags[key] = true;
    } else {
      flags[key] = argv[++i];
    }
  }
  return flags;
}

/** Default window: the last `days` (default 7) anchored to now. */
function window_from(flags) {
  if (flags.from && flags.to) return { from: flags.from, to: flags.to };
  const days = Number(flags.days ?? 7);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function require_flag(flags, name) {
  if (!flags[name]) {
    process.stderr.write(`missing required --${name}\n${USAGE}\n`);
    process.exit(2);
  }
  return flags[name];
}

function emit(flags, data, human) {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  } else {
    process.stdout.write(`${human(data)}\n`);
  }
}

function format_clusters(clusters) {
  if (!clusters.length) return "No clusters in this window.";
  return clusters
    .map((c) => {
      const coh = c.coherence == null ? "?" : c.coherence.toFixed(2);
      return `▸ ${c.display_label ?? c.headline_title ?? c.id} (${c.size} pages · coherence ${coh})\n  scope: ${c.scope ?? "—"} · id: ${c.id}`;
    })
    .join("\n");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parse_flags(rest);

  switch (command) {
    case "recent": {
      const { from, to } = window_from(flags);
      const params = { from, to };
      if (flags.limit) params.limit = String(flags.limit);
      const clusters = await get("/query/clusters", params);
      emit(flags, clusters, format_clusters);
      return;
    }
    case "page": {
      const page_session_id = require_flag(flags, "page-session-id");
      const result = await get("/query/clusters_for_page", { page_session_id });
      emit(
        flags,
        result,
        (r) => `status: ${r.page_status}\n${format_clusters(r.clusters)}`,
      );
      return;
    }
    case "cluster": {
      const id = require_flag(flags, "id");
      const detail = await get("/query/cluster", { id });
      emit(flags, detail, (d) => {
        if (!d) return "Cluster not found (it may have been recomputed).";
        const members = d.members
          .map((m) => `  - ${m.title ?? m.url ?? m.page_session_id} (${m.url ?? ""})`)
          .join("\n");
        return `${d.cluster.display_label ?? d.cluster.headline_title}\nexemplar: ${
          d.exemplar_page?.url ?? "—"
        }\nmembers:\n${members}`;
      });
      return;
    }
    case "coverage": {
      const { from, to } = window_from(flags);
      const coverage = await get("/query/cluster_coverage", { from, to });
      emit(flags, coverage, (rows) =>
        rows
          .map(
            (r) =>
              `${r.window.start.slice(0, 10)}→${r.window.end.slice(0, 10)}: ${
                r.cluster_count
              }/${r.input_count} clustered (${Math.round(r.coverage * 100)}%)`,
          )
          .join("\n"),
      );
      return;
    }
    case "stub": {
      const id = require_flag(flags, "id");
      if (flags["dry-run"]) {
        const detail = await get("/query/cluster", { id });
        emit(flags, { dry_run: true, would_stage: id, found: !!detail }, (d) =>
          d.found ? `Would stage cluster ${id}.` : `Cluster ${id} not found.`,
        );
        return;
      }
      const outcome = await post("/stage_cluster", { cluster_id: id });
      emit(
        flags,
        outcome,
        (o) => `${o.kind}: ${o.filename} (promote it by hand in bergamot.staging/)`,
      );
      return;
    }
    case "suppress": {
      const id = require_flag(flags, "id");
      emit(flags, await post("/cluster_control", { kind: "suppress", cluster_id: id }), () => `Suppressed ${id}.`);
      return;
    }
    case "rename": {
      const id = require_flag(flags, "id");
      const label = require_flag(flags, "label");
      emit(
        flags,
        await post("/cluster_control", { kind: "rename", cluster_id: id, display_label: label }),
        () => `Renamed ${id} → "${label}".`,
      );
      return;
    }
    case "block": {
      const origin = require_flag(flags, "origin");
      emit(
        flags,
        await post("/cluster_control", { kind: "never_cluster_origin", origin }),
        (r) => `Will never cluster ${r.origin}.`,
      );
      return;
    }
    case "unblock": {
      const origin = require_flag(flags, "origin");
      emit(flags, await post("/cluster_control/delete", { kind: "never_cluster_origin", origin }), () => `Unblocked ${origin}.`);
      return;
    }
    case "unsuppress": {
      const id = require_flag(flags, "id");
      emit(flags, await post("/cluster_control/delete", { kind: "suppress", cluster_id: id }), () => `Un-suppressed ${id}.`);
      return;
    }
    case "unrename": {
      const id = require_flag(flags, "id");
      emit(flags, await post("/cluster_control/delete", { kind: "rename", cluster_id: id }), () => `Reverted rename of ${id}.`);
      return;
    }
    default:
      process.stderr.write(`${USAGE}\n`);
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
});
