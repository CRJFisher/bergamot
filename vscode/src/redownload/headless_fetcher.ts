/**
 * The re-download fetcher: navigates a stored public URL with the stealth
 * headless browser, observes the result, and classifies it. A fetch never
 * throws on a page-level failure — failures come back as a {@link FetchResult}
 * whose outcome is an exclusion. The login wall is the privacy filter, applied
 * by {@link classify_fetch} over what the anonymous browser actually saw.
 */
import type { Page, Response } from "patchright";
import { PageMetadata, read_metadata } from "./read_metadata";
import {
  classify_fetch,
  extract_markers_from_html,
  FetchObservation,
  FetchOutcome,
  host_of,
  is_retryable_outcome,
  DomMarkers,
} from "./fetch_outcome";
import { sha256_hex } from "./content_hash";
import { PageRunner } from "./browser_pool";
import { PolitenessGate } from "./politeness_gate";

/** Per-fetch fidelity, recorded for every attempt so drift/unavailability shows. */
export interface FetchFidelity {
  /** ISO timestamp of the fetch attempt. */
  fetched_at: string;
  /** Final HTTP status, or null on transport failure. */
  http_status: number | null;
  /** SHA-256 hex of the re-downloaded content; null when excluded. */
  content_hash: string | null;
  /** The URL navigation landed on after redirects. */
  final_url: string;
  /** How many redirect hops the fetch went through. */
  redirect_count: number;
}

/** The full result of re-downloading one URL. */
export interface FetchResult {
  outcome: FetchOutcome;
  fidelity: FetchFidelity;
  /** `<meta>`-derived fields parsed from the re-downloaded page; null if excluded. */
  metadata: PageMetadata | null;
  /** `Retry-After` from a 429/503, in ms, for the gate's backoff; else null. */
  retry_after_ms: number | null;
}

export interface Fetcher {
  fetch(url: string): Promise<FetchResult>;
}

export interface FetcherConfig {
  /** `page.goto` timeout. */
  nav_timeout_ms: number;
  /** Bounded extra wait for late `load`, on top of `domcontentloaded`. */
  settle_timeout_ms: number;
}

export const DEFAULT_FETCHER_CONFIG: FetcherConfig = {
  nav_timeout_ms: 20000,
  settle_timeout_ms: 3000,
};

const EMPTY_MARKERS: DomMarkers = {
  has_password_input: false,
  visible_text_length: 0,
  paywall_selector_hits: [],
  jsonld_accessible_for_free: null,
  meta_refresh_target: null,
};

/** Parses a `Retry-After` header value (delta-seconds) into ms, or null. */
function parse_retry_after(value: string | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

export class HeadlessFetcher implements Fetcher {
  private readonly config: FetcherConfig;

  constructor(
    private readonly pages: PageRunner,
    private readonly gate: PolitenessGate,
    config: Partial<FetcherConfig> = {}
  ) {
    this.config = { ...DEFAULT_FETCHER_CONFIG, ...config };
  }

  /** Re-downloads a URL under the politeness gate, retrying transient failures. */
  fetch(url: string): Promise<FetchResult> {
    const host = host_of(url) ?? url;
    return this.gate.with_retry(
      host,
      () => this.fetch_once(url),
      (result) => is_retryable_outcome(result.outcome),
      (result) => result.retry_after_ms
    );
  }

  private async fetch_once(url: string): Promise<FetchResult> {
    return this.pages.with_page(async (page) => {
      const observation = await this.observe(page, url);
      const outcome = classify_fetch(observation);
      const fetched_at = new Date().toISOString();
      const content_hash =
        outcome.kind === "ok" ? sha256_hex(outcome.html) : null;
      const metadata =
        outcome.kind === "ok"
          ? read_metadata(outcome.html, observation.final_url)
          : null;

      return {
        outcome,
        metadata,
        retry_after_ms: this.retry_after_for(observation),
        fidelity: {
          fetched_at,
          http_status: observation.http_status,
          content_hash,
          final_url: observation.final_url,
          redirect_count: observation.redirect_chain.length,
        },
      };
    });
  }

  private retry_after_for(observation: ObservationWithRetry): number | null {
    return observation.http_status === 429 || observation.http_status === 503
      ? observation.retry_after_ms ?? null
      : null;
  }

  private async observe(page: Page, url: string): Promise<ObservationWithRetry> {
    // Capture the final main-frame response even when goto aborts — Chromium
    // aborts navigation when it downloads a resource instead of rendering it
    // (e.g. a PDF), but the response (with its content-type) still arrives, so we
    // can classify it as non_html rather than mistaking it for a dead link.
    let nav_response: Response | null = null;
    const on_response = (response: Response): void => {
      const request = response.request();
      if (request.isNavigationRequest() && response.frame() === page.mainFrame()) {
        nav_response = response;
      }
    };
    page.on("response", on_response);

    let transport_error: string | null = null;
    try {
      const goto_response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: this.config.nav_timeout_ms,
      });
      if (goto_response) nav_response = goto_response;
      // Bounded settle for client-rendered pages; never block forever on beacons.
      await page
        .waitForLoadState("load", { timeout: this.config.settle_timeout_ms })
        .catch((): void => undefined);
    } catch (error) {
      transport_error = error instanceof Error ? error.message : String(error);
    } finally {
      page.off("response", on_response);
    }

    let http_status: number | null = null;
    let content_type: string | null = null;
    let retry_after_ms: number | null = null;
    let redirect_chain: { url: string; status: number }[] = [];
    // page.url() is about:blank after an aborted download; the response URL is the
    // real resource. Falls back to the requested URL if neither is available.
    let final_url = page.url();
    const response = nav_response;
    if (response) {
      // Inspecting the response (headers, redirect walk) can itself reject; keep
      // it inside a guard so a fetch failure always degrades to an outcome rather
      // than throwing out of the fetcher's never-throw contract.
      try {
        http_status = response.status();
        const headers = response.headers();
        content_type = headers["content-type"] ?? null;
        retry_after_ms = parse_retry_after(headers["retry-after"]);
        redirect_chain = await build_redirect_chain(response);
        final_url = response.url();
        // A response arrived; an aborted download is not a transport failure.
        transport_error = null;
      } catch (error) {
        transport_error = error instanceof Error ? error.message : String(error);
      }
    }

    const html = transport_error
      ? ""
      : await page.content().catch((): string => "");
    const dom_markers = transport_error
      ? EMPTY_MARKERS
      : extract_markers_from_html(html);

    return {
      requested_url: url,
      final_url: final_url || url,
      http_status,
      content_type,
      redirect_chain,
      transport_error,
      dom_markers,
      html,
      retry_after_ms,
    };
  }
}

/** A {@link FetchObservation} plus the parsed `Retry-After` for the gate. */
interface ObservationWithRetry extends FetchObservation {
  retry_after_ms: number | null;
}

/** Walks `response.request().redirectedFrom()` to reconstruct the hops, oldest first. */
async function build_redirect_chain(
  response: Awaited<ReturnType<Page["goto"]>>
): Promise<{ url: string; status: number }[]> {
  const chain: { url: string; status: number }[] = [];
  let request = response?.request().redirectedFrom() ?? null;
  while (request) {
    const hop_response = await request.response();
    chain.unshift({
      url: request.url(),
      status: hop_response ? hop_response.status() : 0,
    });
    request = request.redirectedFrom();
  }
  return chain;
}
