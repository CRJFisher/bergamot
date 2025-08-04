export const CallToolRequestSchema = "CallToolRequestSchema";
export const ListToolsRequestSchema = "ListToolsRequestSchema";

export const ErrorCode = {
  MethodNotFound: -32601,
  InternalError: -32603,
  InvalidRequest: -32600,
};

export class McpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}