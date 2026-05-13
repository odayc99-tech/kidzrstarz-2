CREATE TABLE `storyScenes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int NOT NULL,
	`sceneIndex` int NOT NULL,
	`sceneText` text NOT NULL,
	`illustrationPrompt` text,
	`illustrationUrl` text,
	`illustrationKey` varchar(512),
	`narrationUrl` text,
	`narrationKey` varchar(512),
	`status` enum('pending','generating_image','generating_audio','completed','failed') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storyScenes_id` PRIMARY KEY(`id`)
);
