import { Zstd } from "@hpcc-js/wasm-zstd";
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

export const uint8_array_to_base64 = (uint8_array: Uint8Array): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(uint8_array).toString("base64");
  }

  let binary = "";
  const len = uint8_array.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(uint8_array[i]);
  }
  return btoa(binary);
};

// The zstd binding exposes a synchronous `compress` over raw bytes.
export type ZstdCompressor = { compress: (data: Uint8Array) => Uint8Array };

// Compresses page content to base64 zstd. Throws on failure so the caller (the
// background service worker) can record it as a dev signal and forward an empty
// body rather than a corrupt one.
export const compress_content = async (
  content: string,
  zstd: ZstdCompressor
): Promise<string> => {
  const encoder = new TextEncoder();
  const content_bytes = encoder.encode(content);
  const compressed_data = zstd.compress(content_bytes);

  console.log(
    `Content compressed from ${content_bytes.length} to ${compressed_data.length} bytes`
  );

  return uint8_array_to_base64(compressed_data);
};

// Cap captured markup so a pathologically large page cannot allocate/compress
// an unbounded payload on the page's main thread.
export const MAX_CONTENT_BYTES = 2_000_000;

export const extract_page_content = (): string => {
  const html = document.body?.outerHTML ?? "";
  return html.length > MAX_CONTENT_BYTES ? html.slice(0, MAX_CONTENT_BYTES) : html;
};

// Builds a visit payload with the RAW page markup. WebAssembly compression is
// blocked by a page's CSP in the content script's isolated world, so the content
// script no longer compresses here — it sends raw content and the background
// service worker (whose own CSP permits WASM) compresses before forwarding.
export const create_visit_data = (
  url: string,
  referrer: string,
  referrer_timestamp: number | undefined,
  tab_id?: number,
  group_id?: string,
  opener_tab_id?: number
): VisitData => {
  const content = extract_page_content();

  return new VisitData(
    generate_visit_id(),
    url,
    new Date().toISOString(),
    referrer,
    content,
    referrer_timestamp,
    tab_id,
    group_id,
    opener_tab_id
  );
};

// Factory function for creating a zstd instance. Called from the background
// service worker, where the extension's CSP permits WebAssembly compilation.
export const create_zstd_instance = async (): Promise<ZstdCompressor> => {
  return await Zstd.load();
};