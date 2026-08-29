CREATE TABLE `developerApiKeys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`keyPrefix` varchar(24) NOT NULL,
	`secretHash` varchar(64) NOT NULL,
	`scopesJson` json NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`rateLimitPerMinute` int NOT NULL DEFAULT 5,
	`lastUsedAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `developerApiKeys_id` PRIMARY KEY(`id`),
	CONSTRAINT `developer_api_key_hash_unique` UNIQUE(`secretHash`),
	CONSTRAINT `developer_api_key_prefix_unique` UNIQUE(`keyPrefix`)
);
--> statement-breakpoint
ALTER TABLE `developerApiKeys` ADD CONSTRAINT `developerApiKeys_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;