import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// --- Memories ---
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(), // UUID
  content: text('content').notNull(),
  category: text('category'), // emotional, factual, preference, interaction, task
  importance: real('importance').default(0.5), // 0.0–1.0, decays over time
  source: text('source'), // telegram, autonomous, x, system
  metadata: text('metadata'), // JSON blob
  createdAt: integer('created_at').notNull(),
  lastAccessedAt: integer('last_accessed_at'),
});

// --- Conversations ---
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  source: text('source').notNull(), // telegram, x, autonomous, cron
  senderId: text('sender_id'),
  senderName: text('sender_name'),
  inputText: text('input_text'),
  outputText: text('output_text'),
  toolsUsed: text('tools_used'), // JSON array
  turnDurationMs: integer('turn_duration_ms'),
  createdAt: integer('created_at').notNull(),
});

// --- Tasks ---
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  templateId: text('template_id'),
  category: text('category'),
  description: text('description').notNull(),
  intensity: integer('intensity').default(1),
  status: text('status').default('pending'), // pending, active, completed, failed, cancelled
  priority: text('priority').default('normal'), // critical, high, normal, low
  assignedAt: integer('assigned_at'),
  deadlineAt: integer('deadline_at'),
  completedAt: integer('completed_at'),
  proofType: text('proof_type'), // photo, video, text
  proofReceived: integer('proof_received', { mode: 'boolean' }).default(false),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at').notNull(),
});

// --- Revenue ---
export const revenue = sqliteTable('revenue', {
  id: text('id').primaryKey(),
  amount: real('amount').notNull(),
  currency: text('currency').default('GBP'),
  source: text('source'), // payment, task, tip, subscription
  description: text('description'),
  metadata: text('metadata'), // JSON
  createdAt: integer('created_at').notNull(),
});

// --- State (key-value) ---
export const state = sqliteTable('state', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at').notNull(),
});

// --- Events (audit log) ---
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // input, output, tool_call, error, safeword, restart
  source: text('source'),
  summary: text('summary'),
  data: text('data'), // JSON
  createdAt: integer('created_at').notNull(),
});
