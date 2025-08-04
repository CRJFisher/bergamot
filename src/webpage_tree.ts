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
 * Insert a PageActivitySession
 * If the session has a referrer, find existing trees that contain that referrer
 * If no referrer or no matching tree found, create a new tree
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
    const has_tree_been_split = !referrer_id_to_children.has(
      session.referrer_page_session_id
    );
    return has_no_referrer || has_tree_been_split;
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
  // Skip if the url is an aggregator
  // TODO: store in DB and allow users to manage / get an LLM to decide this
  const aggregator_urls = [
    "https://news.ycombinator.com",
    "https://www.google.com",
    "https://www.bing.com",
    "https://www.yahoo.com",
    "https://www.duckduckgo.com",
    "https://www.reddit.com",
    "https://www.reddit.com/r/all",
    "https://www.facebook.com",
    "https://www.twitter.com",
    "https://www.linkedin.com",
    "https://www.instagram.com",
    "https://www.pinterest.com",
    "https://www.quora.com",
    "https://www.medium.com",
    "https://www.wikipedia.org",
    "https://www.youtube.com",
  ];
  const aggregator_urls_with_trailing_slash = aggregator_urls.map((url) =>
    url.endsWith("/") ? url : `${url}/`
  );
  if (
    aggregator_urls.includes(session.url) ||
    aggregator_urls_with_trailing_slash.includes(session.url)
  ) {
    console.warn(`Skipping aggregator URL: ${session.url}`);
    return { tree_id: null, was_tree_changed: false };
  }

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
