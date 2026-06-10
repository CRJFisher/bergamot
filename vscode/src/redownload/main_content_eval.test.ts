import { parse_page } from "./main_content";
import { MAIN_CONTENT_FIXTURES } from "./__fixtures__/main_content_fixtures";

/**
 * Main-content eval: over a committed fixture set of raw pages, asserts that a
 * single {@link parse_page} pass (1) derives the expected metadata and (2)
 * produces markdown that keeps the article body and prunes navigation/boilerplate
 * — measurably cleaner than the raw HTML. Fully deterministic and offline:
 * Defuddle runs with `useAsync: false`, so it reads no network.
 */
describe("main-content eval (deterministic, offline)", () => {
  it.each(MAIN_CONTENT_FIXTURES.map((f) => [f.name, f] as const))(
    "derives metadata and clean body for %s",
    async (_name, fixture) => {
      const { metadata, body_markdown } = await parse_page(
        fixture.html,
        fixture.url
      );

      expect(metadata).toEqual(fixture.expected_metadata);

      for (const present of fixture.expected_in_body) {
        expect(body_markdown).toContain(present);
      }
      for (const pruned of fixture.expected_pruned) {
        expect(body_markdown).not.toContain(pruned);
      }
    }
  );
});
