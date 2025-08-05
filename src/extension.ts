import * as vscode from "vscode";
import express from "express";
import * as http from "http";
import cors from "cors";
import {
  run_workflow,
  build_workflow,
} from "./reconcile_webpage_trees_workflow_vanilla";
import { LanceDBMemoryStore } from "./agent_memory";
import { OpenAIEmbeddings } from "./workflow/embeddings";
import { MarkdownDatabase } from "./markdown_db";
import { get_filter_config } from "./config/filter_config";
import { global_filter_metrics } from "./workflow/filter_metrics";
import { DuckDB, get_page_sessions_with_tree_id } from "./duck_db";
import path from "path";
import { PageActivitySessionWithoutTreeOrContent } from "./duck_db_models";
import { PageActivitySessionWithoutTreeOrContentSchema } from "./duck_db_models";
import { insert_page_activity_session_with_tree_management } from "./webpage_tree";
import { md5_hash } from "./hash_utils";
import { decompress } from "@mongodb-js/zstd";
import { createAndStartMCPServer, WebpageRAGMCPServer } from "./mcp_server";
import * as child_process from "child_process";

let server: http.Server | undefined;
let duck_db: DuckDB;
let mcp_server: WebpageRAGMCPServer | undefined;
let mcp_process: child_process.ChildProcess | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  console.log("Starting PKM Assistant extension activation...");

  // Get OpenAI API key from configuration
  const config = vscode.workspace.getConfiguration("pkm-assistant");
  const openai_api_key = config.get<string>("openaiApiKey");

  if (!openai_api_key) {
    console.error("OpenAI API key is not configured");
    vscode.window.showErrorMessage(
      "OpenAI API key is not configured. Please set it in settings."
    );
    return;
  }
  console.log("OpenAI API key found in configuration");

  // TODO: make these path configurable
  const front_page_path = "/Users/chuck/workspace/pkm/webpages_db.md";
  console.log("Initializing databases...");
  const markdown_db = new MarkdownDatabase(front_page_path);
  // TODO: make these path use extension storage
  duck_db = new DuckDB({
    database_path: path.join(
      context.globalStorageUri.fsPath,
      "webpage_categorizations.db"
    ),
  });
  await duck_db.init();
  console.log("Databases initialized successfully");

  // Start express server to handle requests from the extension
  console.log("Starting webpage categorizer service...");
  start_webpage_categoriser_service(
    context,
    openai_api_key,
    duck_db,
    markdown_db
  );

  // Start MCP server
  console.log("Starting MCP server...");
  try {
    mcp_server = await createAndStartMCPServer(context, openai_api_key, duck_db);
    console.log("MCP server created successfully");
    
    // Start MCP server as a separate process
    const mcp_script_path = path.join(context.extensionPath, "out", "mcp_server_standalone.js");
    mcp_process = child_process.spawn("node", [mcp_script_path], {
      env: {
        ...process.env,
        OPENAI_API_KEY: openai_api_key,
        STORAGE_PATH: context.globalStorageUri.fsPath,
        DUCK_DB_PATH: path.join(context.globalStorageUri.fsPath, "webpage_categorizations.db"),
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    mcp_process.on('error', (error) => {
      console.error('MCP server process error:', error);
      vscode.window.showErrorMessage(`MCP server failed to start: ${error.message}`);
    });

    mcp_process.on('exit', (code) => {
      console.log(`MCP server process exited with code ${code}`);
    });

    console.log("MCP server process started");
  } catch (error) {
    console.error("Failed to start MCP server:", error);
    vscode.window.showErrorMessage(`Failed to start MCP server: ${error.message}`);
  }

  console.log("PKM Assistant extension activated!");
}

async function start_webpage_categoriser_service(
  context: vscode.ExtensionContext,
  openai_api_key: string,
  duck_db: DuckDB,
  markdown_db: MarkdownDatabase
) {
  const app = express();
  app.use(express.json());
  app.use(cors());

  const db_path = context.globalStorageUri.fsPath;
  const memory_db = await LanceDBMemoryStore.create(db_path, {
    embeddings: new OpenAIEmbeddings({
      model: "text-embedding-3-small",
      apiKey: openai_api_key,
    }),
  });

  const filter_config = get_filter_config();
  const webpage_categoriser_app = build_workflow(
    openai_api_key,
    null, // checkpointer no longer used
    duck_db,
    markdown_db,
    memory_db,
    filter_config
  );

  // Create a queue that will persist between requests
  const request_queue: Array<
    PageActivitySessionWithoutTreeOrContent & { raw_content: string }
  > = [];
  let is_processing = false;
  async function process_queue() {
    if (is_processing || request_queue.length === 0) return;

    is_processing = true;
    try {
      const page_visit = request_queue.shift();

      if (page_visit) {
        // Add the webpage to its
        const inserted =
          await insert_page_activity_session_with_tree_management(
            duck_db,
            page_visit
          );
        if (inserted.tree_id && inserted.was_tree_changed) {
          const tree_members = await get_page_sessions_with_tree_id(
            duck_db,
            inserted.tree_id
          );
          const page_with_tree_id = {
            ...page_visit,
            tree_id: inserted.tree_id,
          };
          await run_workflow(
            {
              members: tree_members,
              new_page: page_with_tree_id,
              raw_content: page_visit.raw_content,
            },
            webpage_categoriser_app,
            duck_db
          );
        }
      }
    } catch (error) {
      console.error("Error processing queue item:", error);
    } finally {
      is_processing = false;
      // Process next item if any
      process_queue();
    }
  }

  app.post("/visit", async (req, res) => {
    console.log("Received request from:", req.body.url);
    const id = md5_hash(`${req.body.url}:${req.body.page_loaded_at}`);

    // Decompress content if it's base64 encoded zstd compressed data
    let content = req.body.content;
    if (typeof content === "string" && content.length > 0) {
      try {
        const compressed_data = Buffer.from(content, "base64");
        const decompressed_data = await decompress(compressed_data);
        content = decompressed_data.toString("utf-8");
      } catch (error) {
        console.warn("Failed to decompress content, using as-is:", error);
      }
    }

    const { content: _, ...req_body_without_content } = req.body;
    const parse_result =
      PageActivitySessionWithoutTreeOrContentSchema.safeParse({
        ...req_body_without_content,
        id,
      });
    if (!parse_result.success) {
      res
        .status(400)
        .json({ error: "Invalid payload", issues: parse_result.error.issues });
      return;
    }
    const payload = parse_result.data;
    console.log("Received payload:", payload.url);

    // Add to queue instead of processing immediately
    request_queue.push({ ...payload, raw_content: content });

    // Start processing if not already processing
    process_queue();

    res.json({ status: "queued", position: request_queue.length });
  });

  // Start the server
  const port = 5000;
  server = app.listen(port, () => {
    console.log(`PKM Assistant server running at http://localhost:${port}`);
  });

  // Register commands
  const show_metrics_command = vscode.commands.registerCommand(
    'pkm-assistant.showFilterMetrics',
    () => {
      const metrics = global_filter_metrics.get_metrics();
      const output = vscode.window.createOutputChannel('PKM Assistant Filter Metrics');
      output.clear();
      output.appendLine('=== Webpage Filter Metrics ===');
      output.appendLine(`Total pages analyzed: ${metrics.total_pages}`);
      output.appendLine(`Pages processed: ${metrics.processed_pages} (${get_percentage(metrics.processed_pages, metrics.total_pages)}%)`);
      output.appendLine(`Pages filtered: ${metrics.filtered_pages} (${get_percentage(metrics.filtered_pages, metrics.total_pages)}%)`);
      output.appendLine(`Average confidence: ${metrics.average_confidence.toFixed(2)}`);
      output.appendLine('');
      output.appendLine('Page types:');
      Object.entries(metrics.page_types)
        .sort(([, a], [, b]) => b - a)
        .forEach(([type, count]) => {
          output.appendLine(`  ${type}: ${count} (${get_percentage(count, metrics.total_pages)}%)`);
        });
      if (Object.keys(metrics.filter_reasons).length > 0) {
        output.appendLine('');
        output.appendLine('Filter reasons:');
        Object.entries(metrics.filter_reasons)
          .sort(([, a], [, b]) => b - a)
          .forEach(([reason, count]) => {
            output.appendLine(`  ${reason}: ${count}`);
          });
      }
      output.show();
      
      // Also log to console
      global_filter_metrics.log_summary();
    }
  );
  
  context.subscriptions.push(show_metrics_command);
  
  // Add server cleanup to extension subscriptions
  context.subscriptions.push({
    dispose: () => {
      if (server) {
        server.close();
        server = undefined;
      }
    },
  });
}

function get_percentage(count: number, total: number): string {
  if (total === 0) return '0';
  return ((count / total) * 100).toFixed(1);
}

export async function deactivate(): Promise<void> {
  if (duck_db) {
    await duck_db.close();
  }
  if (server) {
    server.close();
  }
  if (mcp_process) {
    console.log("Stopping MCP server process...");
    mcp_process.kill();
  }
}
