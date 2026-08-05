import { config } from './config.js';
import { logger } from './logger.js';
import { runMigrations } from './db/migrate.js';
import { buildServer } from './server.js';
import { startScheduler } from './scheduler.js';

async function main() {
  logger.info('=== goodreads-sync v3 starting ===');
  logger.info(
    { dbPath: config.dbPath, port: config.port, tz: config.timezone, syncCron: config.syncCronSchedule },
    'Configuration'
  );

  runMigrations();

  const app = buildServer();
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info(`Dashboard listening on http://0.0.0.0:${config.port}`);

  startScheduler();

  // Phase 2+: folder scan, daily digest, and dashboard routes get added here.
}

main().catch((err) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
