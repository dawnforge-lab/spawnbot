CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`sender_id` text,
	`sender_name` text,
	`input_text` text,
	`output_text` text,
	`tools_used` text,
	`turn_duration_ms` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`source` text,
	`summary` text,
	`data` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`category` text,
	`importance` real DEFAULT 0.5,
	`source` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	`last_accessed_at` integer
);
--> statement-breakpoint
CREATE TABLE `revenue` (
	`id` text PRIMARY KEY NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'GBP',
	`source` text,
	`description` text,
	`metadata` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text,
	`category` text,
	`description` text NOT NULL,
	`intensity` integer DEFAULT 1,
	`status` text DEFAULT 'pending',
	`priority` text DEFAULT 'normal',
	`assigned_at` integer,
	`deadline_at` integer,
	`completed_at` integer,
	`proof_type` text,
	`proof_received` integer DEFAULT false,
	`metadata` text,
	`created_at` integer NOT NULL
);
