import {
  DuckDB,
  insert_page_activity_session,
  find_tree_containing_url,
  insert_webpage_tree,
  update_webpage_tree_activity_time,
} from "./duck_db";
import { PageActivitySession } from "./duck_db_models";
import { PageActivitySessionWithoutTreeOrContent } from "./duck_db_models";
import { PageActivitySessionWithMeta } from "./reconcile_webpage_trees_workflow_models";
import { md5_hash } from "./hash_utils";
import { WebpageTreeNode } from "./webpage_tree_models";

/**
 * Inserts a page activity session and manages its navigation tree assignment.
 * 
 * If the session has a referrer:
 * - Searches for existing trees containing that referrer URL
 * - Links the session to the found tree, or creates a new tree if none found
 * 
 * If no referrer:
 * - Creates a new navigation tree with this session as the root
 * 
 * @param db - DuckDB instance for data persistence
 * @param session - Page activity session data without tree or content information
 * @returns Promise resolving to object containing assigned tree ID and change status
 * @throws {Error} If database operations fail
 * 
 * @example
 * ```typescript
 * const result = await insert_page_activity_session_with_tree_management(db, {
 *   id: 'session-123',
 *   url: 'https://example.com/page',
 *   referrer: 'https://google.com',
 *   page_loaded_at: '2024-01-01T12:00:00Z'
 * });
 * 
 * if (result.tree_id) {
 *   console.log(`Session assigned to tree: ${result.tree_id}`);
 *   console.log(`Tree was modified: ${result.was_tree_changed}`);
 * }
 * ```
 */
export async function insert_page_activity_session_with_tree_management(
  db: DuckDB,
  session: PageActivitySessionWithoutTreeOrContent
): Promise<{ tree_id: string | null; was_tree_changed: boolean }> {
  try {
    let result: { tree_id: string; was_tree_changed: boolean };

    if (session.referrer) {
      result = await handle_page_with_referrer(db, session);
    } else {
      result = await create_new_tree_as_root(db, session);
    }

    return result;
  } catch (error) {
    console.error(
      "Error inserting page activity session with tree management:",
      error
    );
    throw error;
  }
}

/**
 * Constructs a hierarchical tree structure from a flat list of page activity sessions.
 * Builds parent-child relationships based on referrer_page_session_id fields.
 * 
 * @param tree_members - Array of page sessions that belong to the same navigation tree
 * @returns WebpageTreeNode representing the root of the constructed tree
 * @throws {Error} If no root node can be identified or tree structure is invalid
 * 
 * @example
 * ```typescript
 * const treeSessions = await get_page_sessions_with_tree_id(db, memoryDb, 'tree-123');
 * const treeStructure = get_tree_with_id(treeSessions);
 * 
 * console.log('Root page:', treeStructure.webpage_session.url);
 * console.log('Number of children:', treeStructure.children?.length || 0);
 * 
 * // Traverse the tree
 * function printTree(node: WebpageTreeNode, depth = 0) {
 *   const indent = '  '.repeat(depth);
 *   console.log(`${indent}- ${node.webpage_session.analysis?.title || 'Untitled'}`);
 *   node.children?.forEach(child => printTree(child, depth + 1));
 * }
 * printTree(treeStructure);
 * ```
 */
export function get_tree_with_id(
  tree_members: PageActivitySessionWithMeta[]
): WebpageTreeNode {
  const referrer_id_to_children = new Map<string, PageActivitySession[]>();
  for (const session of tree_members) {
    if (session.referrer_page_session_id) {
      if (!referrer_id_to_children.has(session.referrer_page_session_id)) {
        referrer_id_to_children.set(session.referrer_page_session_id, []);
      }
      referrer_id_to_children
        .get(session.referrer_page_session_id)
        ?.push(session);
    }
  }

  // Recursively build the tree nodes
  function build_tree_node(session: PageActivitySession): WebpageTreeNode {
    const children = referrer_id_to_children.get(session.id) || [];
    return {
      webpage_session: session,
      children: children.map(build_tree_node),
    };
  }

  const root_session = tree_members.find((session) => {
    const has_no_referrer = !session.referrer_page_session_id;
    // Check if the referrer exists in the current tree members
    const referrer_not_in_tree = session.referrer_page_session_id && 
      !tree_members.some(s => s.id === session.referrer_page_session_id);
    return has_no_referrer || referrer_not_in_tree;
  });
  if (!root_session) {
    throw new Error(
      `No root node found for tree_members: ${JSON.stringify(tree_members)}`
    );
  }

  const tree = build_tree_node(root_session);
  return tree;
}

/**
 * Handle pages with referrer by finding existing trees or creating new ones
 */
async function handle_page_with_referrer(
  db: DuckDB,
  page: PageActivitySessionWithoutTreeOrContent
): Promise<{ tree_id: string | null; was_tree_changed: boolean }> {
  if (!page.referrer) {
    throw new Error("Referrer is required for this operation");
  }

  const referrer_page = await find_tree_containing_url(
    db,
    page.referrer,
    page.page_loaded_at
  );

  if (referrer_page) {
    const page_with_tree_id = {
      ...page,
      tree_id: referrer_page.tree_id,
      referrer_page_session_id: referrer_page.id,
    };
    const { was_new_session } = await insert_page_activity_session(
      db,
      page_with_tree_id
    );
    await update_webpage_tree_activity_time(
      db,
      referrer_page.tree_id,
      page.page_loaded_at
    );
    return {
      tree_id: referrer_page.tree_id,
      was_tree_changed: was_new_session,
    };
  } else {
    // Referrer exists but no tree contains it - likely a phantom referrer
    // Create new tree with current page as root
    return await create_new_tree_as_root(db, page);
  }
}

/**
 * Create a new navigation tree with current page as root
 */
async function create_new_tree_as_root(
  db: DuckDB,
  session: PageActivitySession
): Promise<{ tree_id: string | null; was_tree_changed: boolean }> {
  // Note: Aggregator filtering has been moved to the workflow phase
  // where we have access to page content for LLM-based classification.
  // This allows for more intelligent and flexible aggregator detection.

  const tree_id = md5_hash(`${session.url}:${session.page_loaded_at}`);
  const session_with_tree_id = {
    ...session,
    tree_id,
  };

  await insert_webpage_tree(
    db,
    tree_id,
    session.page_loaded_at,
    session.page_loaded_at
  );
  const { was_new_session } = await insert_page_activity_session(
    db,
    session_with_tree_id
  );

  return { tree_id, was_tree_changed: was_new_session };
}
