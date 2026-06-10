#!/usr/bin/env node

/**
 * Guards the packaging contract after bundling: every bare specifier left in
 * a bundle must be a node builtin or a declared external — anything else is
 * a runtime dependency that would be missing on an installed extension. Also
 * pins patchright's laziness: a static `require("patchright")` would load it
 * before `resolve_browsers_path()` pins the browsers directory, silently
 * pointing the registry at the wrong cache.
 */
import fs from 'fs';
import path from 'path';
import { builtinModules } from 'module';
import { fileURLToPath } from 'url';
import { ENTRYPOINTS, EXTERNALS } from './bundle_manifest.mjs';

const root_dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set(EXTERNALS);

/**
 * Specifier prefixes that appear inside STRING LITERALS the bundle carries —
 * ajv's standalone-codegen templates embed `require("ajv/dist/runtime/…")`
 * in generated-source strings that are never executed at runtime (the MCP
 * SDK uses ajv's in-process compilation). Verified by running the bundled
 * mcp_server_standalone.js from an empty directory: it starts cleanly with
 * no node_modules at all.
 */
const CODEGEN_STRING_FALSE_POSITIVES = ['ajv/dist/runtime/', 'ajv-formats/dist/'];
const BUILTIN = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const BARE = /(?:require(?:\.resolve)?|import)\(["']([^"'./][^"']*)["']\)/g;

let failed = false;
for (const { out } of ENTRYPOINTS) {
  const file = path.join(root_dir, out);
  const source = fs.readFileSync(file, 'utf8');
  for (const [, specifier] of source.matchAll(BARE)) {
    const pkg = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
    if (
      !BUILTIN.has(pkg) &&
      !ALLOWED.has(pkg) &&
      !CODEGEN_STRING_FALSE_POSITIVES.some((prefix) => specifier.startsWith(prefix))
    ) {
      console.error(`${out}: unshipped bare specifier "${specifier}"`);
      failed = true;
    }
  }
  if (/require\(["']patchright["']\)/.test(source)) {
    console.error(`${out}: patchright is no longer lazily imported`);
    failed = true;
  }
}
if (failed) {
  process.exit(1);
}
console.log('✅ Bundle externals check passed');
