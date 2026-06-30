#!/usr/bin/env node

/**
 * Install Bergamot's shipped Claude skills into a target workspace.
 *
 * The skills are a product artifact meant to run in the user's PKM workspace
 * (where the loopback routes are consumed and note stubs are staged) — not in
 * bergamot's own checkout. This copies each shipped skill into
 * <target>/.claude/skills/<name>/ so the target never depends on bergamot's
 * checkout path. Wired as a launch-time step (see .vscode/tasks.json).
 *
 * A real copy, not a symlink: the installed skill must keep working if bergamot
 * moves or is deleted, and `.claude/` is gitignored so the copy is never
 * committed in either repo.
 *
 * Idempotent: each shipped skill's destination is replaced wholesale on every
 * run; unrelated skills already in the target are left untouched.
 *
 * Each immediate subdirectory of skills/ is one shipped skill. Files at that
 * level (README.md) are not skills and are ignored.
 *
 * Usage: node scripts/install-skills.mjs <target-workspace>
 *        BERGAMOT_SKILL_TARGET=<target-workspace> node scripts/install-skills.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_SRC = path.join(ROOT, 'skills');

const target = process.argv[2] ?? process.env.BERGAMOT_SKILL_TARGET;
if (!target) {
  console.error(
    'install-skills: target workspace required (argv[1] or BERGAMOT_SKILL_TARGET)',
  );
  process.exit(1);
}

const target_skills = path.join(path.resolve(target), '.claude', 'skills');
fs.mkdirSync(target_skills, { recursive: true });

const shipped = fs
  .readdirSync(SKILLS_SRC, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const name of shipped) {
  const dest = path.join(target_skills, name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(SKILLS_SRC, name), dest, { recursive: true });
  console.log(`install-skills: ${name} -> ${dest}`);
}

console.log(`install-skills: ${shipped.length} skill(s) installed into ${target_skills}`);
