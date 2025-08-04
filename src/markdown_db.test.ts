import { promises as fs } from "fs";
import { MarkdownDatabase, WebpageTreeNodeCollectionSpec } from "./markdown_db";
import { WebpageTreeNode } from "./webpage_tree_models";

describe("MarkdownDatabase", () => {
  let tempFile: string;
  let db: MarkdownDatabase;

  beforeEach(async () => {
    tempFile = `/tmp/test-markdown-db-${Date.now()}.md`;
    db = new MarkdownDatabase(tempFile);

    // Initialize with basic structure including the proper heading
    await fs.writeFile(
      tempFile,
      `# Test Document

## Webpages

`
    );
  });

  afterEach(async () => {
    try {
      await fs.unlink(tempFile);
    } catch (error) {
      // File might not exist, ignore error
    }
  });

  describe("upsert WebpageTreeNode", () => {
    it("should add blank line between heading and first list entry", async () => {
      const test_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/blank-line-test",
          page_loaded_at: "2024-01-15T15:00:00.000Z",
          analysis: {
            title: "Blank Line Test Page",
            summary: "Testing blank line formatting.",
          },
        },
      };

      await db.upsert(WebpageTreeNodeCollectionSpec, test_node, "## Webpages");
      await db.save();

      const content = await fs.readFile(tempFile, "utf8");

      // Check that there's a blank line between heading and first list entry
      expect(content).toContain("## Webpages\n\n- [Blank Line Test Page]");

      // Also check the full expected format
      const expectedContent = `# Test Document

## Webpages

- [Blank Line Test Page](https://example.com/blank-line-test) [2024-01-15 15:00]
  - Summary: Testing blank line formatting.

`;
      expect(content).toEqual(expectedContent);
    });

    it("should replace tree based on head node match (URL), not entire content", async () => {
      // Test data - single page node tree
      const single_page_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://developers.googleblog.com/en/gemini-2-5-thinking-model-updates/",
          page_loaded_at: "2024-01-15T10:30:00.000Z",
          analysis: {
            title:
              "Gemini 2.5 Thinking Models Update: New Flash-Lite Preview, Pricing, and Stability",
            summary:
              "Google announces Gemini 2.5 model updates: stable Gemini 2.5 Pro and Flash, new Flash-Lite preview with low latency and cost, updated Flash pricing, and enhanced reasoning capabilities for developers.",
            intentions: [
              "Learn about the latest Gemini 2.5 AI model updates and features",
              "Understand pricing changes for Gemini 2.5 Flash model",
              "Explore new Gemini 2.5 Flash-Lite preview for cost-effective, high-throughput tasks",
              "Evaluate which Gemini 2.5 model suits specific development needs",
              "Stay informed on Google AI model offerings for integration and development",
            ],
          },
        },
      };

      // Test data - two page node tree (same root, but with child) - should replace the single page
      const two_page_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://developers.googleblog.com/en/gemini-2-5-thinking-model-updates/",
          page_loaded_at: "2024-01-15T10:30:00.000Z", // Same timestamp as single_page_node
          analysis: {
            title:
              "Gemini 2.5 Thinking Models Update: New Flash-Lite Preview, Pricing, and Stability",
            summary:
              "Google announces Gemini 2.5 model updates: stable Gemini 2.5 Pro and Flash, new Flash-Lite preview with low latency and cost, updated Flash pricing, and enhanced reasoning capabilities for developers.",
          },
          tree_intentions: [
            "Learn about the latest Gemini 2.5 AI model updates and features",
            "Understand pricing changes for Gemini 2.5 Flash model",
            "Explore new Gemini 2.5 Flash-Lite preview for cost-effective, high-throughput tasks",
            "Evaluate which Gemini 2.5 model suits specific development needs",
            "Stay informed on Google AI model offerings for integration and development",
          ],
        },
        children: [
          {
            webpage_session: {
              url: "https://developers.googleblog.com/en/search/?author=Logan+Kilpatrick",
              page_loaded_at: "2024-01-15T10:35:00.000Z", // Different timestamp for child
              analysis: {
                title:
                  "Posts by Logan Kilpatrick on Gemini AI Models and API Updates",
                summary:
                  "Logan Kilpatrick's posts detail updates and features of Google's Gemini AI models and API, including new versions, performance improvements, caching, multimodal capabilities, and integration with Google Search and OpenAI Library.",
                intentions: [
                  "Learn about the latest Gemini AI model releases and updates",
                  "Understand new features and performance enhancements in Gemini API",
                  "Explore Gemini's multimodal AI applications and capabilities",
                  "Discover integration options with Google AI Studio and OpenAI Library",
                  "Evaluate cost-saving features like implicit caching in Gemini API",
                  "Stay informed on Google's AI development tools and offerings",
                ],
              },
            },
          },
        ],
      };

      // First upsert - should insert the single page node
      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        single_page_node,
        "## Webpages"
      );
      await db.save();

      // Read and verify the first insertion
      let content = await fs.readFile(tempFile, "utf8");

      const expectedFirstContent = `# Test Document

## Webpages

${WebpageTreeNodeCollectionSpec.toMarkdown(single_page_node).join("\n")}

`;
      expect(content).toEqual(expectedFirstContent);

      // Second upsert - should replace the single page node with the two page node because they have the same head
      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        two_page_node,
        "## Webpages"
      );
      await db.save();

      // Read and verify the replacement
      content = await fs.readFile(tempFile, "utf8");

      const expectedSecondContent = `# Test Document

## Webpages

${WebpageTreeNodeCollectionSpec.toMarkdown(two_page_node).join("\n")}

`;
      expect(content).toEqual(expectedSecondContent);
    });

    it("should replace when exact same content is upserted", async () => {
      const same_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/test",
          page_loaded_at: "2024-01-15T11:00:00.000Z",
          analysis: {
            title: "Test Page",
            summary: "This is a test page summary.",
          },
        },
      };

      // Insert the node twice - second time should replace, not add
      await db.upsert(WebpageTreeNodeCollectionSpec, same_node, "## Webpages");
      await db.save();

      let content = await fs.readFile(tempFile, "utf8");

      const expectedContent = `# Test Document

## Webpages

${WebpageTreeNodeCollectionSpec.toMarkdown(same_node).join("\n")}

`;
      expect(content).toEqual(expectedContent);

      // Upsert the exact same node again
      await db.upsert(WebpageTreeNodeCollectionSpec, same_node, "## Webpages");
      await db.save();

      content = await fs.readFile(tempFile, "utf8");
      expect(content).toEqual(expectedContent); // Should be exactly the same
    });

    it("should insert new node when no matching node exists", async () => {
      const new_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/test",
          page_loaded_at: "2024-01-15T12:00:00.000Z",
          analysis: {
            title: "Test Page",
            summary: "This is a test page summary.",
          },
        },
      };

      await db.upsert(WebpageTreeNodeCollectionSpec, new_node, "## Webpages");
      await db.save();

      const content = await fs.readFile(tempFile, "utf8");

      const expectedContent = `# Test Document

## Webpages

${WebpageTreeNodeCollectionSpec.toMarkdown(new_node).join("\n")}

`;
      expect(content).toEqual(expectedContent);
    });

    it("should handle nodes without analysis gracefully", async () => {
      const minimal_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/minimal",
          page_loaded_at: "2024-01-15T13:00:00.000Z",
        },
      };

      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        minimal_node,
        "## Webpages"
      );
      await db.save();

      const content = await fs.readFile(tempFile, "utf8");

      const expectedContent = `# Test Document

## Webpages

${WebpageTreeNodeCollectionSpec.toMarkdown(minimal_node).join("\n")}

`;
      expect(content).toEqual(expectedContent);
    });

    it("should match based on timestamp - same timestamp replaces, different timestamp adds", async () => {
      // First node with specific timestamp
      const first_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/timestamp-test",
          page_loaded_at: "2024-01-15T14:00:00.000Z",
          analysis: {
            title: "Timestamp Test Page",
            summary: "First version of the page",
          },
        },
      };

      // Second node with SAME timestamp (should replace)
      const same_timestamp_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/timestamp-test",
          page_loaded_at: "2024-01-15T14:00:00.000Z", // Same timestamp
          analysis: {
            title: "Timestamp Test Page",
            summary: "Updated version of the page",
          },
        },
      };

      // Third node with DIFFERENT timestamp (should add new entry)
      const different_timestamp_node: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/timestamp-test",
          page_loaded_at: "2024-01-15T14:01:00.000Z", // 1 minute later
          analysis: {
            title: "Timestamp Test Page",
            summary: "Later version of the page",
          },
        },
      };

      // Insert first node
      await db.upsert(WebpageTreeNodeCollectionSpec, first_node, "## Webpages");
      await db.save();

      let content = await fs.readFile(tempFile, "utf8");
      expect(content).toContain("First version of the page");

      // Count occurrences of the title
      let title_matches = content.match(/Timestamp Test Page/g);
      expect(title_matches).toHaveLength(1);

      // Upsert with same timestamp - should replace
      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        same_timestamp_node,
        "## Webpages"
      );
      await db.save();

      content = await fs.readFile(tempFile, "utf8");
      expect(content).toContain("Updated version of the page");
      expect(content).not.toContain("First version of the page"); // Should be replaced

      // Still only one occurrence
      title_matches = content.match(/Timestamp Test Page/g);
      expect(title_matches).toHaveLength(1);

      // Upsert with different timestamp - should add new entry
      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        different_timestamp_node,
        "## Webpages"
      );
      await db.save();

      content = await fs.readFile(tempFile, "utf8");
      expect(content).toContain("Updated version of the page"); // First one still there
      expect(content).toContain("Later version of the page"); // New one added

      // Now should have two occurrences
      title_matches = content.match(/Timestamp Test Page/g);
      expect(title_matches).toHaveLength(2);
    });

    it("should include referrer URL when present", async () => {
      const node_with_referrer: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/landing-page",
          page_loaded_at: "2024-01-15T16:00:00.000Z",
          referrer: "https://google.com/search?q=test",
          analysis: {
            title: "Landing Page",
            summary: "A page visited from Google search",
          },
        },
      };

      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        node_with_referrer,
        "## Webpages"
      );
      await db.save();

      const content = await fs.readFile(tempFile, "utf8");

      expect(content).toContain("Landing Page");
      expect(content).toContain("Referrer: https://google.com/search?q=test");
      expect(content).toContain("A page visited from Google search");
    });

    it("should not include referrer when not present", async () => {
      const node_without_referrer: WebpageTreeNode = {
        webpage_session: {
          url: "https://example.com/direct-visit",
          page_loaded_at: "2024-01-15T17:00:00.000Z",
          referrer: null,
          analysis: {
            title: "Direct Visit Page",
            summary: "A page visited directly",
          },
        },
      };

      await db.upsert(
        WebpageTreeNodeCollectionSpec,
        node_without_referrer,
        "## Webpages"
      );
      await db.save();

      const content = await fs.readFile(tempFile, "utf8");

      expect(content).toContain("Direct Visit Page");
      expect(content).not.toContain("Referrer:");
      expect(content).toContain("A page visited directly");
    });
  });
});
