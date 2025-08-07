import { DuckDB, get_page_sessions_with_tree_id } from "./duck_db";
import {
  insert_page_activity_session_with_tree_management,
  get_tree_with_id,
} from "./webpage_tree";
import {
  PageActivitySession,
  PageActivitySessionWithoutTreeOrContent,
} from "./duck_db_models";
import * as hash_utils from "./hash_utils";
import { LanceDBMemoryStore } from "./agent_memory";

jest.mock("./hash_utils");

const mock_md5_hash = jest.spyOn(hash_utils, 'md5_hash');

describe("Webpage Tree Management", () => {
  let db: DuckDB;
  let memory_db: any; // Mock memory store

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    mock_md5_hash.mockClear();
    
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
      page_loaded_at: "2025-01-01T00:00:00Z", // 2025-01-01T00:00:00Z in milliseconds
    };

    describe("when session has no referrer", () => {
      it("should create a new tree as root", async () => {
        const session = { ...base_session, referrer: null };
        mock_md5_hash.mockReturnValue("new-tree-id");

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
      });

      it("should skip aggregator URLs", async () => {
        const aggregator_session = {
          ...base_session,
          url: "https://news.ycombinator.com",
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
          page_loaded_at: "2025-01-01T00:00:00Z", // 5 minutes earlier
        };

        mock_md5_hash.mockReturnValue("existing-tree-id");

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
          tree_id: "existing-tree-id",
          was_tree_changed: true,
        });
      });

      it("should create new tree when referrer not found", async () => {
        mock_md5_hash.mockReturnValue("new-tree-id");

        const result = await insert_page_activity_session_with_tree_management(
          db,
          session_with_referrer
        );

        expect(result).toEqual({
          tree_id: "new-tree-id",
          was_tree_changed: true,
        });
      });
    });
  });

  describe("get_tree_with_id", () => {
    const root_session: PageActivitySession = {
      id: "root-session",
      url: "https://example.com/root",
      referrer: null,
      referrer_page_session_id: null,
      page_loaded_at: "2025-01-01T00:00:00Z",
      tree_id: "test-tree-id",
    };

    beforeEach(async () => {
      // Insert test data directly into database
      await db.execute(
        `INSERT INTO webpage_trees (id, first_load_time, latest_activity_time) VALUES ($id, $first_load_time, $latest_activity_time)`,
        {
          id: "test-tree-id",
          first_load_time: "2025-01-01T00:00:00Z",
          latest_activity_time: "2025-01-01T00:00:00Z",
        }
      );
      await db.execute(
        `INSERT INTO webpage_activity_sessions (
          id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id
        ) VALUES ($id, $url, $referrer, $referrer_page_session_id, $page_loaded_at, $tree_id)`,
        {
          id: root_session.id,
          url: root_session.url,
          referrer: root_session.referrer,
          referrer_page_session_id: root_session.referrer_page_session_id,
          page_loaded_at: root_session.page_loaded_at,
          tree_id: root_session.tree_id,
        }
      );
    });

    it("should build a simple tree with root only", async () => {
      const tree_members = await get_page_sessions_with_tree_id(db, memory_db, "test-tree-id");
      const tree = get_tree_with_id(tree_members);
      expect(tree).toBeDefined();
      expect(tree?.webpage_session.id).toEqual("root-session");
      expect(tree?.children).toHaveLength(0);
    });
  });
});

