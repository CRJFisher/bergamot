import { describe, it, expect, jest } from "@jest/globals";

// data_collector (imported transitively) loads the zstd WASM module at import
// time; stub it so jest does not try to parse the real ESM bundle. These tests
// inject their own compressor, so the stub is never exercised.
jest.mock("@hpcc-js/wasm-zstd", () => ({
  Zstd: { load: () => Promise.resolve({ compress: (data: Uint8Array) => data }) }
}));

import { make_lazy_zstd, compress_visit_content } from "../src/core/visit_compression";
import { ZstdCompressor } from "../src/core/data_collector";
import { Message } from "../src/core/message_router";
import { BrowserDevStage } from "../src/core/dev_signal";

// A compressor whose output ignores its input, so the base64 is deterministic.
const fake_zstd: ZstdCompressor = {
  compress: () => new Uint8Array([1, 2, 3]),
};

describe("make_lazy_zstd", () => {
  it("compiles exactly once and shares the instance across calls", async () => {
    const load = jest.fn<() => Promise<ZstdCompressor>>().mockResolvedValue(fake_zstd);
    const get_zstd = make_lazy_zstd(load);

    const [a, b] = await Promise.all([get_zstd(), get_zstd()]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(a).toBe(fake_zstd);
    expect(b).toBe(fake_zstd);
  });

  it("does not cache a rejected compile — the next call retries", async () => {
    const load = jest
      .fn<() => Promise<ZstdCompressor>>()
      .mockRejectedValueOnce(new Error("wasm load failed"))
      .mockResolvedValueOnce(fake_zstd);
    const get_zstd = make_lazy_zstd(load);

    await expect(get_zstd()).rejects.toThrow("wasm load failed");
    // A transient failure must not poison the singleton for the worker's life.
    await expect(get_zstd()).resolves.toBe(fake_zstd);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("compress_visit_content", () => {
  const get_zstd = () => Promise.resolve(fake_zstd);
  const visit_message = (content: unknown): Message => ({
    action: "sendToPKMServer",
    endpoint: "/visit",
    api_base_url: "http://localhost:5000",
    data: { url: "https://example.com", visit_id: "v1", content },
  });

  it("compresses page content for a /visit message", async () => {
    const report = jest.fn();

    const result = await compress_visit_content(visit_message("<body>hi</body>"), get_zstd, report);

    expect(result.data?.content).toBe("AQID"); // base64 of [1,2,3]
    expect(report).not.toHaveBeenCalled();
  });

  it("passes a non-visit message through untouched", async () => {
    const report = jest.fn();
    const message: Message = { action: "getReferrer" };

    const result = await compress_visit_content(message, get_zstd, report);

    expect(result).toBe(message);
    expect(report).not.toHaveBeenCalled();
  });

  it("passes empty content through without compressing", async () => {
    const report = jest.fn();
    const message = visit_message("");

    const result = await compress_visit_content(message, get_zstd, report);

    expect(result.data?.content).toBe("");
    expect(report).not.toHaveBeenCalled();
  });

  it("on compression failure reports a signal and forwards empty content", async () => {
    const report = jest.fn<(stage: BrowserDevStage, fields: Record<string, unknown>) => void>();
    const failing_zstd = () =>
      Promise.reject(new Error("compile blocked"));

    const result = await compress_visit_content(
      visit_message("<body>hi</body>"),
      failing_zstd,
      report
    );

    // Never forward the raw markup — the server would store it verbatim.
    expect(result.data?.content).toBe("");
    expect(report).toHaveBeenCalledWith("compression_failed", {
      url: "https://example.com",
      visit_id: "v1",
      error: "compile blocked",
    });
  });
});
