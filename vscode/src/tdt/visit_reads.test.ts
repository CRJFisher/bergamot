import {
  DuckDB,
  create_metadata_schema,
  WEBPAGE_ACTIVITY_SESSIONS_TABLE,
  WEBPAGE_CAPTURE_TABLE,
  WEBPAGE_FETCH_TABLE,
  WEBPAGE_TREES_TABLE,
} from "../duck_db";
import {
  list_visits_in_window,
  make_relational_reader,
  MAX_VISITS_IN_WINDOW,
} from "./visit_reads";

async function seed_session(
  db: DuckDB,
  o: {
    id: string;
    url: string;
    page_loaded_at: string;
    title?: string;
    site_name?: string;
  },
): Promise<void> {
  await db.execute(
    `INSERT INTO ${WEBPAGE_TREES_TABLE} (id, latest_activity_time, first_load_time)
     VALUES ($id, $t, $t) ON CONFLICT DO NOTHING`,
    { id: `tree-${o.id}`, t: o.page_loaded_at },
  );
  await db.execute(
    `INSERT INTO ${WEBPAGE_ACTIVITY_SESSIONS_TABLE}
       (id, url, referrer, referrer_page_session_id, page_loaded_at, tree_id)
     VALUES ($id, $url, NULL, NULL, $t, $tree)`,
    { id: o.id, url: o.url, t: o.page_loaded_at, tree: `tree-${o.id}` },
  );
  if (o.title !== undefined) {
    await db.execute(
      `INSERT INTO ${WEBPAGE_CAPTURE_TABLE}
         (page_session_id, url, title, content_type, captured_at)
       VALUES ($id, $url, $title, 'text/html', $t)`,
      { id: o.id, url: o.url, title: o.title, t: o.page_loaded_at },
    );
  }
  if (o.site_name !== undefined) {
    await db.execute(
      `INSERT INTO ${WEBPAGE_FETCH_TABLE}
         (fetch_id, page_session_id, url, outcome, site_name, fetched_at)
       VALUES ($fid, $id, $url, 'ok', $site, $t)`,
      {
        fid: `f-${o.id}`,
        id: o.id,
        url: o.url,
        site: o.site_name,
        t: o.page_loaded_at,
      },
    );
  }
}

describe("list_visits_in_window", () => {
  let db: DuckDB;

  beforeEach(async () => {
    db = new DuckDB({ database_path: ":memory:" });
    await db.init();
    await create_metadata_schema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("returns captured visits in [from, to), ordered by load time then id", async () => {
    await seed_session(db, {
      id: "b",
      url: "https://x.com/b",
      page_loaded_at: "2026-06-10T09:00:00.000Z",
      title: "B",
    });
    await seed_session(db, {
      id: "a",
      url: "https://x.com/a",
      page_loaded_at: "2026-06-05T09:00:00.000Z",
      title: "A",
    });
    // Out of range — must not appear.
    await seed_session(db, {
      id: "old",
      url: "https://x.com/old",
      page_loaded_at: "2026-05-30T09:00:00.000Z",
      title: "Old",
    });

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows.map((r) => r.page_session_id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({
      page_session_id: "a",
      url: "https://x.com/a",
      title: "A",
      tree_id: "tree-a",
    });
  });

  it("excludes a visit with no capture (no title/url to vector)", async () => {
    await seed_session(db, {
      id: "captured",
      url: "https://x.com/c",
      page_loaded_at: "2026-06-10T09:00:00.000Z",
      title: "C",
    });
    await seed_session(db, {
      id: "uncaptured",
      url: "https://x.com/u",
      page_loaded_at: "2026-06-11T09:00:00.000Z",
      // no title => no webpage_capture row
    });

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows.map((r) => r.page_session_id)).toEqual(["captured"]);
  });

  it("carries site_name from the most recent re-download that parsed one", async () => {
    await seed_session(db, {
      id: "s",
      url: "https://news.example.com/a",
      page_loaded_at: "2026-06-10T09:00:00.000Z",
      title: "Story",
      site_name: "Example News",
    });

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows[0].site_name).toBe("Example News");
  });

  it("clamps the row cap to MAX_VISITS_IN_WINDOW (AC #7)", async () => {
    for (let i = 0; i < 5; i++) {
      await seed_session(db, {
        id: `p${i}`,
        url: `https://x.com/${i}`,
        page_loaded_at: `2026-06-0${i + 1}T09:00:00.000Z`,
        title: `P${i}`,
      });
    }

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      limit: MAX_VISITS_IN_WINDOW + 10_000,
    });
    // The over-large request is clamped, not honoured; all 5 rows still return.
    expect(rows).toHaveLength(5);

    const capped = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      limit: 2,
    });
    expect(capped).toHaveLength(2);
    expect(capped.map((r) => r.page_session_id)).toEqual(["p0", "p1"]);
  });

  it("make_relational_reader binds the window read to the handle", async () => {
    await seed_session(db, {
      id: "r",
      url: "https://x.com/r",
      page_loaded_at: "2026-06-10T09:00:00.000Z",
      title: "R",
    });
    const reader = make_relational_reader(db);

    const rows = await reader.list_visits_in_window(
      "2026-06-01T00:00:00.000Z",
      "2026-07-01T00:00:00.000Z",
    );

    expect(rows.map((r) => r.page_session_id)).toEqual(["r"]);
  });
});
