ALTER TABLE `orders` MODIFY COLUMN `userId` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `guestToken` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_guestToken_unique` UNIQUE(`guestToken`);