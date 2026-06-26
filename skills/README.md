# Bergamot skills

Version-controlled source for the Claude skills Bergamot ships. `.claude/` is
gitignored repo-wide, so the canonical source for a shipped skill lives here and is
installed into `.claude/skills/<name>/` to run (copy it, or symlink it as this repo
does locally: `.claude/skills/bergamot-clusters -> ../../skills/bergamot-clusters`).

- **bergamot-clusters** — the host-agnostic actionability layer over the TDT cluster
  read routes (TASK-36.8): in-context recall, the note-stub hero loop, cluster
  curation, and the weekly digest. Thin scripts over `~/.bergamot/port.json` + the
  loopback `/query/cluster*` routes; no database access of its own.
