import { VisitData } from '../types/navigation';

// Pure functions for data collection
// Generate a correlation id for a visit. `crypto.randomUUID` only exists in a
// secure context (https / localhost), so fall back to `getRandomValues` for
// plain-HTTP pages where it is undefined.
export const generate_visit_id = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
};

// Builds a metadata-only visit payload: a correlation id, the URL, the load
// timestamp, the page title (read from the tab), and the session-graph fields.
// Page content is never read — content is obtained later by re-downloading the
// public URL during post-processing.
export const create_visit_data = (
  url: string,
  title: string,
  referrer: string,
  referrer_timestamp?: number,
  tab_id?: number,
  group_id?: string,
  opener_tab_id?: number
): VisitData => {
  return new VisitData(
    generate_visit_id(),
    url,
    new Date().toISOString(),
    referrer,
    title,
    referrer_timestamp,
    tab_id,
    group_id,
    opener_tab_id
  );
};
