/**
 * The fetch-outcome classifier: the heart of the privacy-core re-download model.
 *
 * A re-downloaded page is observed (final URL, redirect chain, HTTP status,
 * rendered DOM markers) and classified into a {@link FetchOutcome}. Only an
 * `ok` outcome carries content into the public corpus; every other outcome is
 * an exclusion. The login wall is the privacy filter: authenticated, paywalled,
 * redirected, dead, and non-HTML pages are excluded here — with no "is this
 * sensitive?" heuristic. A page is excluded because it would not re-download as
 * public content for an anonymous visitor, not because we judged its topic.
 *
 * The classifier is a PURE function over a serializable {@link FetchObservation}
 * so it is fully unit-testable without launching a browser. The browser layer
 * ({@link ./headless_fetcher}) is the only part that depends on Chromium; it
 * builds the observation and delegates the verdict here.
 */

/** Discriminated outcome of re-downloading one URL. Only `ok` enters the corpus. */
export type FetchOutcome =
  | { kind: "ok"; html: string; final_url: string; http_status: number }
  | {
      kind: "auth_redirect";
      final_url: string;
      http_status: number | null;
      reason: string;
    }
  | { kind: "forbidden"; http_status: number; reason: string }
  | { kind: "paywall"; final_url: string; http_status: number; reason: string }
  | { kind: "dead_link"; http_status: number | null; reason: string }
  | {
      kind: "non_html";
      content_type: string;
      http_status: number | null;
      reason: string;
    };

/** The string discriminants of {@link FetchOutcome}, for persistence/enums. */
export type FetchOutcomeKind = FetchOutcome["kind"];

/**
 * Whether an outcome is worth retrying as a transient failure. Only dead links
 * caused by a transport error (timeout/DNS/reset), a 429, or a 5xx are retried;
 * a 404/410 is permanently dead and an auth/paywall exclusion is a correct
 * verdict, never a transient one.
 */
export function is_retryable_outcome(outcome: FetchOutcome): boolean {
  if (outcome.kind !== "dead_link") return false;
  if (outcome.http_status === null) return true;
  return outcome.http_status === 429 || outcome.http_status >= 500;
}

/**
 * The outcome discriminants as a const tuple — the single source of truth for the
 * persisted `outcome` enum (consumed by the DuckDB row schema and zod model). The
 * assertion below fails to compile if this list drifts from {@link FetchOutcome}.
 */
export const FETCH_OUTCOME_KINDS = [
  "ok",
  "auth_redirect",
  "forbidden",
  "paywall",
  "dead_link",
  "non_html",
] as const;

// Compile-time guarantee that FETCH_OUTCOME_KINDS and the union stay in lock-step.
type AssertSame<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _kinds_cover_union: AssertSame<
  FetchOutcomeKind,
  (typeof FETCH_OUTCOME_KINDS)[number]
> = true;
void _kinds_cover_union;

/**
 * Page-level signals extracted from the page's HTML — the inputs the classifier
 * needs that a bare HTTP status cannot provide. The fetcher produces these by
 * running {@link extract_markers_from_html} over the serialized rendered HTML
 * (`page.content()`, i.e. the DOM after JS has run); tests build them from static
 * HTML the same way. There is no separate in-page script — one regex extractor.
 */
export interface DomMarkers {
  /** A password input in the HTML — a same-URL login wall served with HTTP 200. */
  has_password_input: boolean;
  /** Tag-stripped text length; a login wall is short, an article long. */
  visible_text_length: number;
  /** Which known paywall container selectors/markers matched. */
  paywall_selector_hits: string[];
  /** schema.org `isAccessibleForFree`: the strongest paywall signal, or null. */
  jsonld_accessible_for_free: boolean | null;
  /** `<meta http-equiv="refresh">` target URL, if the page bounces, else null. */
  meta_refresh_target: string | null;
}

