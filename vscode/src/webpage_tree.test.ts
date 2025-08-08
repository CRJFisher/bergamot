import { DuckDB, get_page_sessions_with_tree_id } from "./duck_db";
import {
  insert_page_activity_session_with_tree_management,
  get_tree_with_id,
} from "./webpage_tree";
import {
  PageActivitySessionWithoutTreeOrContent,
} from "./duck_db_models";
import {
  PageActivitySessionWithMeta
} from "./reconcile_webpage_trees_workflow_models";
import * as hash_utils from "./hash_utils";

jest.mock("./hash_utils");

const mock_md5_hash = jest.spyOn(hash_utils, "md5_hash");

describe("Webpage Tree Management", () => {
  let db: DuckDB;
  let memory_db: any; // Mock memory store

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    mock_md5_hash.mockClear();
    mock_md5_hash.mockImplementation((input) => {
      // Default implementation that generates unique IDs
      return `tree-${input}-${Date.now()}-${Math.random()}`;
    });

    // Create a mock memory_db
    memory_db = {
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn(),
      search: jest.fn().mockResolvedValue([]),
    };
  });

  afterEach(async () => {
    await db.close();
  });

  describe("insert_page_activity_session_with_tree_management", () => {
    const base_session: PageActivitySessionWithoutTreeOrContent = {
      id: "test-session-id",
      url: "https://example.com/page",
      referrer: null,
      page_loaded_at: "2025-01-01T00:00:00Z",
    };

    describe("when session has no referrer", () => {
      it("should create a new tree as root", async () => {
        const session = { ...base_session, referrer: null };
        mock_md5_hash.mockReturnValueOnce("new-tree-id");

        const result = await insert_page_activity_session_with_tree_management(
          db,
          session
        );

        expect(result).toEqual({
          tree_id: "new-tree-id",
          was_tree_changed: true,
        });
        expect(mock_md5_hash).toHaveBeenCalledWith(
          `${session.url}:${session.page_loaded_at}`
        );

        // Verify tree was created in database
        const tree = await db.query_first(
          "SELECT * FROM webpage_trees WHERE id = $id",
          { id: "new-tree-id" }
        );
        expect(tree).toBeDefined();
      });

      it("should skip aggregator URLs", async () => {
        const aggregator_urls = [
          "https://news.ycombinator.com",
          "https://www.google.com",
          "https://www.reddit.com",
          "https://www.facebook.com",
          "https://www.twitter.com",
          "https://www.youtube.com"
        ];

        for (const url of aggregator_urls) {
          const aggregator_session = {
            ...base_session,
            url,
            referrer: null,
          };

          const result = await insert_page_activity_session_with_tree_management(
            db,
            aggregator_session
          );

          expect(result).toEqual({
            tree_id: null,
            was_tree_changed: false,
          });
        }
      });

      it("should handle aggregator URLs with trailing slash", async () => {
        const session = {
          ...base_session,
          url: "https://news.ycombinator.com/",
          referrer: null,
        };

        const result = await insert_page_activity_session_with_tree_management(
          db,
          session
        );

        expect(result).toEqual({
          tree_id: null,
          was_tree_changed: false,
        });
      });
    });

    describe("when session has referrer", () => {
      const session_with_referrer: PageActivitySessionWithoutTreeOrContent = {
        ...base_session,
        referrer: "https://example.com/referrer",
      };

      it("should add to existing tree when referrer found", async () => {
        // First, insert a session that will be the referrer
        const referrer_session: PageActivitySessionWithoutTreeOrContent = {
          id: "referrer-session-id",
          url: "https://example.com/referrer",
          referrer: null,
          page_loaded_at: "2024-12-31T23:55:00Z", // 5 minutes earlier
        };

        // Use mockReturnValue instead of mockReturnValueOnce for consistency
        mock_md5_hash.mockReturnValue("existing-tree-id-1");

        // Insert the referrer session first
        await insert_page_activity_session_with_tree_management(
          db,
          referrer_session
        );

        // Now insert the session with referrer
        const result = await insert_page_activity_session_with_tree_management(
          db,
          session_with_referrer
        );

        expect(result).toEqual({
          tree_id: "existing-tree-id-1",
          was_tree_changed: true,
        });

        // Verify the session was added with correct referrer
        const session = await db.query_first<any>(
          "SELECT * FROM webpage_activity_sessions WHERE id = $id",
          { id: "test-session-id" }
        );
        expect(session?.tree_id).toBe("existing-tree-id-1");
        expect(session?.referrer_page_session_id).toBe("referrer-session-id");
      });

      it("should create new tree when referrer not found (phantom referrer)", async () => {
        mock_md5_hash.mockReturnValueOnce("phantom-tree-id");

        const result = await insert_page_activity_session_with_tree_management(
          db,
          session_with_referrer
        );

        expect(result).toEqual({
          tree_id: "phantom-tree-id",
          was_tree_changed: true,
        });
      });

      it("should handle fuzzy URL matching for referrer", async () => {
        // Insert a session with full URL including query params
        const referrer_session: PageActivitySessionWithoutTreeOrContent = {
          id: "referrer-session-id",
          url: "https://example.com/page?query=test&param=value",
          referrer: null,
          page_loaded_at: "2024-12-31T23:55:00Z",
        };

        mock_md5_hash.mockReturnValue("fuzzy-tree-id");
        await insert_page_activity_session_with_tree_management(
          db,
          referrer_session
        );

        // Session with truncated referrer (simulating referrer policy)
        const session = {
          ...base_session,
          referrer: "https://example.com/page", // Truncated URL
        };

        const result = await insert_page_activity_session_with_tree_management(
          db,
          session
        );

        expect(result.tree_id).toBe("fuzzy-tree-id");
        expect(result.was_tree_changed).toBe(true);
      });
    });

    describe("error handling", () => {
      it("should handle database errors gracefully", async () => {
        // Close database to simulate error
        await db.close();

        const session = { ...base_session };
        
        await expect(
          insert_page_activity_session_with_tree_management(db, session)
        ).rejects.toThrow();
      });

      it("should handle invalid session data", async () => {
        const invalid_session = {
          id: null, // Invalid: null ID
          url: "https://example.com",
          referrer: null,
          page_loaded_at: "2025-01-01T00:00:00Z",
        } as any;

        await expect(
          insert_page_activity_session_with_tree_management(db, invalid_session)
        ).rejects.toThrow();
      });
    });
  });

  describe("get_tree_with_id", () => {
    beforeEach(async () => {
      // Setup test tree and sessions
      await db.execute(
        `INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) 
         VALUES ($id, $first_load_time, $latest_activity_time)`,
        {
          id: "test-tree-id",
          first_load_time: "2025-01-01T00:00:00Z",
          latest_activity_time: "2025-01-01T03:00:00Z",
        }
      );
    });

    it("should build a simple tree with root only", async () => {
      const root_session = {
        id: "root-session",
        url: "https://example.com/root",
        referrer: null,
        referrer_page_session_id: null,
        page_loaded_at: "2025-01-01T00:00:00Z",
        tree_id: "test-tree-id",
      };

      await db.execute(
        `INSERT INTO webpage_activity_sessions 
         (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
         VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
        root_session
      );

      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "test-tree-id"
      );
      const tree = get_tree_with_id(tree_members);

      expect(tree).toBeDefined();
      expect(tree.webpage_session.id).toBe("root-session");
      expect(tree.children).toHaveLength(0);
    });

    it("should build a tree with multiple levels", async () => {
      // Insert root and children
      const sessions = [
        {
          id: "root",
          url: "https://example.com/",
          referrer: null,
          referrer_page_session_id: null,
          page_loaded_at: "2025-01-01T00:00:00Z",
          tree_id: "test-tree-id",
        },
        {
          id: "child1",
          url: "https://example.com/child1",
          referrer: "https://example.com/",
          referrer_page_session_id: "root",
          page_loaded_at: "2025-01-01T00:30:00Z",
          tree_id: "test-tree-id",
        },
        {
          id: "child2",
          url: "https://example.com/child2",
          referrer: "https://example.com/",
          referrer_page_session_id: "root",
          page_loaded_at: "2025-01-01T01:00:00Z",
          tree_id: "test-tree-id",
        },
        {
          id: "grandchild1",
          url: "https://example.com/grandchild1",
          referrer: "https://example.com/child1",
          referrer_page_session_id: "child1",
          page_loaded_at: "2025-01-01T01:30:00Z",
          tree_id: "test-tree-id",
        },
      ];

      for (const session of sessions) {
        await db.execute(
          `INSERT INTO webpage_activity_sessions 
           (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
           VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
          session
        );
      }

      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "test-tree-id"
      );
      const tree = get_tree_with_id(tree_members);

      expect(tree.webpage_session.id).toBe("root");
      expect(tree.children).toHaveLength(2);
      expect(tree.children[0].webpage_session.id).toBe("child1");
      expect(tree.children[1].webpage_session.id).toBe("child2");
      expect(tree.children[0].children).toHaveLength(1);
      expect(tree.children[0].children[0].webpage_session.id).toBe("grandchild1");
    });

    it("should handle tree with split (orphaned branch)", async () => {
      // Create a tree that has been split - where a child's parent is not in the tree
      const sessions = [
        {
          id: "new-root",
          url: "https://example.com/new",
          referrer: "https://external.com", // External referrer
          referrer_page_session_id: "external-session", // Not in this tree
          page_loaded_at: "2025-01-01T00:00:00Z",
          tree_id: "test-tree-id",
        },
        {
          id: "child",
          url: "https://example.com/child",
          referrer: "https://example.com/new",
          referrer_page_session_id: "new-root",
          page_loaded_at: "2025-01-01T00:30:00Z",
          tree_id: "test-tree-id",
        },
      ];

      for (const session of sessions) {
        await db.execute(
          `INSERT INTO webpage_activity_sessions 
           (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
           VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
          session
        );
      }

      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "test-tree-id"
      );
      const tree = get_tree_with_id(tree_members);

      // Should treat new-root as root since its parent is not in the tree
      expect(tree.webpage_session.id).toBe("new-root");
      expect(tree.children).toHaveLength(1);
      expect(tree.children[0].webpage_session.id).toBe("child");
    });

    it("should throw error when no root node can be identified", async () => {
      // Create circular reference (impossible in real scenario but tests error handling)
      const sessions = [
        {
          id: "session1",
          url: "https://example.com/1",
          referrer: "https://example.com/2",
          referrer_page_session_id: "session2",
          page_loaded_at: "2025-01-01T00:00:00Z",
          tree_id: "test-tree-id",
        },
        {
          id: "session2",
          url: "https://example.com/2",
          referrer: "https://example.com/1",
          referrer_page_session_id: "session1",
          page_loaded_at: "2025-01-01T00:30:00Z",
          tree_id: "test-tree-id",
        },
      ];

      for (const session of sessions) {
        await db.execute(
          `INSERT INTO webpage_activity_sessions 
           (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
           VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
          session
        );
      }

      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "test-tree-id"
      );

      expect(() => get_tree_with_id(tree_members)).toThrow(
        "No root node found for tree_members"
      );
    });

    it("should build tree with metadata (analysis and intentions)", async () => {
      // Insert session with analysis
      await db.execute(
        `INSERT INTO webpage_activity_sessions 
         (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
         VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
        {
          id: "session-with-meta",
          url: "https://example.com/analyzed",
          referrer: null,
          referrer_page_session_id: null,
          page_loaded_at: "2025-01-01T00:00:00Z",
          tree_id: "test-tree-id",
        }
      );

      // Add analysis data
      await db.execute(
        `INSERT INTO webpage_analysis 
         (page_session_id, title, summary, intentions)
         VALUES ($id, $title, $summary, $intentions)`,
        {
          id: "session-with-meta",
          title: "Analyzed Page",
          summary: "This page has been analyzed",
          intentions: JSON.stringify(["learn", "research"]),
        }
      );

      // Add tree intentions
      await db.execute(
        `INSERT INTO webpage_tree_intentions 
         (tree_id, activity_session_id, intentions)
         VALUES ($tree_id, $session_id, $intentions)`,
        {
          tree_id: "test-tree-id",
          session_id: "session-with-meta",
          intentions: JSON.stringify(["explore"]),
        }
      );

      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "test-tree-id"
      );
      const tree = get_tree_with_id(tree_members);

      expect(tree.webpage_session.id).toBe("session-with-meta");
      
      // Cast to PageActivitySessionWithMeta to access metadata
      const session_with_meta = tree.webpage_session as PageActivitySessionWithMeta;
      expect(session_with_meta.analysis?.title).toBe("Analyzed Page");
      expect(session_with_meta.analysis?.intentions).toEqual(["learn", "research"]);
      expect(session_with_meta.tree_intentions).toEqual(["explore"]);
    });

    it("should handle empty tree members array", async () => {
      const empty_tree_members: PageActivitySessionWithMeta[] = [];
      
      expect(() => get_tree_with_id(empty_tree_members)).toThrow(
        "No root node found for tree_members"
      );
    });

    it("should build complex tree with multiple branches", async () => {
      // Create a more complex tree structure
      const sessions = [
        { id: "r", referrer_page_session_id: null },
        { id: "a", referrer_page_session_id: "r" },
        { id: "b", referrer_page_session_id: "r" },
        { id: "c", referrer_page_session_id: "r" },
        { id: "a1", referrer_page_session_id: "a" },
        { id: "a2", referrer_page_session_id: "a" },
        { id: "b1", referrer_page_session_id: "b" },
        { id: "a1a", referrer_page_session_id: "a1" },
        { id: "a1b", referrer_page_session_id: "a1" },
      ];

      for (const session of sessions) {
        await db.execute(
          `INSERT INTO webpage_activity_sessions 
           (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
           VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
          {
            id: session.id,
            url: `https://example.com/${session.id}`,
            referrer: session.referrer_page_session_id 
              ? `https://example.com/${session.referrer_page_session_id}` 
              : null,
            referrer_page_session_id: session.referrer_page_session_id,
            page_loaded_at: "2025-01-01T00:00:00Z",
            tree_id: "test-tree-id",
          }
        );
      }

      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "test-tree-id"
      );
      const tree = get_tree_with_id(tree_members);

      // Verify tree structure
      expect(tree.webpage_session.id).toBe("r");
      expect(tree.children).toHaveLength(3); // a, b, c
      
      const child_a = tree.children.find(c => c.webpage_session.id === "a");
      expect(child_a?.children).toHaveLength(2); // a1, a2
      
      const child_a1 = child_a?.children.find(c => c.webpage_session.id === "a1");
      expect(child_a1?.children).toHaveLength(2); // a1a, a1b
      
      const child_b = tree.children.find(c => c.webpage_session.id === "b");
      expect(child_b?.children).toHaveLength(1); // b1
      
      const child_c = tree.children.find(c => c.webpage_session.id === "c");
      expect(child_c?.children).toHaveLength(0); // no children
    });
  });

  describe("performance and edge cases", () => {
    it("should handle large trees efficiently", async () => {
      // Create a large tree with many nodes
      const num_nodes = 100;
      
      await db.execute(
        `INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) 
         VALUES ($id, $first_load_time, $latest_activity_time)`,
        {
          id: "large-tree",
          first_load_time: "2025-01-01T00:00:00Z",
          latest_activity_time: "2025-01-01T10:00:00Z",
        }
      );

      // Insert root
      await db.execute(
        `INSERT INTO webpage_activity_sessions 
         (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
         VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
        {
          id: "node-0",
          url: "https://example.com/0",
          referrer: null,
          referrer_page_session_id: null,
          page_loaded_at: "2025-01-01T00:00:00Z",
          tree_id: "large-tree",
        }
      );

      // Insert many children
      for (let i = 1; i < num_nodes; i++) {
        const parent_id = `node-${Math.floor(i / 3)}`; // Each node has ~3 children
        await db.execute(
          `INSERT INTO webpage_activity_sessions 
           (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
           VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
          {
            id: `node-${i}`,
            url: `https://example.com/${i}`,
            referrer: `https://example.com/${Math.floor(i / 3)}`,
            referrer_page_session_id: parent_id,
            page_loaded_at: `2025-01-01T00:${i % 60}:00Z`,
            tree_id: "large-tree",
          }
        );
      }

      const start_time = Date.now();
      const tree_members = await get_page_sessions_with_tree_id(
        db,
        memory_db,
        "large-tree"
      );
      const tree = get_tree_with_id(tree_members);
      const elapsed_time = Date.now() - start_time;

      expect(tree).toBeDefined();
      expect(tree.webpage_session.id).toBe("node-0");
      expect(elapsed_time).toBeLessThan(1000); // Should complete in under 1 second
    });

    it("should handle special characters in URLs", async () => {
      const session: PageActivitySessionWithoutTreeOrContent = {
        id: "special-chars",
        url: "https://example.com/page?q=test&foo=bar%20baz#section",
        referrer: "https://example.com/page?ref=<script>alert('xss')</script>",
        page_loaded_at: "2025-01-01T00:00:00Z",
      };

      mock_md5_hash.mockReturnValueOnce("special-tree");

      const result = await insert_page_activity_session_with_tree_management(
        db,
        session
      );

      expect(result.tree_id).toBe("special-tree");
      expect(result.was_tree_changed).toBe(true);
    });

    it("should handle very long URLs", async () => {
      const very_long_url = "https://example.com/" + "a".repeat(2000);
      const session: PageActivitySessionWithoutTreeOrContent = {
        id: "long-url",
        url: very_long_url,
        referrer: null,
        page_loaded_at: "2025-01-01T00:00:00Z",
      };

      mock_md5_hash.mockReturnValueOnce("long-url-tree");

      const result = await insert_page_activity_session_with_tree_management(
        db,
        session
      );

      expect(result.tree_id).toBe("long-url-tree");
    });
  });
});