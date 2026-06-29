import fs from "fs";
import os from "os";
import path from "path";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { get_server_base_url, query_server } from "./mcp_server_standalone";

const PORT_FILE = path.join(os.homedir(), ".bergamot", "port.json");

describe("get_server_base_url", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("builds the localhost base url from the discovered port", () => {
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ port: 4242 }));
    expect(get_server_base_url()).toBe("http://localhost:4242");
  });

  test("reads the canonical port file under the home directory", () => {
    const spy = jest
      .spyOn(fs, "readFileSync")
      .mockReturnValue(JSON.stringify({ port: 9001 }));
    get_server_base_url();
    expect(spy).toHaveBeenCalledWith(PORT_FILE, "utf8");
  });

  test("returns null when the port file is absent", () => {
    jest.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(get_server_base_url()).toBeNull();
  });

  test("returns null when the port file omits a port", () => {
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({}));
    expect(get_server_base_url()).toBeNull();
  });
});

function mock_response(body: { ok: boolean; status?: number; json?: unknown }): Response {
  return {
    ok: body.ok,
    status: body.status ?? 200,
    json: async () => body.json,
  } as Response;
}

describe("query_server", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("requests the discovered base with an encoded query string", async () => {
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ port: 5000 }));
    const fetch_mock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(mock_response({ ok: true, json: { result: "ok" } }));

    const data = await query_server("/query/visit_by_url", {
      url: "https://example.com/a b",
    });

    expect(data).toEqual({ result: "ok" });
    expect(fetch_mock).toHaveBeenCalledWith(
      "http://localhost:5000/query/visit_by_url?url=https%3A%2F%2Fexample.com%2Fa+b"
    );
  });

  test("omits the question mark when there are no params", async () => {
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ port: 5000 }));
    const fetch_mock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(mock_response({ ok: true, json: {} }));

    await query_server("/query/recent_trees", {});

    expect(fetch_mock).toHaveBeenCalledWith(
      "http://localhost:5000/query/recent_trees"
    );
  });

  test("throws when the server is not running", async () => {
    jest.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    await expect(query_server("/query/tree", {})).rejects.toThrow(McpError);
    await expect(query_server("/query/tree", {})).rejects.toThrow(
      /Bergamot server not running/
    );
  });

  test("throws with the status code when the response is not ok", async () => {
    jest.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify({ port: 5000 }));
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(mock_response({ ok: false, status: 503 }));

    await expect(query_server("/query/tree", { tree_id: "t1" })).rejects.toThrow(
      /Query \/query\/tree failed: 503/
    );
  });
});
