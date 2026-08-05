CREATE TABLE `books` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`goodreads_book_id` text,
	`isbn` text,
	`title` text,
	`author` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text DEFAULT 'goodreads' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`last_error` text,
	`file_path` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`downloaded_at` integer
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shelf_state` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`feed_hash` text,
	`last_checked_at` integer,
	`last_changed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_books` (
	`user_id` integer NOT NULL,
	`book_id` integer NOT NULL,
	`notified_at` integer,
	PRIMARY KEY(`user_id`, `book_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`goodreads_id` text NOT NULL,
	`download_path` text NOT NULL,
	`email` text,
	`created_at` integer NOT NULL,
	`last_digest_sent_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_goodreads_book_id_unique` ON `books` (`goodreads_book_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_goodreads_id_unique` ON `users` (`goodreads_id`);