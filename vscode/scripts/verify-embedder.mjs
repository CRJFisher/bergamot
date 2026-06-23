#!/usr/bin/env node
/**
 * Verifies the REAL TDT page embedder (bge-small-en-v1.5 q8/384) end to end on
 * this machine. Run out-of-process — onnxruntime-node's native typed-array
 * validation is incompatible with jest's VM realm, so the live stack cannot run
 * inside the jest suite (the wrapper's logic is unit-tested with a mock in
 * src/tdt/local_embedder.test.ts).
 *
 * Compile first, then run:
 *   npm run compile && node scripts/verify-embedder.mjs
 *
 * Checks: the model loads and embeds a 384-d vector; the same text embeds
 * byte-identically (determinism); a warmed cache loads fully offline; and an
 * empty cache with downloads disabled refuses to reach the network.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../out/tdt");

let load_local_embedder, PAGE_EMBEDDING_DIM;
try {
  ({ load_local_embedder } = await import(path.join(out, "local_embedder.js")));
  ({ PAGE_EMBEDDING_DIM } = await import(path.join(out, "embedding_config.js")));
} catch (error) {
  console.error("Could not load the compiled embedder — run `npm run compile` first.");
  console.error(error.message);
  process.exit(2);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function bytes_equal(a, b) {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}

const cache_dir = fs.mkdtempSync(path.join(os.tmpdir(), "tdt-verify-"));
try {
  // 1. Provision + embed a 384-d vector.
  const embedder = await load_local_embedder(cache_dir, true);
  const v = await embedder.embed("a short sentence about local embeddings");
  if (!(v instanceof Float32Array)) fail(`embed returned ${v?.constructor?.name}, not Float32Array`);
  if (v.length !== PAGE_EMBEDDING_DIM) fail(`expected ${PAGE_EMBEDDING_DIM} dims, got ${v.length}`);
  if (![...v].every(Number.isFinite)) fail("vector has non-finite components");

  // 2. Determinism: same text → byte-identical.
  const a = await embedder.embed("determinism check sentence");
  const b = await embedder.embed("determinism check sentence");
  if (!bytes_equal(a, b)) fail("same text did not embed byte-identically");
  await embedder.dispose();

  // 3. Warmed cache loads fully offline.
  const offline = await load_local_embedder(cache_dir, false);
  const ov = await offline.embed("offline load");
  if (ov.length !== PAGE_EMBEDDING_DIM) fail("offline load produced the wrong dimension");
  await offline.dispose();

  // 4. Empty cache + downloads off → must throw, never fetch.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tdt-verify-empty-"));
  let threw = false;
  try {
    await load_local_embedder(empty, false);
  } catch {
    threw = true;
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }
  if (!threw) fail("strict-offline load with no model did not throw");

  if (!process.exitCode) console.log(`OK: embedder verified (${PAGE_EMBEDDING_DIM}-d, deterministic, offline-capable)`);
} finally {
  fs.rmSync(cache_dir, { recursive: true, force: true });
}
