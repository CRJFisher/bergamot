# 02: Core Components and Roles in MCP

The Model Context Protocol (MCP) defines three primary roles that collaborate to enable AI model interactions with external systems. Understanding these roles is key to comprehending MCP's architecture.

**1. MCP Host:**
*   **Definition:** An application or environment where AI-driven actions are initiated or managed (e.g., an IDE like VS Code, an operating system, or a desktop AI application).
*   **Function:** The Host provides the platform for MCP interactions. It may launch or manage MCP Clients and Servers, effectively setting the stage for AI agents to operate.

**2. MCP Client:**
*   **Definition:** The component, often an AI agent or an AI-powered application, that initiates requests to MCP Servers.
*   **Function:** The Client is the "requester." It discovers available tools and resources from Servers and then invokes them to perform tasks or retrieve data. Key responsibilities include protocol negotiation, tool discovery, and execution requests.

**3. MCP Server:**
*   **Definition:** A service that exposes specific capabilities—such as tools, data resources, or prompt templates—through the MCP interface.
*   **Function:** The Server is the "provider." It listens for requests from MCP Clients and executes the requested actions or provides the requested data. Servers make their capabilities discoverable and manage access to them.

**Interdependence:**
These three components are interdependent:
*   The **Host** provides the operational context for the **Client**.
*   The **Client** relies on **Servers** to access tools and data.
*   The **Server** exists to fulfill requests from **Clients**.

This collaborative model forms the backbone of MCP, enabling structured communication between AI and external systems.
