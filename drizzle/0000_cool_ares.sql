CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`email` text NOT NULL,
	`location` text,
	`time_availability` text,
	`languages` text,
	`motivation` text NOT NULL,
	`contribution` text NOT NULL,
	`experience_areas` text,
	`proud_project` text,
	`resonance_combined` text,
	`nature_community_meaning` text,
	`values` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` text NOT NULL,
	`snapshot_proposal_id` text,
	`snapshot_proposal_link` text,
	`ai_recommendation` text
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`age` integer
);
