CREATE TABLE `developerApiUsage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`apiKeyId` int NOT NULL,
	`itemCount` int NOT NULL,
	`matchCount` int NOT NULL DEFAULT 0,
	`noMatchCount` int NOT NULL DEFAULT 0,
	`unavailableCount` int NOT NULL DEFAULT 0,
	`latencyMs` int NOT NULL,
	`httpStatus` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `developerApiUsage_id` PRIMARY KEY(`id`),
	CONSTRAINT `developer_api_usage_key_created_unique` UNIQUE(`apiKeyId`,`createdAt`)
);
--> statement-breakpoint
ALTER TABLE `developerApiUsage` ADD CONSTRAINT `developerApiUsage_apiKeyId_developerApiKeys_id_fk` FOREIGN KEY (`apiKeyId`) REFERENCES `developerApiKeys`(`id`) ON DELETE cascade ON UPDATE no action;