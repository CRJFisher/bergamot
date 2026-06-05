import { evaluate_page_gate } from "./page_gate";
import { CAPTURE_FIXTURES } from "./__fixtures__/capture_fixtures";

/**
 * The capture gate: keep everything except transient interstitials
 * (empty / auth / redirect). Content-quality filtering is deferred to the
 * RAG-prep pipeline. Exercised over committed fixtures plus targeted cases.
 */
describe("evaluate_page_gate", () => {
  it.each(CAPTURE_FIXTURES.map((f) => [f.name, f] as const))(
    "matches the expected keep/drop label for %s",
    (_name, fixture) => {
      expect(evaluate_page_gate(fixture.html, fixture.url)).toEqual(
        fixture.expected_gate
      );
    }
  );

  it("drops empty / whitespace-only pages as content_empty", () => {
    expect(evaluate_page_gate("   \n\t  ", "https://x.test/")).toEqual({
      keep: false,
      reason: "content_empty",
    });
  });

  it("drops a login page (password input) as auth", () => {
    const html =
      "<html><body><form><input type='password' name='pw'></form></body></html>";
    expect(evaluate_page_gate(html, "https://x.test/account")).toEqual({
      keep: false,
      reason: "auth",
    });
  });

  it("drops an auth URL even without a password field (multi-step sign-in)", () => {
    const html = "<html><body><h1>Choose an account</h1></body></html>";
    expect(
      evaluate_page_gate(html, "https://accounts.google.com/o/oauth2/v2/auth")
    ).toEqual({ keep: false, reason: "auth" });
  });

  it("drops a meta-refresh redirect stub", () => {
    const html =
      '<html><head><meta http-equiv="refresh" content="0; url=/next"></head><body>Redirecting</body></html>';
    expect(evaluate_page_gate(html, "https://x.test/r")).toEqual({
      keep: false,
      reason: "redirect",
    });
  });

  it("drops a tiny JS location-change stub as redirect", () => {
    const html =
      "<html><body><script>location.replace('/next')</script></body></html>";
    expect(evaluate_page_gate(html, "https://x.test/r")).toEqual({
      keep: false,
      reason: "redirect",
    });
  });

  it("keeps a normal content page", () => {
    const html =
      "<html><body><article><p>Plenty of real prose here.</p></article></body></html>";
    expect(evaluate_page_gate(html, "https://x.test/post")).toEqual({
      keep: true,
    });
  });

  it("keeps a link-heavy page (nav/aggregator) — quality filtering is deferred", () => {
    const links = Array.from(
      { length: 30 },
      (_, i) => `<a href="/x${i}">link ${i}</a>`
    ).join("");
    const html = `<html><body><nav>${links}</nav></body></html>`;
    expect(evaluate_page_gate(html, "https://x.test/menu").keep).toBe(true);
  });

  it("keeps non-HTML / unusual content without throwing", () => {
    const json = JSON.stringify({ a: 1, b: "data" }).repeat(5);
    expect(evaluate_page_gate(json, "https://x.test/data.json").keep).toBe(true);
  });

  // Regression: a real article whose chrome embeds a login/newsletter password
  // field must not be dropped as auth.
  it("keeps a long article that merely contains a password input", () => {
    const body = "<p>" + "Genuine long-form article content. ".repeat(40) + "</p>";
    const html = `<html><body><article>${body}</article><footer><form><input type="password"></form></footer></body></html>`;
    expect(evaluate_page_gate(html, "https://blog.test/post").keep).toBe(true);
  });

  // Regression: an auth keyword as a slug prefix is content, not an auth page.
  it("keeps content URLs whose slug merely starts with an auth keyword", () => {
    const html = "<html><body><p>An explainer about OAuth flows.</p></body></html>";
    expect(evaluate_page_gate(html, "https://docs.test/oauth-explained").keep).toBe(true);
    expect(evaluate_page_gate(html, "https://docs.test/login-tips").keep).toBe(true);
  });

  // Regression: a full content page that carries an auto-refresh is kept.
  it("keeps a full content page that has a meta refresh", () => {
    const body = "<p>" + "Substantial dashboard content here. ".repeat(40) + "</p>";
    const html = `<html><head><meta http-equiv="refresh" content="30; url=/self"></head><body>${body}</body></html>`;
    expect(evaluate_page_gate(html, "https://app.test/dash").keep).toBe(true);
  });
});
