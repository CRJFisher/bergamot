/**
 * Deterministic, offline relevance gate. Decides keep/drop with NO LLM call and
 * NO main-content extraction.
 *
 * The gate is deliberately permissive: capture stores the raw page losslessly
 * and cheaply, and all quality/topic filtering belongs to the RAG-prep pipeline
 * (task-31). So it keeps essentially everything and drops only clearly-transient
 * interstitials — empty pages, auth/login pages, and redirect stubs — which
 * carry no durable content worth capturing.
 */

/** Outcome of the relevance gate for a single captured page. */
export interface GateDecision {
  /** Whether the page is kept (captured) or dropped. */
  keep: boolean;
  /**
   * Machine-readable outcome reason. `kept` when kept; otherwise the drop
   * cause: `content_empty`, `auth`, or `redirect`.
   */
  reason: string;
}

/** Host/path patterns of common auth / sign-in interstitials. */
// Each auth keyword must be a WHOLE path segment (terminated by /, ?, #, or end)
// so content slugs like /login-tips or /oauth-explained are NOT matched.
const AUTH_URL_PATTERN =
  /(^|\.)accounts\.google\.|(^|\.)login\.microsoftonline\.|(^|\.)appleid\.apple\.com|(^|\.)auth\d*\.|\/(login|log-in|signin|sign-in|sign_in|sso|oauth2?|authorize|authenticate)(\/|\?|#|$)/i;

/** A password input — an auth signal only when the page is essentially a form. */
const PASSWORD_INPUT_PATTERN = /<input\b[^>]*\btype\s*=\s*["']?password["']?/i;

/** Below this much visible text a page is treated as a bare interstitial, not content. */
const INTERSTITIAL_MAX_TEXT = 600;

/** A `<meta http-equiv="refresh" content="...url=...">` redirect directive. */
const META_REFRESH_PATTERN =
  /<meta\b[^>]*\bhttp-equiv\s*=\s*["']?refresh["']?[^>]*\bcontent\s*=\s*["'][^"']*url=/i;

/** A client-side `location` redirect (`location.replace/assign/href = ...`). */
const JS_REDIRECT_PATTERN =
  /\blocation\s*(\.\s*(replace|assign|href)\s*(\(|=)|=\s*["'])/i;

/** Strips scripts/styles/tags and collapses whitespace to visible text. */
function visible_text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the page is an auth / sign-in interstitial. An auth-host/path URL is
 * sufficient; a password field alone is treated as auth only on a content-light
 * page, so a real article whose chrome embeds a login/newsletter form is kept.
 */
function is_auth_interstitial(raw_page: string, text_length: number): boolean {
  return (
    PASSWORD_INPUT_PATTERN.test(raw_page) && text_length < INTERSTITIAL_MAX_TEXT
  );
}

/**
 * True when the page is a redirect stub: a near-empty body whose only job is a
 * meta-refresh or a client-side location change. A real page that merely carries
 * an auto-refresh is kept (it has substantial content).
 */
function is_redirect_stub(raw_page: string, text_length: number): boolean {
  if (text_length >= INTERSTITIAL_MAX_TEXT) return false;
  return (
    META_REFRESH_PATTERN.test(raw_page) || JS_REDIRECT_PATTERN.test(raw_page)
  );
}

/**
 * Evaluates the permissive relevance gate. Keeps the page unless it is empty or
 * a transient interstitial (auth / redirect). Never throws on unusual input.
 *
 * @param raw_page - The raw captured page
 * @param url - The page URL (used for auth-host/path detection)
 */
export function evaluate_page_gate(raw_page: string, url: string): GateDecision {
  if (raw_page.trim().length === 0) {
    return { keep: false, reason: "content_empty" };
  }
  const text_length = visible_text(raw_page).length;
  if (is_redirect_stub(raw_page, text_length)) {
    return { keep: false, reason: "redirect" };
  }
  if (
    AUTH_URL_PATTERN.test(url) ||
    is_auth_interstitial(raw_page, text_length)
  ) {
    return { keep: false, reason: "auth" };
  }
  return { keep: true, reason: "kept" };
}
