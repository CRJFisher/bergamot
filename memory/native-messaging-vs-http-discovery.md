---
name: native-messaging-vs-http-discovery
description: Why Bergamot dropped native messaging for browser↔VS Code transport and how port discovery works instead
metadata:
  type: project
---

Bergamot's browser extension sends page visits to a local VS Code Express server. Native messaging originally existed to solve **port discovery**: the server bound a random port (`app.listen(0)`) and a browser extension has no filesystem access, so it couldn't read the port file — the native host (an OS process) bridged that gap.

Decision (2026-06): **remove native messaging, use HTTP port-range probing instead.**

**Why:** Native messaging wasn't actually needed. Discovery is solvable over plain HTTP: server binds the first free port in a small fixed range (5000–5009), `/status` returns a `{ service: "bergamot" }` identity marker, and the extension probes the range, matches the marker, and caches the working port (re-probing only on POST failure). The existing transport tries the configured `api_base_url` first, then falls back to probing. This needs no filesystem access, no OS-process bridge, no Python host, no manifest install. The old native path was also 100% broken (port-file path mismatch, no message-id echo → guaranteed timeout), so it wasn't even delivering the discovery it was added for.

Native messaging would only be genuinely required to launch a process from the browser, talk to a non-HTTP endpoint, or avoid binding any localhost port — none apply here.

See [[overhaul-roadmap]] Phase 2. Security boundary is loopback bind + CORS pinned to the extension origin (a token can't be auto-delivered to a filesystem-less extension).
