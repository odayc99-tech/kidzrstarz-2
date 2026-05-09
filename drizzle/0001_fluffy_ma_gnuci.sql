CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`guestToken` varchar(64),
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`paymentStatus` enum('unpaid','paid','refunded') NOT NULL DEFAULT 'unpaid',
	`originalImageUrl` text,
	`generatedImageUrl` text,
	`story` text,
	`storyApproved` boolean NOT NULL DEFAULT false,
	`storyTheme` varchar(100),
	`childName` varchar(100),
	`childAge` varchar(20),
	`videoKey` varchar(512),
	`videoUrl` text,
	`errorMessage` text,
	`voiceSampleUrl` text,
	`elevenlabsVoiceId` varchar(255),
	`shareToken` varchar(64),
	`stripeSessionId` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storyScenes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`sceneIndex` int NOT NULL,
	`sceneText` text,
	`illustrationPrompt` text,
	`illustrationUrl` text,
	`narrationUrl` text,
	`status` enum('pending','generating_image','generating_audio','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storyScenes_id` PRIMARY KEY(`id`)
);
