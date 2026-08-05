import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './index.js';
import { logger } from '../logger.js';

/**
 * Runs any pending Drizzle migrations against the SQLite file at config.dbPath.
 * Called once on every boot -- safe to run repeatedly, Drizzle tracks which
 * migrations have already been applied in a `__drizzle_migrations` table.
 */
export function runMigrations() {
  logger.info('Running database migrations...');
  migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Database migrations up to date.');
}
