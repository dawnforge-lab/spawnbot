/**
 * Define an MCP tool with name, description, JSON Schema input, and handler.
 */
export function defineTool({ name, description, inputSchema = {}, handler }) {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      ...inputSchema,
    },
    handler,
  };
}
