import * as vscode from "vscode";
import { WebpageHoverProvider } from "./webpage_hover_provider";
import { DuckDB, get_webpage_by_url } from "./duck_db";

jest.mock("./duck_db", () => ({
  get_webpage_by_url: jest.fn(),
}));

const mock_get_webpage_by_url = get_webpage_by_url as jest.MockedFunction<
  typeof get_webpage_by_url
>;

// provideHover reads only `document.lineAt(line).text`; this stub supplies that
// single accessor without standing up the full vscode.TextDocument surface.
function document_with_line(text: string): vscode.TextDocument {
  const stub = {
    lineAt: (): vscode.TextLine => ({ text } as vscode.TextLine),
  };
  return stub as Pick<vscode.TextDocument, "lineAt"> as vscode.TextDocument;
}

function hover_value(hover: vscode.Hover | undefined): string {
  if (!hover) {
    throw new Error("expected a hover");
  }
  const contents = hover.contents;
  if (!(contents instanceof vscode.MarkdownString)) {
    throw new Error("expected MarkdownString hover contents");
  }
  return contents.value;
}

describe("WebpageHoverProvider", () => {
  let provider: WebpageHoverProvider;
  const duck_db = {} as DuckDB;

  beforeEach(() => {
    mock_get_webpage_by_url.mockReset();
    provider = new WebpageHoverProvider(duck_db);
  });

  describe("URL extraction at cursor position", () => {
    it("extracts the target URL when hovering inside a markdown link", async () => {
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://example.com/page",
        title: "Example",
        visited_at: "2026-01-01T00:00:00Z",
      });
      const text = "see [the docs](https://example.com/page) for details";
      const url_index = text.indexOf("https://example.com/page");

      await provider.provideHover(
        document_with_line(text),
        new vscode.Position(0, url_index + 2)
      );

      expect(mock_get_webpage_by_url).toHaveBeenCalledWith(
        duck_db,
        "https://example.com/page"
      );
    });

    it("returns no hover when the cursor sits on the link label, not the URL", async () => {
      const text = "see [the docs](https://example.com/page)";
      const label_index = text.indexOf("the docs");

      const hover = await provider.provideHover(
        document_with_line(text),
        new vscode.Position(0, label_index)
      );

      expect(hover).toBeUndefined();
      expect(mock_get_webpage_by_url).not.toHaveBeenCalled();
    });

    it("extracts a bare URL when hovering a plain link", async () => {
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://plain.example.com/x",
        title: "Plain",
        visited_at: "2026-01-01T00:00:00Z",
      });
      const text = "visit https://plain.example.com/x today";
      const url_index = text.indexOf("https://plain.example.com/x");

      await provider.provideHover(
        document_with_line(text),
        new vscode.Position(0, url_index + 5)
      );

      expect(mock_get_webpage_by_url).toHaveBeenCalledWith(
        duck_db,
        "https://plain.example.com/x"
      );
    });

    it("returns no hover when the cursor is on non-link text", async () => {
      const hover = await provider.provideHover(
        document_with_line("just some prose with no links"),
        new vscode.Position(0, 5)
      );

      expect(hover).toBeUndefined();
      expect(mock_get_webpage_by_url).not.toHaveBeenCalled();
    });
  });

  describe("hover markdown rendering", () => {
    it("renders title, URL, and a formatted visit timestamp", async () => {
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://example.com/article",
        title: "My Article",
        visited_at: "2026-01-02T10:30:00Z",
      });

      const hover = await provider.provideHover(
        document_with_line("https://example.com/article"),
        new vscode.Position(0, 3)
      );

      const value = hover_value(hover);
      expect(value).toContain("My Article");
      expect(value).toContain("**URL:** https://example.com/article");
      const expected_date = new Date("2026-01-02T10:30:00Z");
      expect(value).toContain(expected_date.toLocaleDateString());
    });

    it("falls back to Untitled when the capture has no title", async () => {
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://example.com/no-title",
        title: "",
        visited_at: "2026-01-02T10:30:00Z",
      });

      const hover = await provider.provideHover(
        document_with_line("https://example.com/no-title"),
        new vscode.Position(0, 3)
      );

      expect(hover_value(hover)).toContain("Untitled");
    });

    it("omits the visited line when no timestamp is present", async () => {
      // A capture session with no recorded load timestamp surfaces as an empty
      // visited_at from the DB query's COALESCE/NULL handling.
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://example.com/no-date",
        title: "No Date",
        visited_at: "",
      });

      const hover = await provider.provideHover(
        document_with_line("https://example.com/no-date"),
        new vscode.Position(0, 3)
      );

      expect(hover_value(hover)).not.toContain("**Visited:**");
    });
  });

  describe("lookup outcomes", () => {
    it("returns no hover for a URL absent from the capture store", async () => {
      mock_get_webpage_by_url.mockResolvedValue(null);

      const hover = await provider.provideHover(
        document_with_line("https://example.com/missing"),
        new vscode.Position(0, 3)
      );

      expect(hover).toBeUndefined();
    });

    it("swallows lookup errors and returns no hover", async () => {
      const console_error = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      mock_get_webpage_by_url.mockRejectedValue(new Error("db down"));

      const hover = await provider.provideHover(
        document_with_line("https://example.com/boom"),
        new vscode.Position(0, 3)
      );

      expect(hover).toBeUndefined();
      console_error.mockRestore();
    });
  });

  describe("caching", () => {
    it("looks up a URL once and serves repeat hovers from cache", async () => {
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://example.com/cached",
        title: "Cached",
        visited_at: "2026-01-01T00:00:00Z",
      });
      const doc = document_with_line("https://example.com/cached");

      const first = await provider.provideHover(doc, new vscode.Position(0, 3));
      const second = await provider.provideHover(doc, new vscode.Position(0, 3));

      expect(mock_get_webpage_by_url).toHaveBeenCalledTimes(1);
      expect(hover_value(first)).toContain("Cached");
      expect(hover_value(second)).toContain("Cached");
    });

    it("caches a negative result and does not re-query a missing URL", async () => {
      mock_get_webpage_by_url.mockResolvedValue(null);
      const doc = document_with_line("https://example.com/absent");

      await provider.provideHover(doc, new vscode.Position(0, 3));
      const second = await provider.provideHover(doc, new vscode.Position(0, 3));

      expect(mock_get_webpage_by_url).toHaveBeenCalledTimes(1);
      expect(second).toBeUndefined();
    });

    it("re-queries after the cache is cleared", async () => {
      mock_get_webpage_by_url.mockResolvedValue({
        url: "https://example.com/recheck",
        title: "Recheck",
        visited_at: "2026-01-01T00:00:00Z",
      });
      const doc = document_with_line("https://example.com/recheck");

      await provider.provideHover(doc, new vscode.Position(0, 3));
      provider.clear_cache();
      await provider.provideHover(doc, new vscode.Position(0, 3));

      expect(mock_get_webpage_by_url).toHaveBeenCalledTimes(2);
    });
  });
});
