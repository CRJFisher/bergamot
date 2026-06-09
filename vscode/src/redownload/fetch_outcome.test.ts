import {
  classify_fetch,
  extract_markers_from_html,
  is_login_url,
  FetchObservation,
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

describe("is_login_url", () => {
  it("matches identity-provider hosts and login paths", () => {
    expect(is_login_url("https://accounts.google.com/o/oauth2/auth")).toBe(true);
    expect(is_login_url("https://login.microsoftonline.com/x")).toBe(true);
    expect(is_login_url("https://example.com/account/login?next=/x")).toBe(true);
    expect(is_login_url("https://example.com/articles/today")).toBe(false);
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
