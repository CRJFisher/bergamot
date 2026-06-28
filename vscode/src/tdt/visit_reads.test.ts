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
    });

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows.map((r) => r.page_session_id)).toEqual(["captured"]);
  });

  it("includes a visit at from and excludes one at to", async () => {
    await seed_session(db, {
      id: "at_from",
      url: "https://x.com/from",
      page_loaded_at: "2026-06-01T00:00:00.000Z",
      title: "From",
    });
    await seed_session(db, {
      id: "at_to",
      url: "https://x.com/to",
      page_loaded_at: "2026-07-01T00:00:00.000Z",
      title: "To",
    });

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows.map((r) => r.page_session_id)).toEqual(["at_from"]);
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

  it("picks the latest fetched_at when several re-downloads parsed a site_name", async () => {
    await seed_session(db, {
      id: "s",
      url: "https://news.example.com/a",
      page_loaded_at: "2026-06-10T09:00:00.000Z",
      title: "Story",
      site_name: "Old Name",
    });
    await db.execute(
      `INSERT INTO ${WEBPAGE_FETCH_TABLE}
         (fetch_id, page_session_id, url, outcome, site_name, fetched_at)
       VALUES ($fid, $id, $url, 'ok', $site, $t)`,
      {
        fid: "f-s-2",
        id: "s",
        url: "https://news.example.com/a",
        site: "New Name",
        t: "2026-06-15T09:00:00.000Z",
      },
    );

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows[0].site_name).toBe("New Name");
  });

  it("yields a null site_name when no re-download parsed one", async () => {
    await seed_session(db, {
      id: "s",
      url: "https://x.com/s",
      page_loaded_at: "2026-06-10T09:00:00.000Z",
      title: "S",
    });
    await db.execute(
      `INSERT INTO ${WEBPAGE_FETCH_TABLE}
         (fetch_id, page_session_id, url, outcome, site_name, fetched_at)
       VALUES ($fid, $id, $url, 'ok', NULL, $t)`,
      { fid: "f-s", id: "s", url: "https://x.com/s", t: "2026-06-10T09:00:00.000Z" },
    );

    const rows = await list_visits_in_window(db, {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
    });

    expect(rows[0].site_name).toBeNull();
  });

  it("falls back to the cap for a non-positive or non-finite limit", async () => {
    for (let i = 0; i < 3; i++) {
      await seed_session(db, {
        id: `p${i}`,
        url: `https://x.com/${i}`,
        page_loaded_at: `2026-06-0${i + 1}T09:00:00.000Z`,
        title: `P${i}`,
      });
    }

    for (const limit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const rows = await list_visits_in_window(db, {
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
        limit,
      });
      expect(rows).toHaveLength(3);
    }
  });

  it("warns when the read fills the row cap exactly", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 3; i++) {
        await seed_session(db, {
          id: `p${i}`,
          url: `https://x.com/${i}`,
          page_loaded_at: `2026-06-0${i + 1}T09:00:00.000Z`,
          title: `P${i}`,
        });
      }

      await list_visits_in_window(db, {
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
        limit: 3,
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("3-row cap");
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn when the read stays below the cap", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await seed_session(db, {
        id: "p0",
        url: "https://x.com/0",
        page_loaded_at: "2026-06-01T09:00:00.000Z",
        title: "P0",
      });

      await list_visits_in_window(db, {
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
        limit: 3,
      });

      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
