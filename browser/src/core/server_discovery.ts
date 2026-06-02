// Pure functions for discovering the local Bergamot VS Code server over HTTP.
//
// A browser extension has no filesystem access, so it cannot read the server's
// port file. Instead it probes a fixed candidate range and confirms it found
// Bergamot via the `/status` service marker. This range MUST stay in sync with
// the VS Code server's `SERVER_PORT_RANGE`.

export const SERVER_PORT_RANGE: readonly number[] = [
  5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009,
];

const SERVICE_MARKER = "bergamot";

/**
 * Returns true if `base_url` is a running Bergamot server (its `/status`
 * endpoint reports the expected service marker).
 */
export const probe_server = async (base_url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${base_url}/status`, { method: "GET" });
    if (!response.ok) {
      return false;
    }
    const body = (await response.json()) as { service?: string };
    return body?.service === SERVICE_MARKER;
  } catch {
    return false;
  }
};

/**
 * Probes the candidate port range and returns the base URL of the first
 * responding Bergamot server, or null if none is found.
 */
export const discover_server_url = async (
  ports: readonly number[] = SERVER_PORT_RANGE
): Promise<string | null> => {
  for (const port of ports) {
    const base_url = `http://localhost:${port}`;
    if (await probe_server(base_url)) {
      return base_url;
    }
  }
  return null;
};