/** A normalized observation of one re-download attempt — the classifier input. */
export interface FetchObservation {
  /** The stored public URL we asked Chromium to navigate to. */
  requested_url: string;
  /** The URL navigation actually landed on, after redirects. */
  final_url: string;
  /** Final HTTP status, or null when no response arrived (DNS/timeout/reset). */
  http_status: number | null;
  /** Final response `content-type`, or null on transport failure. */
  content_type: string | null;
  /** Redirect hops, oldest first. */
  redirect_chain: { url: string; status: number }[];
  /**
   * Set when the fetch failed with no usable response (timeout, DNS, connection
   * reset, redirect loop). When set, the classifier short-circuits to dead_link
   * and ignores `content_type`, `dom_markers`, and `html`, which the fetcher
   * leaves as empty placeholders on this path.
   */
  transport_error: string | null;
  /** Signals extracted from the rendered HTML. */
  dom_markers: DomMarkers;
  /** The rendered HTML; empty string on transport failure. */
  html: string;
}

/**
 * Host/path signatures of identity providers and login pages. A re-download that
 * lands on one of these is an authenticated page behind the login wall.
 */
export const LOGIN_HOST_PATTERNS: readonly RegExp[] = [
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)login\./i,
  /(^|\.)signin\./i,
  /(^|\.)auth\./i,
  /(^|\.)okta\.com$/i,
  /(^|\.)auth0\.com$/i,
  /(^|\.)okta-emea\.com$/i,
  /(^|\.)microsoftonline\.com$/i,
];

/** Path fragments that mark a login/SSO endpoint regardless of host. */
export const LOGIN_PATH_PATTERNS: readonly RegExp[] = [
  /\/login(\/|$|\?)/i,
  /\/signin(\/|$|\?)/i,
  /\/sign[_-]?in(\/|$|\?)/i,
  /\/sso(\/|$|\?)/i,
  /\/oauth2?\/authorize/i,
  /\/saml/i,
  /\/account\/login/i,
];

/**
 * Below this many characters of visible text, a page bearing a password input is
 * treated as a login wall rather than an article that happens to embed a form.
 */
export const LOGIN_WALL_MAX_TEXT = 1500;

