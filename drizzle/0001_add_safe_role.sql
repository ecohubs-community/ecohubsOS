ALTER TABLE `user` ADD COLUMN `safe_role` text DEFAULT 'owner';
--> statement-breakpoint
ALTER TABLE `user` ADD COLUMN `safe_role_status` text;
