ALTER TABLE `orders` ADD `shareToken` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_shareToken_unique` UNIQUE(`shareToken`);