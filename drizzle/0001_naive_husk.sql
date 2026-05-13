CREATE TABLE `images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`imageKey` varchar(512) NOT NULL,
	`imageUrl` text NOT NULL,
	`mimeType` varchar(50) NOT NULL DEFAULT 'image/png',
	`fileSize` int,
	`generationModel` varchar(100) NOT NULL DEFAULT 'pixar-3d',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`paymentStatus` enum('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid',
	`originalImageKey` varchar(512) NOT NULL,
	`originalImageUrl` text NOT NULL,
	`generatedImageKey` varchar(512),
	`generatedImageUrl` text,
	`previewImageKey` varchar(512),
	`previewImageUrl` text,
	`previewGeneratedAt` timestamp,
	`stripePaymentIntentId` varchar(255),
	`amount` decimal(10,2) NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'usd',
	`childName` varchar(255),
	`story` text,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`paidAt` timestamp,
	`completedAt` timestamp,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `previewImages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`imageKey` varchar(512) NOT NULL,
	`imageUrl` text NOT NULL,
	`mimeType` varchar(50) NOT NULL DEFAULT 'image/png',
	`resolution` varchar(20) NOT NULL DEFAULT '512x512',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `previewImages_id` PRIMARY KEY(`id`)
);
