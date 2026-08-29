CREATE TABLE `checkHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`policyId` int,
	`inputType` enum('text','image') NOT NULL,
	`inputValue` text NOT NULL,
	`decision` enum('allow','blur','block','warn','uncertain') NOT NULL,
	`confidence` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`cacheStatus` enum('fresh','cached') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `checkHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`sourcePreference` text NOT NULL,
	`language` varchar(8) NOT NULL,
	`action` enum('blur','block','warn') NOT NULL,
	`scopeText` boolean NOT NULL DEFAULT true,
	`scopeImages` boolean NOT NULL DEFAULT true,
	`rulesJson` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `policies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `checkHistory` ADD CONSTRAINT `checkHistory_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `checkHistory` ADD CONSTRAINT `checkHistory_policyId_policies_id_fk` FOREIGN KEY (`policyId`) REFERENCES `policies`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `policies` ADD CONSTRAINT `policies_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;