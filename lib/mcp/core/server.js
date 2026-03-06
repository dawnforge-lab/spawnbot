import { McpServer } from '../base-server.js';
import { defineTool } from '../tool.js';
import { v4 as uuid } from 'uuid';
import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import {
  storeMemory,
  recallMemory,
  searchMemories,
  decayMemories,
  deleteMemory,
} from '../../db/memory.js';
import { loadFlowSkill, listFlowSkills } from '../../flow/loader.js';
import { initDatabase, getSqlite } from '../../db/index.js';
import {
  searchPlaybook,
  getPlaybookCategories,
  selectRandomAction,
} from './playbook.js';

// --- Init ---

const projectRoot = process.env.PROJECT_ROOT || process.cwd();
const dbPath = process.env.DATABASE_PATH || resolve(projectRoot, 'data', 'agent.sqlite');
const playbookPath = process.env.PLAYBOOK_PATH || resolve(projectRoot, 'config', 'PLAYBOOK.yaml');

initDatabase(dbPath);

const server = new McpServer({ name: 'agent-tools' });

// ============================================================
// Memory Tools
// ============================================================

server.addTools([
  defineTool({
    name: 'memory_store',
    description: 'Store a new memory. Categories: emotional, factual, preference, interaction, task, relationship.',
    inputSchema: {
      properties: {
        content: { type: 'string', description: 'Memory content to store' },
        category: { type: 'string', description: 'Memory category' },
        importance: { type: 'number', description: 'Importance 0.0-1.0 (default 0.5)' },
        source: { type: 'string', description: 'Where this memory came from' },
      },
      required: ['content'],
    },
    async handler({ content, category, importance, source }) {
      return await storeMemory({ content, category, importance, source });
    },
  }),

  defineTool({
    name: 'memory_recall',
    description: 'Search memories using full-text search. Returns the most relevant memories ranked by relevance and importance.',
    inputSchema: {
      properties: {
        query: { type: 'string', description: 'Search query (supports FTS5 syntax)' },
        category: { type: 'string', description: 'Filter by category' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
    handler({ query, category, limit }) {
      return recallMemory(query, { category, limit });
    },
  }),

  defineTool({
    name: 'memory_search',
    description: 'Browse memories by category. No search query needed — just filters.',
    inputSchema: {
      properties: {
        category: { type: 'string', description: 'Filter by category' },
        source: { type: 'string', description: 'Filter by source' },
        min_importance: { type: 'number', description: 'Min importance threshold' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler({ category, source, min_importance, limit }) {
      return searchMemories({ category, source, limit, minImportance: min_importance });
    },
  }),

  defineTool({
    name: 'memory_delete',
    description: 'Delete a specific memory by its ID.',
    inputSchema: {
      properties: {
        id: { type: 'string', description: 'Memory ID to delete' },
      },
      required: ['id'],
    },
    handler({ id }) {
      return deleteMemory(id);
    },
  }),

  // ============================================================
  // Playbook Tools (PLAYBOOK.yaml — action templates)
  // ============================================================

  defineTool({
    name: 'playbook_search',
    description: 'Search the playbook for action templates. Filter by category or keyword.',
    inputSchema: {
      properties: {
        category: { type: 'string', description: 'Category name to filter by' },
        keyword: { type: 'string', description: 'Keyword to search in action names/descriptions' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler({ category, keyword, limit }) {
      return searchPlaybook(playbookPath, { category, keyword, limit });
    },
  }),

  defineTool({
    name: 'playbook_categories',
    description: 'List all playbook categories with action counts.',
    inputSchema: { properties: {} },
    handler() {
      return getPlaybookCategories(playbookPath);
    },
  }),

  defineTool({
    name: 'playbook_random',
    description: 'Select a random action from a playbook category.',
    inputSchema: {
      properties: {
        category: { type: 'string', description: 'Category to pick from' },
      },
      required: ['category'],
    },
    handler({ category }) {
      return selectRandomAction(playbookPath, { category });
    },
  }),

  // ============================================================
  // Task Assignment Tools (SQLite)
  // ============================================================

  defineTool({
    name: 'task_assign',
    description: 'Create a new task. Saves to database with deadline and priority.',
    inputSchema: {
      properties: {
        description: { type: 'string', description: 'Task description' },
        template_id: { type: 'string', description: 'Playbook template ID (optional)' },
        category: { type: 'string', description: 'Task category' },
        priority: { type: 'string', description: 'critical, high, normal, low' },
        deadline_hours: { type: 'number', description: 'Hours until deadline' },
      },
      required: ['description'],
    },
    handler({ description, template_id, category, priority, deadline_hours }) {
      const sqlite = getSqlite();
      const id = uuid();
      const now = Date.now();
      const deadlineAt = deadline_hours ? now + deadline_hours * 3_600_000 : null;

      sqlite.prepare(`
        INSERT INTO tasks (id, template_id, category, description, status, priority, assigned_at, deadline_at, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(id, template_id || null, category || null, description, priority || 'normal', now, deadlineAt, now);

      return { id, status: 'active', deadline_at: deadlineAt };
    },
  }),

  defineTool({
    name: 'task_list',
    description: 'List tasks by status. Shows active, pending, completed, or failed tasks.',
    inputSchema: {
      properties: {
        status: { type: 'string', description: 'Filter by status: active, pending, completed, failed, all (default: active)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler({ status, limit = 20 }) {
      const sqlite = getSqlite();
      const filterStatus = status || 'active';

      let rows;
      if (filterStatus === 'all') {
        rows = sqlite.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit);
      } else {
        rows = sqlite.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(filterStatus, limit);
      }

      return rows.map(r => ({
        id: r.id,
        description: r.description,
        category: r.category,
        status: r.status,
        priority: r.priority,
        assignedAt: r.assigned_at,
        deadlineAt: r.deadline_at,
        completedAt: r.completed_at,
      }));
    },
  }),

  defineTool({
    name: 'task_complete',
    description: 'Mark a task as completed.',
    inputSchema: {
      properties: {
        id: { type: 'string', description: 'Task ID' },
      },
      required: ['id'],
    },
    handler({ id }) {
      const sqlite = getSqlite();
      const now = Date.now();
      const result = sqlite.prepare(
        'UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?'
      ).run('completed', now, id);

      return { updated: result.changes > 0, status: 'completed' };
    },
  }),

  defineTool({
    name: 'task_update',
    description: 'Update a task status or details.',
    inputSchema: {
      properties: {
        id: { type: 'string', description: 'Task ID' },
        status: { type: 'string', description: 'New status: active, pending, completed, failed, cancelled' },
        priority: { type: 'string', description: 'New priority' },
        description: { type: 'string', description: 'Updated description' },
      },
      required: ['id'],
    },
    handler({ id, status, priority, description }) {
      const sqlite = getSqlite();
      const sets = [];
      const values = [];

      if (status) { sets.push('status = ?'); values.push(status); }
      if (priority) { sets.push('priority = ?'); values.push(priority); }
      if (description) { sets.push('description = ?'); values.push(description); }
      if (status === 'completed') { sets.push('completed_at = ?'); values.push(Date.now()); }

      if (sets.length === 0) return { updated: false, reason: 'No fields to update' };

      values.push(id);
      const result = sqlite.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      return { updated: result.changes > 0 };
    },
  }),

  // ============================================================
  // State Tools (key-value)
  // ============================================================

  defineTool({
    name: 'state_get',
    description: 'Get a value from the persistent state store.',
    inputSchema: {
      properties: {
        key: { type: 'string', description: 'State key' },
      },
      required: ['key'],
    },
    handler({ key }) {
      const sqlite = getSqlite();
      const row = sqlite.prepare('SELECT value, updated_at FROM state WHERE key = ?').get(key);
      if (!row) return { key, value: null, exists: false };
      return { key, value: JSON.parse(row.value), updatedAt: row.updated_at, exists: true };
    },
  }),

  defineTool({
    name: 'state_set',
    description: 'Set a value in the persistent state store. Values are JSON-encoded.',
    inputSchema: {
      properties: {
        key: { type: 'string', description: 'State key' },
        value: { description: 'Value to store (any JSON type)' },
      },
      required: ['key', 'value'],
    },
    handler({ key, value }) {
      const sqlite = getSqlite();
      const now = Date.now();
      const json = JSON.stringify(value);

      sqlite.prepare(
        'INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?'
      ).run(key, json, now, json, now);

      return { key, stored: true };
    },
  }),

  // ============================================================
  // Agent Status
  // ============================================================

  defineTool({
    name: 'agent_status',
    description: 'Get a comprehensive overview: active tasks, recent memories, recent events, and system uptime.',
    inputSchema: { properties: {} },
    handler() {
      const sqlite = getSqlite();
      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      // Active tasks
      const activeTasks = sqlite.prepare(
        'SELECT COUNT(*) as count FROM tasks WHERE status = ?'
      ).get('active');

      // Overdue tasks
      const overdueTasks = sqlite.prepare(
        'SELECT COUNT(*) as count FROM tasks WHERE status = ? AND deadline_at < ?'
      ).get('active', now);

      // Tasks completed today
      const completedToday = sqlite.prepare(
        'SELECT COUNT(*) as count FROM tasks WHERE status = ? AND completed_at >= ?'
      ).get('completed', todayStart.getTime());

      // Total memories
      const memoryCount = sqlite.prepare('SELECT COUNT(*) as count FROM memories').get();

      // Recent events
      const recentEvents = sqlite.prepare(
        'SELECT type, summary, created_at FROM events ORDER BY created_at DESC LIMIT 5'
      ).all();

      return {
        tasks: {
          active: activeTasks.count,
          overdue: overdueTasks.count,
          completedToday: completedToday.count,
        },
        memories: memoryCount.count,
        recentEvents: recentEvents.map(e => ({
          type: e.type,
          summary: e.summary,
          at: e.created_at,
        })),
        uptime: process.uptime(),
      };
    },
  }),

  // ============================================================
  // Conversation Log
  // ============================================================

  defineTool({
    name: 'convo_log',
    description: 'Log a conversation turn (input + output) for audit and continuity.',
    inputSchema: {
      properties: {
        source: { type: 'string', description: 'Input source: telegram, x, autonomous, cron' },
        sender_id: { type: 'string', description: 'Sender identifier' },
        sender_name: { type: 'string', description: 'Sender display name' },
        input_text: { type: 'string', description: 'What was received' },
        output_text: { type: 'string', description: 'What the agent responded' },
        tools_used: { type: 'array', items: { type: 'string' }, description: 'List of tools used' },
        turn_duration_ms: { type: 'number', description: 'How long the turn took' },
      },
      required: ['source', 'input_text'],
    },
    handler({ source, sender_id, sender_name, input_text, output_text, tools_used, turn_duration_ms }) {
      const sqlite = getSqlite();
      const id = uuid();
      const now = Date.now();

      sqlite.prepare(`
        INSERT INTO conversations (id, source, sender_id, sender_name, input_text, output_text, tools_used, turn_duration_ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, source, sender_id || null, sender_name || null, input_text, output_text || null, tools_used ? JSON.stringify(tools_used) : null, turn_duration_ms || null, now);

      return { id, logged: true };
    },
  }),

  defineTool({
    name: 'convo_history',
    description: 'Retrieve recent conversation history.',
    inputSchema: {
      properties: {
        source: { type: 'string', description: 'Filter by source' },
        sender_id: { type: 'string', description: 'Filter by sender' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler({ source, sender_id, limit = 20 }) {
      const sqlite = getSqlite();

      let query = 'SELECT * FROM conversations';
      const conditions = [];
      const params = [];

      if (source) { conditions.push('source = ?'); params.push(source); }
      if (sender_id) { conditions.push('sender_id = ?'); params.push(sender_id); }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      query += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const rows = sqlite.prepare(query).all(...params);

      return rows.map(r => ({
        id: r.id,
        source: r.source,
        senderName: r.sender_name,
        input: r.input_text,
        output: r.output_text,
        toolsUsed: r.tools_used ? JSON.parse(r.tools_used) : [],
        durationMs: r.turn_duration_ms,
        at: r.created_at,
      }));
    },
  }),

  // ============================================================
  // Event Log
  // ============================================================

  defineTool({
    name: 'event_log',
    description: 'Log a system event for the audit trail.',
    inputSchema: {
      properties: {
        type: { type: 'string', description: 'Event type: input, output, tool_call, error, safeword, restart, milestone' },
        source: { type: 'string', description: 'Event source' },
        summary: { type: 'string', description: 'Brief event summary' },
        data: { description: 'Additional event data (any JSON type)' },
      },
      required: ['type', 'summary'],
    },
    handler({ type, source, summary, data }) {
      const sqlite = getSqlite();
      const now = Date.now();

      sqlite.prepare(
        'INSERT INTO events (type, source, summary, data, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(type, source || null, summary, data ? JSON.stringify(data) : null, now);

      return { logged: true };
    },
  }),

  // ============================================================
  // Tool Management
  // ============================================================

  defineTool({
    name: 'tool_list_servers',
    description: 'List all registered MCP servers, their entry points, and enabled status.',
    inputSchema: { properties: {} },
    handler() {
      const servers = [];

      // Read generated mcp.json
      const mcpJsonPath = resolve(projectRoot, 'data', 'mcp.json');
      if (existsSync(mcpJsonPath)) {
        const mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
        for (const [name, config] of Object.entries(mcpConfig.mcpServers || {})) {
          servers.push({
            name,
            command: config.command,
            args: config.args,
            active: true,
          });
        }
      }

      // Read integrations.yaml for disabled servers
      const intPath = resolve(projectRoot, 'config', 'integrations.yaml');
      if (existsSync(intPath)) {
        const intConfig = yamlParse(readFileSync(intPath, 'utf8'));
        for (const [name, config] of Object.entries(intConfig?.integrations || {})) {
          if (!config.enabled && !servers.find(s => s.name === name)) {
            servers.push({ name, active: false, enabled: false });
          }
        }
      }

      return { servers };
    },
  }),

  defineTool({
    name: 'tool_create',
    description: `Create a new custom MCP server. Write the full JavaScript source code for the server. Use McpServer from lib/mcp/base-server.js and defineTool from lib/mcp/tool.js. The server file is saved to integrations/<name>/mcp-server.js and registered in integrations.yaml. New tools become available after the current turn completes.`,
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Integration name (lowercase, no spaces)' },
        code: { type: 'string', description: 'Full JavaScript source code for the MCP server' },
        description: { type: 'string', description: 'Brief description of what this server does' },
        env: { type: 'object', description: 'Environment variables needed (key-value pairs)' },
      },
      required: ['name', 'code'],
    },
    handler({ name, code, description, env }) {
      // Validate name
      if (!/^[a-z0-9_-]+$/.test(name)) {
        return { error: 'Name must be lowercase alphanumeric with hyphens/underscores only' };
      }

      // Write MCP server file
      const integrationDir = resolve(projectRoot, 'integrations', name);
      if (!existsSync(integrationDir)) mkdirSync(integrationDir, { recursive: true });
      const serverPath = resolve(integrationDir, 'mcp-server.js');
      writeFileSync(serverPath, code, 'utf8');

      // Update integrations.yaml
      updateIntegrationsYaml(name, { enabled: true, description, env });

      // Regenerate mcp.json
      regenerateMcpConfig();

      return {
        created: true,
        path: serverPath,
        note: 'New tools will be available after the current turn completes.',
      };
    },
  }),

  defineTool({
    name: 'tool_install_community',
    description: 'Install a community MCP server from npm. The package is installed and registered in integrations.yaml with the specified command and args.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Integration name to register under' },
        package: { type: 'string', description: 'npm package name (e.g. @modelcontextprotocol/server-filesystem)' },
        args: { type: 'array', items: { type: 'string' }, description: 'CLI arguments for the server command' },
        env: { type: 'object', description: 'Environment variables needed (key-value pairs)' },
      },
      required: ['name', 'package'],
    },
    handler({ name, package: pkg, args = [], env }) {
      // Validate name
      if (!/^[a-z0-9_-]+$/.test(name)) {
        return { error: 'Name must be lowercase alphanumeric with hyphens/underscores only' };
      }

      // Install npm package
      try {
        execSync(`npm install ${pkg}`, { cwd: projectRoot, stdio: 'pipe', timeout: 60000 });
      } catch (err) {
        return { error: `Failed to install ${pkg}: ${err.stderr?.toString() || err.message}` };
      }

      // Update integrations.yaml with command/args
      updateIntegrationsYaml(name, {
        enabled: true,
        command: 'npx',
        args: [pkg, ...args],
        env,
      });

      // Regenerate mcp.json
      regenerateMcpConfig();

      return {
        installed: true,
        package: pkg,
        note: 'New tools will be available after the current turn completes.',
      };
    },
  }),

  defineTool({
    name: 'tool_remove',
    description: 'Remove an integration MCP server. Disables it in integrations.yaml and regenerates the MCP config.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Integration name to remove' },
        delete_files: { type: 'boolean', description: 'Also delete the integration directory (default: false)' },
      },
      required: ['name'],
    },
    handler({ name, delete_files = false }) {
      const intPath = resolve(projectRoot, 'config', 'integrations.yaml');
      if (existsSync(intPath)) {
        const intConfig = yamlParse(readFileSync(intPath, 'utf8')) || {};
        if (intConfig.integrations?.[name]) {
          delete intConfig.integrations[name];
          writeFileSync(intPath, yamlStringify(intConfig, { lineWidth: 120 }), 'utf8');
        }
      }

      // Optionally delete files
      if (delete_files) {
        const integrationDir = resolve(projectRoot, 'integrations', name);
        if (existsSync(integrationDir)) {
          execSync(`rm -rf "${integrationDir}"`, { stdio: 'pipe' });
        }
      }

      // Regenerate mcp.json
      regenerateMcpConfig();

      return {
        removed: true,
        note: 'Changes effective after the current turn completes.',
      };
    },
  }),

  // ============================================================
  // Skill Management
  // ============================================================

  defineTool({
    name: 'skill_list',
    description: 'List all installed skills. Skills are on-demand knowledge documents you can read before performing specific kinds of work.',
    inputSchema: { properties: {} },
    handler() {
      const skillsDir = resolve(projectRoot, 'skills');
      if (!existsSync(skillsDir)) return { skills: [] };

      const skills = [];
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillPath = resolve(skillsDir, entry.name, 'SKILL.md');
        if (!existsSync(skillPath)) continue;

        const content = readFileSync(skillPath, 'utf8');
        skills.push({
          name: entry.name,
          preview: content.slice(0, 100).trim(),
        });
      }

      return { skills };
    },
  }),

  defineTool({
    name: 'skill_read',
    description: 'Read a skill to load its instructions into your context. Use this before performing work that requires specific knowledge (e.g. read "tool-creation" before creating an MCP server).',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Skill name to read' },
      },
      required: ['name'],
    },
    handler({ name }) {
      const skillPath = resolve(projectRoot, 'skills', name, 'SKILL.md');
      if (!existsSync(skillPath)) {
        return { error: `Skill "${name}" not found. Use skill_list to see available skills.` };
      }
      return readFileSync(skillPath, 'utf8');
    },
  }),

  defineTool({
    name: 'skill_create',
    description: 'Create a new skill. Skills are markdown knowledge documents stored at skills/<name>/SKILL.md.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Skill name (lowercase, no spaces)' },
        content: { type: 'string', description: 'Full markdown content for the skill' },
      },
      required: ['name', 'content'],
    },
    handler({ name, content }) {
      if (!/^[a-z0-9_-]+$/.test(name)) {
        return { error: 'Name must be lowercase alphanumeric with hyphens/underscores only' };
      }

      const skillDir = resolve(projectRoot, 'skills', name);
      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });

      const skillPath = resolve(skillDir, 'SKILL.md');
      writeFileSync(skillPath, content, 'utf8');

      return { created: true, path: skillPath };
    },
  }),

  defineTool({
    name: 'skill_remove',
    description: 'Delete a skill by name.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Skill name to remove' },
      },
      required: ['name'],
    },
    handler({ name }) {
      const skillDir = resolve(projectRoot, 'skills', name);
      if (!existsSync(skillDir)) {
        return { error: `Skill "${name}" not found.` };
      }

      rmSync(skillDir, { recursive: true, force: true });
      return { removed: true };
    },
  }),

  // ============================================================
  // Flow Tools (declarative multi-step workflows)
  // ============================================================

  defineTool({
    name: 'flow_list',
    description: 'List available flow skills — multi-step workflows defined as Mermaid flowcharts.',
    inputSchema: { properties: {} },
    handler() {
      const skillsDir = resolve(projectRoot, 'skills');
      const flows = listFlowSkills(skillsDir);
      return { flows };
    },
  }),

  defineTool({
    name: 'flow_read',
    description: 'Read a flow skill — returns its description, nodes, and edges.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Flow skill name' },
      },
      required: ['name'],
    },
    handler({ name }) {
      const skill = loadFlowSkill(resolve(projectRoot, 'skills', name, 'SKILL.md'));
      if (!skill) {
        return { error: `Flow "${name}" not found. Use flow_list to see available flows.` };
      }
      return {
        name: skill.name,
        description: skill.description,
        nodes: [...skill.flow.nodes.values()].map(n => ({ id: n.id, label: n.label, kind: n.kind })),
        edges: [...skill.flow.edges.values()].flat().map(e => ({ src: e.src, dst: e.dst, label: e.label })),
      };
    },
  }),

  defineTool({
    name: 'flow_start',
    description: 'Trigger a flow execution. The flow runs as a multi-turn sequence — each node is a full LLM turn with tool access. Enqueues the flow for the router to execute.',
    inputSchema: {
      properties: {
        name: { type: 'string', description: 'Flow skill name to execute' },
      },
      required: ['name'],
    },
    async handler({ name }) {
      const skill = loadFlowSkill(resolve(projectRoot, 'skills', name, 'SKILL.md'));
      if (!skill) {
        return { error: `Flow "${name}" not found. Use flow_list to see available flows.` };
      }

      // Send HTTP request to daemon to enqueue the flow
      // This avoids threading the queue through MCP
      try {
        const port = parseInt(process.env.HTTP_PORT || '31415', 10);
        const postData = JSON.stringify({ name });
        const { request } = await import('http');
        await new Promise((resolve, reject) => {
          const req = request({
            hostname: '127.0.0.1',
            port,
            path: '/api/flow',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.API_KEY || '',
              'Content-Length': Buffer.byteLength(postData),
            },
          }, (res) => {
            res.resume(); // drain
            resolve();
          });
          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      } catch {
        // Best effort — if HTTP fails, daemon may not be running
        return { error: 'Failed to reach daemon. Is the agent running?' };
      }

      return { started: true, name: skill.name, description: skill.description };
    },
  }),
]);

// ============================================================
// Tool Management Helpers
// ============================================================

/**
 * Update or add an integration entry in config/integrations.yaml.
 */
function updateIntegrationsYaml(name, config) {
  const intPath = resolve(projectRoot, 'config', 'integrations.yaml');
  let intConfig = { integrations: {} };

  if (existsSync(intPath)) {
    intConfig = yamlParse(readFileSync(intPath, 'utf8')) || { integrations: {} };
  }

  if (!intConfig.integrations) intConfig.integrations = {};

  // Merge with existing config
  const existing = intConfig.integrations[name] || {};
  intConfig.integrations[name] = { ...existing, ...config };

  // Ensure config directory exists
  const configDir = resolve(projectRoot, 'config');
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  writeFileSync(intPath, yamlStringify(intConfig, { lineWidth: 120 }), 'utf8');
}

/**
 * Regenerate data/mcp.json by importing and calling generateMcpConfig.
 */
async function regenerateMcpConfig() {
  try {
    const { generateMcpConfig } = await import('../../persona/mcp-config.js');
    generateMcpConfig(projectRoot);
  } catch {
    // Best effort — if it fails, the daemon will regenerate on restart
  }
}

server.start();