/** Returns the lower-cased host of a URL, or null if it cannot be parsed. */
export function host_of(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function matches_any(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

/** True when `url` points at a login/SSO/identity-provider endpoint. */
export function is_login_url(url: string): boolean {
  const host = host_of(url);
  if (host && matches_any(host, LOGIN_HOST_PATTERNS)) return true;
  try {
    return matches_any(new URL(url).pathname, LOGIN_PATH_PATTERNS);
  } catch {
    return false;
  }
}

/**
 * Decides whether an observation represents an auth wall. True when the page
 * redirected to (or bounces toward) a login endpoint the requested URL was not,
 * or renders a password form as its dominant content.
 */
export function is_auth_redirect(obs: FetchObservation): { hit: boolean; reason: string } {
  const requested_is_login = is_login_url(obs.requested_url);

  if (!requested_is_login && is_login_url(obs.final_url)) {
    return { hit: true, reason: `redirected to login url ${obs.final_url}` };
  }

  const refresh = obs.dom_markers.meta_refresh_target;
  if (refresh && !requested_is_login && is_login_url(refresh)) {
    return { hit: true, reason: `meta-refresh to login url ${refresh}` };
  }

  for (const hop of obs.redirect_chain) {
    if (!requested_is_login && is_login_url(hop.url)) {
      return { hit: true, reason: `redirect hop through login url ${hop.url}` };
    }
  }

  if (
    obs.dom_markers.has_password_input &&
    obs.dom_markers.visible_text_length < LOGIN_WALL_MAX_TEXT
  ) {
    return { hit: true, reason: "rendered a password form as dominant content" };
  }

  return { hit: false, reason: "" };
}

/**
 * Decides whether an observation represents a paywall. Conservative: requires a
 * structured signal (schema.org `isAccessibleForFree:false`) or a known paywall
 * container, never mere presence of the word "subscribe".
 */
export function is_paywalled(obs: FetchObservation): { hit: boolean; reason: string } {
  if (obs.dom_markers.jsonld_accessible_for_free === false) {
    return { hit: true, reason: "schema.org isAccessibleForFree is false" };
  }
  if (obs.dom_markers.paywall_selector_hits.length > 0) {
    return {
      hit: true,
      reason: `paywall markers: ${obs.dom_markers.paywall_selector_hits.join(", ")}`,
    };
  }
  return { hit: false, reason: "" };
}

function is_html_content_type(content_type: string | null): boolean {
  if (!content_type) return true; // assume HTML when the server omitted the type
  const lower = content_type.toLowerCase();
  return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

/**
 * Classifies a re-download observation into a {@link FetchOutcome}. The order of
 * the checks is load-bearing: transport failure, then HTTP status, then content
 * type, then auth, then paywall, then success.
 */
export function classify_fetch(obs: FetchObservation): FetchOutcome {
  if (obs.transport_error) {
    return {
      kind: "dead_link",
      http_status: obs.http_status,
      reason: obs.transport_error,
    };
  }

  const status = obs.http_status;
  if (status === 401 || status === 403) {
    return { kind: "forbidden", http_status: status, reason: `http ${status}` };
  }
  if (status === 404 || status === 410) {
    return { kind: "dead_link", http_status: status, reason: `http ${status}` };
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return { kind: "dead_link", http_status: status, reason: `http ${status}` };
  }

  if (!is_html_content_type(obs.content_type)) {
    return {
      kind: "non_html",
      content_type: obs.content_type ?? "unknown",
      http_status: status,
      reason: `non-html content type ${obs.content_type}`,
    };
  }

  const auth = is_auth_redirect(obs);
  if (auth.hit) {
    return {
      kind: "auth_redirect",
      final_url: obs.final_url,
      http_status: status,
      reason: auth.reason,
    };
  }

  const paywall = is_paywalled(obs);
  if (paywall.hit) {
    return {
      kind: "paywall",
      final_url: obs.final_url,
      http_status: status ?? 200,
      reason: paywall.reason,
    };
  }

  return {
    kind: "ok",
    html: obs.html,
    final_url: obs.final_url,
    http_status: status ?? 200,
  };
}

/** Known paywall container markers, as case-insensitive substrings/attributes. */
const PAYWALL_MARKERS: readonly { label: string; re: RegExp }[] = [
  { label: "data-paywall", re: /\sdata-paywall(\s|=|>)/i },
  { label: "class~=paywall", re: /class\s*=\s*["'][^"']*\bpaywall\b/i },
  { label: "id~=paywall", re: /id\s*=\s*["'][^"']*paywall/i },
  { label: "tp-modal", re: /class\s*=\s*["'][^"']*\btp-modal\b/i },
  { label: "meteredContent", re: /class\s*=\s*["'][^"']*\bmeteredContent\b/i },
  { label: "regwall", re: /class\s*=\s*["'][^"']*\bregwall\b/i },
  { label: "subscription-required", re: /class\s*=\s*["'][^"']*\bsubscription-required\b/i },
  { label: "content_tier=locked", re: /content_tier["'][^>]*content\s*=\s*["']locked/i },
];

/**
 * Extracts {@link DomMarkers} from an HTML string with light regex scans. This is
 * the single marker extractor: the headless fetcher calls it on the serialized
 * rendered HTML (`page.content()`), and the classifier's unit tests call it on
 * static fixture HTML. It pulls in no DOM/HTML-parser dependency.
 */
export function extract_markers_from_html(html: string): DomMarkers {
  const has_password_input = /<input\b[^>]*\btype\s*=\s*["']?password\b/i.test(html);

  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const paywall_selector_hits = PAYWALL_MARKERS.filter((m) => m.re.test(html)).map(
    (m) => m.label
  );

  let jsonld_accessible_for_free: boolean | null = null;
  if (/["']isAccessibleForFree["']\s*:\s*(false|"false"|"False")/i.test(html)) {
    jsonld_accessible_for_free = false;
  } else if (/["']isAccessibleForFree["']\s*:\s*(true|"true"|"True")/i.test(html)) {
    jsonld_accessible_for_free = true;
  }

  let meta_refresh_target: string | null = null;
  const refresh = html.match(
    /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"']+)/i
  );
  if (refresh) meta_refresh_target = refresh[1].trim();

  return {
    has_password_input,
    visible_text_length: text.length,
    paywall_selector_hits,
    jsonld_accessible_for_free,
    meta_refresh_target,
  };
}
