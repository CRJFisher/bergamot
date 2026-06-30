# Bergamot skills

Version-controlled source for the Claude skills Bergamot ships. This directory is the
canonical source: each immediate subdirectory is one shipped skill; files at this level
(this README) are not skills.

Shipped skills are a product artifact that runs in the user's PKM workspace — where the
loopback read routes are consumed and note stubs are staged — not in bergamot's own
checkout. `scripts/install-skills.mjs <target-workspace>` copies each shipped skill into
`<target>/.claude/skills/<name>/`. The copy is a real copy, not a symlink, so the
installed skill keeps working regardless of bergamot's checkout path; `.claude/` is
gitignored, so the installed copy is never committed. Installation is idempotent: each
shipped skill's destination is replaced wholesale on every run, and unrelated skills
already in the target are left untouched.

Launching the "Run Extension" config runs this install automatically: its
`preLaunchTask` ("Run Extension: prepare") runs the `install skills` task alongside the
TypeScript watch, copying the shipped skills into the launch target workspace
(`/Users/chuck/workspace/pkm`).

- **bergamot-clusters** — the host-agnostic actionability layer over the TDT cluster
  read routes (TASK-36.8): in-context recall, the note-stub hero loop, cluster
  curation, and the weekly digest. Thin scripts over `~/.bergamot/port.json` + the
  loopback `/query/cluster*` routes; no database access of its own.
