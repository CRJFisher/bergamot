import { Zstd } from "@hpcc-js/wasm-zstd";
import { VisitData } from '../types/navigation';

// Pure functions for data collection
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

export const extract_page_content = (): string => {
  return document.body.outerHTML;
};

export const create_visit_data = async (
  url: string,
  referrer: string,
  referrer_timestamp: number | undefined,
  zstd: any
): Promise<VisitData> => {
  const content = extract_page_content();
  const compressed_content = await compress_content(content, zstd);
  
  return new VisitData(
    url,
    new Date().toISOString(),
    referrer,
    compressed_content,
    referrer_timestamp
  );
};

// Factory function for creating a zstd instance
export const create_zstd_instance = async (): Promise<any> => {
  return await Zstd.load();
};