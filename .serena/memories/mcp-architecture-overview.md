# MCP (Model Context Protocol) Architecture in Spawnbot

## High-Level Overview

MCP servers are configured declaratively in opencode.json/.opencode/ directories and are managed by the MCP namespace in src/mcp/index.ts. They provide:
1. **Tools** - executable functions exposed to the LLM
2. **Prompts** - reusable prompt templates (integrated as Commands)
3. **Resources** - data/files that can be read and embedded in sessions

Each MCP server runs as either:
- **Local**: spawned as a subprocess (stdio transport)
- **Remote**: HTTP endpoint with optional OAuth

## Configuration Schema (src/config/config.ts)

Two discriminated union types:

### Local MCP (type: "local")
```typescript
{
  type: "local",
  command: string[],              // Command + args to run the MCP server
  environment?: Record<string, string>,  // Env vars for the process
  enabled?: boolean,              // Enable/disable on startup (default: enabled)
  timeout?: number                // Request timeout in ms (default: 30s)
}
```

### Remote MCP (type: "remote")
```typescript
{
  type: "remote",
  url: string,                    // HTTP endpoint URL
  enabled?: boolean,              // Enable/disable on startup
  headers?: Record<string, string>, // Custom headers
  oauth?: McpOAuth | false,       // OAuth config (auto-enabled by default)
  timeout?: number                // Request timeout in ms
}
```

#### OAuth Sub-Config (optional)
```typescript
{
  clientId?: string,              // Pre-registered client ID
  clientSecret?: string,          // Client secret (if needed)
  scope?: string                  // OAuth scopes to request
}
```

Example in opencode.json:
```json
{
  "mcp": {
    "github": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "oauth": { "scope": "repo" }
    },
    "local-tool": {
      "type": "local",
      "command": ["node", "server.js"],
      "environment": { "DEBUG": "1" }
    }
  }
}
```

## Initialization & Lifecycle (src/mcp/index.ts)

### Startup Flow
1. **Instance.state() hook**: MCP creates a singleton state holder
   - Reads Config.get() to find all MCP entries
   - For each enabled MCP, calls create(key, mcp)
   - Stores clients in `state.clients` map and statuses in `state.status`
2. **create() function**: Attempts to connect
   - **Local**: Spawns stdio transport with StdioClientTransport
   - **Remote**: Tries StreamableHTTPClientTransport first, falls back to SSEClientTransport
   - Both: Wraps with OAuth provider if configured
   - Calls client.listTools() to validate connection
   - Returns {mcpClient, status}
3. **Status states**: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"

### Cleanup
- Instance.dispose() → State.dispose() → calls MCP state's dispose function
- Closes all clients: `client.close()` for each in state.clients
- Clears pendingOAuthTransports map

## Tool Integration Flow

### 1. Tool Discovery (src/session/prompt.ts:887)
```typescript
for (const [key, item] of Object.entries(await MCP.tools())) {
  // item is an AI SDK Tool with execute() function
}
```

### 2. MCP.tools() function (line 566)
- Gets all connected clients from state
- For each client that has status === "connected"
- Calls client.listTools()
- Converts MCPToolDef → AI SDK Tool via convertMcpTool()
- Returns Record<string, Tool> keyed by "clientName_toolName"

### 3. Tool Execution Wrapper (line 894)
Wraps MCP tool execute() to:
- Trigger plugin.tool.execute.before hook
- Check permissions (ask for approval if needed)
- Call the original execute()
- Trigger plugin.tool.execute.after hook
- Parse result and format attachments (images, resources → data URLs)
- Truncate output if needed
- Return formatted result

## Prompt Integration Flow

### Commands Registry (src/command/index.ts)
1. Config commands (from opencode.json)
2. Built-in commands (init, local-review, etc.)
3. **MCP prompts** (from each connected MCP server)
   - Line 106: `for (const [name, prompt] of Object.entries(await MCP.prompts()))`
   - Each MCP prompt becomes a callable command with source: "mcp"
4. Skills (from .opencode/skills/)

### MCP.prompts() function (line 608)
- Gets all connected clients
- For each client calls client.listPrompts()
- Returns Record<string, PromptInfo & {client: string}> keyed by "clientName:promptName"
- When executed: calls MCP.getPrompt(clientName, promptName, args)
- Converts prompt messages to string template for session

## Resource Integration Flow

### MCP.resources() function (line 629)
- Gets all connected clients
- For each client calls client.listResources()
- Returns Record<string, ResourceInfo & {client: string}> keyed by "clientName:resourceName"
- Exposed at GET /experimental/resource endpoint

## OAuth Flow

### Remote Servers (automatic unless oauth: false)

