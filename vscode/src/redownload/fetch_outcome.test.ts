import {
  classify_fetch,
  extract_markers_from_html,
  is_login_url,
  is_retryable_outcome,
  FetchObservation,
  FetchOutcome,
  DomMarkers,
} from "./fetch_outcome";

const EMPTY_MARKERS: DomMarkers = {
  has_password_input: false,
  visible_text_length: 5000,
  paywall_selector_hits: [],
  jsonld_accessible_for_free: null,
  meta_refresh_target: null,
};

function observation(over: Partial<FetchObservation>): FetchObservation {
  return {
    requested_url: "https://example.com/article",
    final_url: "https://example.com/article",
    http_status: 200,
    content_type: "text/html; charset=utf-8",
    redirect_chain: [],
    transport_error: null,
    dom_markers: EMPTY_MARKERS,
    html: "<html><body>public article body</body></html>",
    ...over,
  };
}

describe("classify_fetch", () => {
  it("classifies a public 200 HTML page as ok and carries its content", () => {
    const out = classify_fetch(observation({}));
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.html).toContain("public article body");
      expect(out.final_url).toBe("https://example.com/article");
      expect(out.http_status).toBe(200);
    }
  });

  it("classifies 401/403 as forbidden with no content", () => {
    for (const status of [401, 403]) {
      const out = classify_fetch(observation({ http_status: status }));
      expect(out.kind).toBe("forbidden");
      expect("html" in out).toBe(false);
    }
  });

  it("classifies 404/410 and 5xx as dead_link", () => {
    for (const status of [404, 410, 500, 503]) {
      expect(classify_fetch(observation({ http_status: status })).kind).toBe(
        "dead_link"
      );
    }
  });

  it("classifies 429 (rate limited) as dead_link", () => {
    const out = classify_fetch(observation({ http_status: 429 }));
    expect(out.kind).toBe("dead_link");
    if (out.kind === "dead_link") {
      expect(out.http_status).toBe(429);
    }
  });

  it("treats a missing content-type as HTML and admits the page", () => {
    const out = classify_fetch(observation({ content_type: null }));
    expect(out.kind).toBe("ok");
  });

  it("classifies a transport failure as dead_link with null status", () => {
    const out = classify_fetch(
      observation({
        http_status: null,
        transport_error: "net::ERR_NAME_NOT_RESOLVED",
        html: "",
      })
    );
    expect(out.kind).toBe("dead_link");
    if (out.kind === "dead_link") {
      expect(out.http_status).toBeNull();
      expect(out.reason).toContain("ERR_NAME_NOT_RESOLVED");
    }
  });

  it("excludes non-HTML content types (e.g. PDF) as non_html", () => {
    const out = classify_fetch(
      observation({ content_type: "application/pdf" })
    );
    expect(out.kind).toBe("non_html");
    expect("html" in out).toBe(false);
  });

  it("classifies a cross-host redirect to a login page as auth_redirect", () => {
    const out = classify_fetch(
      observation({
        requested_url: "https://app.example.com/dashboard",
        final_url: "https://accounts.google.com/signin",
        redirect_chain: [
          { url: "https://app.example.com/dashboard", status: 302 },
        ],
      })
    );
    expect(out.kind).toBe("auth_redirect");
    expect("html" in out).toBe(false);
  });

  it("classifies a redirect hop through a login url as auth_redirect", () => {
    const out = classify_fetch(
      observation({
        requested_url: "https://app.example.com/dashboard",
        final_url: "https://app.example.com/dashboard",
        redirect_chain: [
          { url: "https://app.example.com/dashboard", status: 302 },
          { url: "https://sso.example.com/saml/login", status: 302 },
        ],
      })
    );
    expect(out.kind).toBe("auth_redirect");
    if (out.kind === "auth_redirect") {
      expect(out.reason).toContain("sso.example.com/saml/login");
    }
  });

  it("classifies a meta-refresh bounce to a login url as auth_redirect", () => {
    const out = classify_fetch(
      observation({
        dom_markers: {
          ...EMPTY_MARKERS,
          meta_refresh_target: "https://login.example.com/?next=/x",
        },
      })
    );
    expect(out.kind).toBe("auth_redirect");
    if (out.kind === "auth_redirect") {
      expect(out.reason).toContain("meta-refresh");
    }
  });

  it("does NOT flag auth when the requested url is itself a login endpoint", () => {
    const out = classify_fetch(
      observation({
        requested_url: "https://accounts.google.com/o/oauth2/auth",
        final_url: "https://accounts.google.com/o/oauth2/auth",
      })
    );
    expect(out.kind).toBe("ok");
  });

  it("classifies a same-URL password wall (200, short text) as auth_redirect", () => {
    const out = classify_fetch(
      observation({
        dom_markers: {
          ...EMPTY_MARKERS,
          has_password_input: true,
          visible_text_length: 120,
        },
      })
    );
    expect(out.kind).toBe("auth_redirect");
  });

  it("does NOT treat a long article with an embedded password field as a login wall", () => {
    const out = classify_fetch(
      observation({
        dom_markers: {
          ...EMPTY_MARKERS,
          has_password_input: true,
          visible_text_length: 8000,
        },
      })
    );
    expect(out.kind).toBe("ok");
  });

  it("classifies schema.org isAccessibleForFree:false as paywall", () => {
    const out = classify_fetch(
      observation({
        dom_markers: { ...EMPTY_MARKERS, jsonld_accessible_for_free: false },
      })
    );
    expect(out.kind).toBe("paywall");
    expect("html" in out).toBe(false);
  });

  it("classifies a known paywall container as paywall", () => {
    const out = classify_fetch(
      observation({
        dom_markers: {
          ...EMPTY_MARKERS,
          paywall_selector_hits: ["data-paywall"],
        },
      })
    );
    expect(out.kind).toBe("paywall");
  });

  it("prioritizes auth over paywall when both are present", () => {
    const out = classify_fetch(
      observation({
        final_url: "https://example.com/login",
        requested_url: "https://example.com/article",
        dom_markers: { ...EMPTY_MARKERS, jsonld_accessible_for_free: false },
      })
    );
    expect(out.kind).toBe("auth_redirect");
  });
});

