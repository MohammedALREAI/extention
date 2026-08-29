CREATE INDEX `developer_api_usage_key_created_idx` ON `developerApiUsage` (`apiKeyId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `developerApiUsage` DROP INDEX `developer_api_usage_key_created_unique`;
