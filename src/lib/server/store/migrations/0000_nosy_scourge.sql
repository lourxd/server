CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_id` text,
	`user_email` text,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`ok` integer DEFAULT true NOT NULL,
	`ip` text
);
--> statement-breakpoint
CREATE INDEX `audit_log_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE TABLE `db_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`host` text DEFAULT '',
	`port` integer,
	`user` text DEFAULT '',
	`password` text DEFAULT '',
	`database` text DEFAULT '',
	`file` text DEFAULT '',
	`url` text DEFAULT '',
	`ssl` integer DEFAULT false NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`create_if_missing` integer DEFAULT false NOT NULL,
	`color` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_connections_name_idx` ON `db_connections` (`name`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`encrypted` integer DEFAULT false NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tunnel_routes` (
	`id` text PRIMARY KEY NOT NULL,
	`tunnel_id` text NOT NULL,
	`hostname` text NOT NULL,
	`service` text NOT NULL,
	`path` text,
	`dns_record_id` text,
	`zone_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`tunnel_id`) REFERENCES `tunnels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tunnel_routes_tunnel_idx` ON `tunnel_routes` (`tunnel_id`);--> statement-breakpoint
CREATE TABLE `tunnels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cf_tunnel_id` text,
	`account_id` text,
	`kind` text DEFAULT 'named' NOT NULL,
	`token` text DEFAULT '',
	`pm2_name` text,
	`quick_url` text,
	`last_status` text DEFAULT 'unknown',
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tunnels_name_idx` ON `tunnels` (`name`);