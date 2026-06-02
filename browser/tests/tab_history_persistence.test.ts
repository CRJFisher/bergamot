import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  create_tab_history_store,
  add_tab_history,
  create_tab_history,
  get_tab_history,
  serialize_store,
  deserialize_store,
} from "../src/core/tab_history_manager";
import { load_store, save_store } from "../src/core/tab_history_persistence";
import { TabHistory } from "../src/types/navigation";

describe("tab history serialization", () => {
  it("round-trips a store through serialize/deserialize preserving all fields", () => {
    let store = create_tab_history_store();
    store = add_tab_history(
      store,
      7,
      new TabHistory("https://a.com", "https://b.com", 1000, 900, 3, "group-1")
    );
    store = add_tab_history(
      store,
      8,
      create_tab_history("https://c.com", 7, undefined, "group-1")
    );

    const restored = deserialize_store(serialize_store(store));

    expect(restored.size).toBe(2);
    const seven = get_tab_history(restored, 7)!;
    expect(seven).toBeInstanceOf(TabHistory);
    expect(seven.previous_url).toBe("https://a.com");
    expect(seven.current_url).toBe("https://b.com");
    expect(seven.timestamp).toBe(1000);
    expect(seven.previous_url_timestamp).toBe(900);
    expect(seven.opener_tab_id).toBe(3);
    expect(seven.group_id).toBe("group-1");

    // group_id inheritance survives the round-trip (cross-page session intact).
    expect(get_tab_history(restored, 8)!.group_id).toBe("group-1");
  });

  it("deserializes missing/empty data to an empty store", () => {
    expect(deserialize_store(undefined).size).toBe(0);
    expect(deserialize_store(null).size).toBe(0);
    expect(deserialize_store({}).size).toBe(0);
  });
});

describe("tab history persistence (chrome.storage.session)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("save_store writes the serialized store under the session key", async () => {
    let store = create_tab_history_store();
    store = add_tab_history(
      store,
      1,
      new TabHistory(undefined, "https://x.com", 5, undefined, undefined, "g")
    );

    await save_store(store);

    expect(chrome.storage.session.set).toHaveBeenCalledWith({
      tab_history_store: {
        "1": {
          previous_url: undefined,
          current_url: "https://x.com",
          timestamp: 5,
          previous_url_timestamp: undefined,
          opener_tab_id: undefined,
          group_id: "g",
        },
      },
    });
  });

  it("load_store reconstructs the store from session storage", async () => {
    (chrome.storage.session.get as jest.Mock).mockResolvedValue({
      tab_history_store: {
        "42": {
          current_url: "https://y.com",
          timestamp: 11,
          group_id: "g2",
        },
      },
    } as never);

    const store = await load_store();

    expect(store.size).toBe(1);
    expect(get_tab_history(store, 42)!.current_url).toBe("https://y.com");
    expect(get_tab_history(store, 42)!.group_id).toBe("g2");
  });

  it("load_store returns an empty store when nothing is persisted", async () => {
    (chrome.storage.session.get as jest.Mock).mockResolvedValue({} as never);
    const store = await load_store();
    expect(store.size).toBe(0);
  });
});
