# 03: Context Management in MCP

A core function of the Model Context Protocol (MCP) is to provide AI models with structured, machine-readable "context" necessary for them to understand, reason about, and act upon external capabilities.

**Key Types of Context:**

1.  **Tools:**
    *   Represent functions or capabilities that an AI model (via an MCP Client) can instruct an MCP Server to execute (e.g., `read_file`, `query_database`).
    *   Tools are described with structured metadata, including their purpose, parameters (often using JSON Schemas), and expected outputs. This allows AI to understand how to use them.

2.  **Resources:**
    *   Refer to structured data or information that an AI model can access or retrieve (e.g., documents, database records, configuration files).
    *   MCP Servers manage access to these resources, often identified by unique resource identifiers (URIs).

3.  **Prompt Templates:**
    *   Pre-defined prompt structures that can be used to guide an LLM's behavior for specific, recurring tasks.
    *   Servers can offer these templates, which Clients can then populate with specific data.

**Communication Protocol: JSON-RPC 2.0**
*   MCP primarily uses JSON-RPC 2.0 for communication between Clients and Servers. This is a lightweight, stateless remote procedure call protocol.
*   **Interaction Flow:**
    1.  **Discovery:** The Client queries the Server (e.g., using a standard method like `mcp.discoverTools`) to learn about available tools, resources, and their schemas.
    2.  **Invocation:** The Client sends a JSON-RPC request to the Server to execute a specific tool with the required parameters. The Server processes the request and returns a JSON-RPC response containing the result or an error.
*   **Transport Agnostic:** MCP is designed to work over various transport mechanisms (e.g., stdio for local processes, HTTP/WebSockets for networked communication), offering deployment flexibility.

**Significance:**
Standardized context exchange allows AI models from different vendors to interact with diverse external systems consistently. The quality and clarity of the context (tool descriptions, resource availability) provided by Servers are critical for the effectiveness of AI agents using MCP.
