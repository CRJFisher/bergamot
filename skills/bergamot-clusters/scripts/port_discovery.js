#!/usr/bin/env node
"use strict";

// Shared loopback-relay helper for the bergamot-clusters skill scripts.
//
// The skill does NO database access of its own: it discovers the running Bergamot
// server via ~/.bergamot/port.json and hits the loopback /query/* and write routes
// over HTTP, exactly as vscode/src/mcp_server_standalone.ts does. This file is
// dependency-free (it runs from an installed .claude directory with no node_modules)
// and uses global fetch (Node >= 18).
//
// Token-readiness: the routes enforce no capability token today (loopback only).
// If port.json later carries a `token` (constitution principle 7), this helper
// attaches it as a Bearer header automatically — it never REQUIRES a token that
// does not exist.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function read_port_file() {
  try {
    const raw = fs.readFileSync(
      path.join(os.homedir(), ".bergamot", "port.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.port) return null;
    return { base: `http://localhost:${parsed.port}`, token: parsed.token ?? null };
  } catch {
    return null;
  }
}

async function relay(method, endpoint, { params, body } = {}) {
  const server = read_port_file();
  if (!server) {
    throw new Error(
      "Bergamot server not running (no ~/.bergamot/port.json). Open the Bergamot VS Code extension.",
    );
  }
  const headers = { "content-type": "application/json" };
  if (server.token) headers.authorization = `Bearer ${server.token}`;
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`${server.base}${endpoint}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = res.statusText;
    }
    throw new Error(`${method} ${endpoint} failed: ${res.status} ${detail}`);
  }
  return res.json();
}

const get = (endpoint, params) => relay("GET", endpoint, { params });
const post = (endpoint, body) => relay("POST", endpoint, { body });

module.exports = { read_port_file, relay, get, post };