describe("is_retryable_outcome", () => {
  const dead = (http_status: number | null): FetchOutcome => ({
    kind: "dead_link",
    http_status,
    reason: "x",
  });

  it("retries a transport failure (null status)", () => {
    expect(is_retryable_outcome(dead(null))).toBe(true);
  });

  it("retries 429 and 5xx dead links", () => {
    expect(is_retryable_outcome(dead(429))).toBe(true);
    expect(is_retryable_outcome(dead(500))).toBe(true);
    expect(is_retryable_outcome(dead(503))).toBe(true);
  });

  it("does not retry a permanently dead 404/410", () => {
    expect(is_retryable_outcome(dead(404))).toBe(false);
    expect(is_retryable_outcome(dead(410))).toBe(false);
  });

  it("never retries an auth, paywall, forbidden, non_html, or ok verdict", () => {
    const verdicts: FetchOutcome[] = [
      { kind: "ok", html: "<p>x</p>", final_url: "https://x", http_status: 200 },
      {
        kind: "auth_redirect",
        final_url: "https://login.x",
        http_status: 200,
        reason: "wall",
      },
      { kind: "forbidden", http_status: 403, reason: "http 403" },
      {
        kind: "paywall",
        final_url: "https://x",
        http_status: 200,
        reason: "locked",
      },
      {
        kind: "non_html",
        content_type: "application/pdf",
        http_status: 200,
        reason: "pdf",
      },
    ];
    for (const v of verdicts) {
      expect(is_retryable_outcome(v)).toBe(false);
    }
  });
});

describe("is_login_url", () => {
  it("matches identity-provider hosts and login paths", () => {
    expect(is_login_url("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(is_login_url("https://login.microsoftonline.com/x")).toBe(true);
    expect(is_login_url("https://example.com/account/login?next=/x")).toBe(true);
    expect(is_login_url("https://example.com/articles/today")).toBe(false);
  });

  it("matches sso, oauth-authorize, sign-in, and saml paths on any host", () => {
    expect(is_login_url("https://app.example.com/sso/start")).toBe(true);
    expect(is_login_url("https://app.example.com/oauth2/authorize")).toBe(true);
    expect(is_login_url("https://app.example.com/sign-in")).toBe(true);
    expect(is_login_url("https://app.example.com/saml/acs")).toBe(true);
  });

  it("matches okta and auth0 identity hosts", () => {
    expect(is_login_url("https://acme.okta.com/")).toBe(true);
    expect(is_login_url("https://acme.auth0.com/authorize")).toBe(true);
    expect(is_login_url("https://auth.acme.com/")).toBe(true);
  });

  it("returns false for an unparseable url", () => {
    expect(is_login_url("not a url")).toBe(false);
  });
});

describe("extract_markers_from_html", () => {
  it("detects a password input and short visible text", () => {
    const markers = extract_markers_from_html(
      `<html><body><form><input type="password" name="pw"></form>Sign in</body></html>`
    );
    expect(markers.has_password_input).toBe(true);
    expect(markers.visible_text_length).toBeLessThan(50);
  });

  it("does not over-count script/style as visible text", () => {
    const markers = extract_markers_from_html(
      `<html><head><style>.x{color:red}</style></head><body><script>var a=1;</script><p>Hello world</p></body></html>`
    );
    expect(markers.visible_text_length).toBe("Hello world".length);
  });

  it("reads schema.org isAccessibleForFree", () => {
    expect(
      extract_markers_from_html(`<script type="application/ld+json">{"isAccessibleForFree": false}</script>`)
        .jsonld_accessible_for_free
    ).toBe(false);
    expect(
      extract_markers_from_html(`<script>{"isAccessibleForFree":true}</script>`)
        .jsonld_accessible_for_free
    ).toBe(true);
  });

  it("detects paywall containers", () => {
    expect(
      extract_markers_from_html(`<div data-paywall>locked</div>`).paywall_selector_hits
    ).toContain("data-paywall");
    expect(
      extract_markers_from_html(`<div class="article paywall-overlay">x</div>`)
        .paywall_selector_hits
    ).toContain("class~=paywall");
  });

  it("reads a meta-refresh target", () => {
    expect(
      extract_markers_from_html(
        `<meta http-equiv="refresh" content="0; url=https://example.com/login">`
      ).meta_refresh_target
    ).toBe("https://example.com/login");
  });

  it("leaves the meta-refresh target null when there is no refresh tag", () => {
    expect(
      extract_markers_from_html(`<html><body><p>plain page</p></body></html>`)
        .meta_refresh_target
    ).toBeNull();
  });

  it("leaves markers empty for a clean article", () => {
    const markers = extract_markers_from_html(
      `<html lang="en"><head><title>News</title></head><body><article>${"word ".repeat(
        400
      )}</article></body></html>`
    );
    expect(markers.has_password_input).toBe(false);
    expect(markers.paywall_selector_hits).toEqual([]);
    expect(markers.jsonld_accessible_for_free).toBeNull();
    expect(markers.visible_text_length).toBeGreaterThan(1500);
  });
});
