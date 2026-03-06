# Tool Creation

How to create custom MCP servers and install community MCP servers.

## Architecture

MCP servers are standalone Node.js processes that communicate via JSON-RPC 2.0 over stdio. Each server registers tools that become available to you. Servers are defined in `config/integrations.yaml` and spawned by the daemon.

## Creating a Custom MCP Server

Use the `tool_create` MCP tool. Provide a `name` and the full JavaScript `code` for the server.

### Import Paths

**Always use absolute paths** to the framework. The framework root is `~/.spawnbot/` (or wherever spawnbot is installed). Your integration files live in the agent directory, not the framework directory, so relative imports will break.

```js
import { McpServer } from '/home/USER/.spawnbot/lib/mcp/base-server.js';
import { defineTool } from '/home/USER/.spawnbot/lib/mcp/tool.js';
```

To find the correct path, check where the core MCP servers are:
```bash
head -2 $(which spawnbot | xargs dirname)/../lib/mcp/base-server.js
```

Or use the `SPAWNBOT_FRAMEWORK_ROOT` environment variable (automatically set for all MCP servers):
```js
const root = process.env.SPAWNBOT_FRAMEWORK_ROOT;
const { McpServer } = await import(`${root}/lib/mcp/base-server.js`);
const { defineTool } = await import(`${root}/lib/mcp/tool.js`);
```

### McpServer API

```js
const server = new McpServer({ name: 'my-server', version: '0.1.0' });
server.addTool(tool);      // Add a single tool
server.addTools([...]);     // Add multiple tools
server.start();             // Start listening on stdin/stdout
```

### defineTool API

```js
defineTool({
  name: 'tool_name',           // snake_case
  description: 'What this tool does',
  inputSchema: {
    properties: {
      param1: { type: 'string', description: 'Description' },
      param2: { type: 'number', description: 'Description' },
    },
    required: ['param1'],       // Optional — list required params
  },
  handler({ param1, param2 }) {
    // Do work here
    // Return a string or any JSON-serializable object
    return { result: 'done' };
  },
})
```

- `inputSchema` uses JSON Schema. `type: 'object'` is auto-wrapped.
- `handler` receives parsed arguments. Can be async.
- Return a string for plain text, or an object for structured JSON.

### Complete Example

```js
const root = process.env.SPAWNBOT_FRAMEWORK_ROOT;
const { McpServer } = await import(`${root}/lib/mcp/base-server.js`);
const { defineTool } = await import(`${root}/lib/mcp/tool.js`);

const server = new McpServer({ name: 'weather', version: '0.1.0' });

server.addTools([
  defineTool({
    name: 'weather_current',
    description: 'Get current weather for a location.',
    inputSchema: {
      properties: {
        location: { type: 'string', description: 'City name or coordinates' },
      },
      required: ['location'],
    },
    async handler({ location }) {
      const res = await fetch(`https://api.example.com/weather?q=${encodeURIComponent(location)}`);
      const data = await res.json();
      return { location, temperature: data.temp, conditions: data.description };
    },
  }),

  defineTool({
    name: 'weather_forecast',
    description: 'Get 5-day forecast for a location.',
    inputSchema: {
      properties: {
        location: { type: 'string', description: 'City name or coordinates' },
        days: { type: 'number', description: 'Number of days (1-5, default 3)' },
      },
      required: ['location'],
    },
    async handler({ location, days = 3 }) {
      const res = await fetch(`https://api.example.com/forecast?q=${encodeURIComponent(location)}&days=${days}`);
      return await res.json();
    },
  }),
]);

server.start();
```

### Registering with tool_create

```
tool_create({
  name: "weather",
  code: "<full source code above>",
  description: "Weather lookup tools",
  env: { WEATHER_API_KEY: "your-key" }
})
```

The server file is saved to `integrations/weather/mcp-server.js`. New tools become available after the current turn completes (the daemon auto-restarts the Wire client).

## Installing Community MCP Servers

Use `tool_install_community` to install servers from npm:

```
tool_install_community({
  name: "filesystem",
  package: "@modelcontextprotocol/server-filesystem",
  args: ["/home/user/documents"],
})
```

```
tool_install_community({
  name: "github",
  package: "@modelcontextprotocol/server-github",
  env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" }
})
```

The package is installed via npm and registered in `config/integrations.yaml` with `command: npx`.

## Managing Servers

- `tool_list_servers` — see all registered MCP servers and their status
- `tool_remove({ name: "weather" })` — remove a server
- `tool_remove({ name: "weather", delete_files: true })` — remove and delete files

## Tips

- Tool names should use `snake_case` and be prefixed by domain (e.g. `weather_current`, `github_create_issue`)
- Keep servers focused — one domain per server
- Use `env` for secrets (API keys, tokens) so they're not hardcoded in source
- Handlers can be async for network calls
- Return structured objects — the framework JSON-serializes them automatically
