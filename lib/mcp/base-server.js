import { createInterface } from 'readline';

/**
 * Minimal MCP server over stdio (JSON-RPC 2.0).
 * Each MCP server is a separate Node.js process spawned by Kimi CLI.
 *
 * Protocol: newline-delimited JSON on stdin/stdout.
 * Implements: initialize, tools/list, tools/call
 */
export class McpServer {
  constructor({ name, version = '0.1.0' }) {
    this.name = name;
    this.version = version;
    this.tools = new Map();
    this.initialized = false;
  }

  addTool(tool) {
    this.tools.set(tool.name, tool);
  }

  addTools(tools) {
    for (const tool of tools) {
      this.addTool(tool);
    }
  }

  start() {
    const reader = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    reader.on('line', async (line) => {
      if (!line.trim()) return;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }

      try {
        const result = await this._handleMessage(msg);
        if (result !== undefined) {
          this._send({ jsonrpc: '2.0', id: msg.id, result });
        }
      } catch (err) {
        this._send({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32603, message: err.message },
        });
      }
    });

    reader.on('close', () => {
      process.exit(0);
    });

    // Keep process alive
    process.stdin.resume();
  }

  async _handleMessage(msg) {
    const { method, params } = msg;

    switch (method) {
      case 'initialize':
        return this._initialize(params);

      case 'notifications/initialized':
        // Client acknowledges initialization — no response needed
        return undefined;

      case 'tools/list':
        return this._listTools();

      case 'tools/call':
        return this._callTool(params);

      case 'ping':
        return {};

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  _initialize(params) {
    this.initialized = true;
    return {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: this.name,
        version: this.version,
      },
    };
  }

  _listTools() {
    const tools = [];
    for (const [, tool] of this.tools) {
      tools.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
    return { tools };
  }

  async _callTool(params) {
    const { name, arguments: args } = params;
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await tool.handler(args || {});
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text }],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  _send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }
}
