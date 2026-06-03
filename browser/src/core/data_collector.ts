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

export const compress_content = async (content: string, zstd: any): Promise<string> => {
  try {
    const encoder = new TextEncoder();
    const content_bytes = encoder.encode(content);
    const compressed_data = zstd.compress(content_bytes);

    console.log(
      `Content compressed from ${content_bytes.length} to ${compressed_data.length} bytes`
    );

    return uint8_array_to_base64(compressed_data);
  } catch (e) {
    console.error("Content compression failed:", e);
    return "Error compressing content.";
  }
};

// Cap captured markup so a pathologically large page cannot allocate/compress
// an unbounded payload on the page's main thread.
export const MAX_CONTENT_BYTES = 2_000_000;

export const extract_page_content = (): string => {
  const html = document.body?.outerHTML ?? "";
  return html.length > MAX_CONTENT_BYTES ? html.slice(0, MAX_CONTENT_BYTES) : html;
};

export const create_visit_data = async (
  url: string,
  referrer: string,
  referrer_timestamp: number | undefined,
  zstd: any,
  tab_id?: number,
  group_id?: string,
  opener_tab_id?: number
): Promise<VisitData> => {
  const content = extract_page_content();
  const compressed_content = await compress_content(content, zstd);

  return new VisitData(
    generate_visit_id(),
    url,
    new Date().toISOString(),
    referrer,
    compressed_content,
    referrer_timestamp,
    tab_id,
    group_id,
    opener_tab_id
  );
};

// Factory function for creating a zstd instance
export const create_zstd_instance = async (): Promise<any> => {
  return await Zstd.load();
};