**Initialize**: McpOAuthProvider implements OAuthClientProvider interface
- clientMetadata(): Declares client capabilities and redirect_uri (http://127.0.0.1:19876/mcp/oauth/callback)
- clientInformation(): Returns pre-registered or dynamically registered client info
- tokens(): Returns stored OAuth tokens from McpAuth
- saveTokens(): Stores tokens in ~/.config/opencode/mcp-auth.json

**Authenticate**: MCP.authenticate(mcpName) → MCP.startAuth() → browser OAuth flow
1. startAuth(): Creates new auth provider, captures authorization URL
2. Opens browser with URL
3. registerCallbackPromise = McpOAuthCallback.waitForCallback(oauthState)
4. User grants permission, IdP redirects to http://127.0.0.1:19876/mcp/oauth/callback
5. McpOAuthCallback server captures code, resolves promise
6. finishAuth(code): Calls transport.finishAuth(code) to exchange for tokens
7. Reconnect: add(mcpName, config) to establish authenticated connection

**Error Handling**:
- UnauthorizedError → status: "needs_auth"
- Registration error → status: "needs_client_registration"
- Other errors → status: "failed" with error message

## API Routes (src/server/routes/mcp.ts)

| Method | Path | Purpose |
|--------|------|---------|
| GET | /mcp | Get status of all MCP servers |
| POST | /mcp | Dynamically add new MCP server |
| POST | /mcp/:name/auth | Start OAuth flow, return authorization URL |
| POST | /mcp/:name/auth/callback | Complete OAuth with authorization code |
| POST | /mcp/:name/auth/authenticate | Start OAuth and wait for callback (opens browser) |
| DELETE | /mcp/:name/auth | Remove stored OAuth credentials |
| POST | /mcp/:name/connect | Manually reconnect a disabled server |
| POST | /mcp/:name/disconnect | Disconnect and disable a server |

Also (src/server/routes/experimental.ts):
| GET | /experimental/resource | List all MCP resources |

## Communication Protocols

### Local MCP
- **Transport**: StdioClientTransport (stdin/stdout JSON-RPC 2.0)
- **Format**: Line-delimited JSON
- **Lifecycle**: Subprocess spawned on connect, killed on dispose
- **Env**: Can set custom env vars in config.environment, BUN_BE_BUN=1 if cmd is "opencode"

### Remote MCP
1. **StreamableHTTPClientTransport** (preferred): HTTP with chunked streaming
2. **SSEClientTransport** (fallback): Server-sent events
- Both wrapped with OAuth provider
- Both support request timeout configuration

## State Management (src/project/state.ts)

Instance.state() creates singleton per project directory:
- init: async function that runs once, result cached
- dispose: async cleanup function (optional)
- Accessed via the returned function, not stored directly
- Lifecycle: tied to Instance.provide(directory, fn)

For MCP specifically:
```typescript
const state = Instance.state(
  async () => {
    // Initialize and connect all MCPs
    return { status: {}, clients: {} }
  },
  async (state) => {
    // Cleanup on Instance.dispose()
    await Promise.all(state.clients.map(c => c.close()))
  }
)
```

## Tool Registry Integration

Two tool sources:
1. **Built-in tools** (via ToolRegistry.tools()) - bash, read, write, glob, grep, etc.
2. **MCP tools** (via MCP.tools()) - tools from connected MCP servers

Both are wrapped with:
- Permission checking
- Plugin hooks (before/after)
- Output formatting/truncation
- Attachment extraction (images, resources as data URLs)

Same execution pipeline, indistinguishable to the LLM.

## Error & Status Handling

**MCP.Status** discriminated union:
```typescript
| { status: "connected" }
| { status: "disabled" }  // enabled: false in config
| { status: "failed"; error: string }
| { status: "needs_auth" }  // Remote OAuth needs completing
| { status: "needs_client_registration"; error: string }  // No DCR support
```

**Common failures**:
- Connection timeout: listTools() fails
- OAuth error: UnauthorizedError during connect
- Missing registration: client_id required but not in config
- Subprocess failed: StdioClientTransport error

**Monitoring**: Bus.publish(MCP.ToolsChanged, {server}) when server's tool list changes

## Key Files Reference

| File | Purpose |
|------|---------|
| src/mcp/index.ts | Main MCP management (463 lines) |
| src/mcp/auth.ts | OAuth token storage in mcp-auth.json |
| src/mcp/oauth-provider.ts | OAuthClientProvider implementation |
| src/mcp/oauth-callback.ts | Local callback server for OAuth (port 19876) |
| src/server/routes/mcp.ts | REST API endpoints for MCP operations |
| src/config/config.ts | McpLocal, McpRemote, Mcp schema definitions |
| src/session/prompt.ts | Tool resolution (line 887) and execution wrapping |
| src/command/index.ts | MCP prompt integration as commands |
| src/server/routes/experimental.ts | GET /experimental/resource endpoint |
