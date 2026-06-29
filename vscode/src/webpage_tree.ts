import {
  DuckDB,
  insert_page_activity_session,
  find_tree_containing_url,
  insert_webpage_tree,
  update_webpage_tree_activity_time,
} from "./duck_db";
import { PageActivitySession } from "./duck_db_models";
import { PageActivitySessionWithoutTree } from "./duck_db_models";
import { PageActivitySessionWithMeta } from "./page_capture_models";
import { md5_hash } from "./hash_utils";
import { WebpageTreeNode } from "./webpage_tree_models";

export interface TreeManagementResult {
  tree_id: string | null;
  was_tree_changed: boolean;
  referrer_session_id: string | null;
}

export async function insert_page_activity_session_with_tree_management(
  db: DuckDB,
  session: PageActivitySessionWithoutTree
): Promise<TreeManagementResult> {
  try {
    if (session.referrer) {
      return await handle_page_with_referrer(db, session);
    }
    return await create_new_tree_as_root(db, session);
  } catch (error) {
    console.error(
      "Error inserting page activity session with tree management:",
      error
    );
    throw error;
  }
}

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

  function build_tree_node(session: PageActivitySession): WebpageTreeNode {
    const children = referrer_id_to_children.get(session.id) || [];
    return {
      webpage_session: session,
      children: children.map(build_tree_node),
    };
  }

  const root_session = tree_members.find((session) => {
    const has_no_referrer = !session.referrer_page_session_id;
    // A referrer outside the tree (cross-tree origin, phantom parent) makes this a
    // local root: the visit was split off from a parent we no longer hold here.
    const referrer_not_in_tree =
      session.referrer_page_session_id &&
      !tree_members.some((s) => s.id === session.referrer_page_session_id);
    return has_no_referrer || referrer_not_in_tree;
  });
  if (!root_session) {
    throw new Error(
      `No root node found for tree_members: ${JSON.stringify(tree_members)}`
    );
  }

  return build_tree_node(root_session);
}

async function handle_page_with_referrer(
  db: DuckDB,
  page: PageActivitySessionWithoutTree
): Promise<TreeManagementResult> {
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
    const { tree_changed } = await insert_page_activity_session(
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
      was_tree_changed: tree_changed,
      referrer_session_id: referrer_page.id,
    };
  }
  // Referrer is set but no captured session matches it (phantom referrer): start a
  // fresh tree rooted at this page rather than dropping the visit.
  return await create_new_tree_as_root(db, page);
}

async function create_new_tree_as_root(
  db: DuckDB,
  session: PageActivitySession
): Promise<TreeManagementResult> {
  // Every visit gets a tree node regardless of relevance; content exclusion (login
  // wall, dead links) happens later at re-download time, not here.
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
  const { tree_changed } = await insert_page_activity_session(
    db,
    session_with_tree_id
  );

  return { tree_id, was_tree_changed: tree_changed, referrer_session_id: null };
}
