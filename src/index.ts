import { config } from './config.js';
import { logger } from './logger.js';
import { runMigrations } from './db/migrate.js';
import { sqlite } from './db/index.js';
import { buildServer } from './server.js';
import { startScheduler } from './scheduler.js';

// Crash safety net (Phase 5): once Node fires uncaughtException, the
// process is in an unreliable state -- Node's own docs say not to resume
// normal operation. So this deliberately does NOT try to close the server
// or DB gracefully (unlike shutdown() below); it just logs with full
// context and exits, so `restart: unless-stopped` brings up a clean
// process instead of the container silently hanging in a broken state.
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception -- exiting so the container restarts');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection -- exiting so the container restarts');
  process.exit(1);
});

async function main() {
  logger.info('=== goodreads-sync v3 starting ===');
  logger.info(
    { dbPath: config.dbPath, port: config.port, tz: config.timezone, syncCron: config.syncCronSchedule },
    'Configuration'
  );

  runMigrations();

  const app = await buildServer();
  await app.listen({ host: '0.0.0.0', port: config.port });
  logger.info(`Dashboard listening on http://0.0.0.0:${config.port}`);

  startScheduler();

  // Graceful shutdown (Phase 5): Docker sends SIGTERM on stop/restart/
  // redeploy. Stop taking new HTTP requests (letting in-flight ones
  // finish), close the sqlite handle cleanly, then exit. A background
  // sync/scan/digest that's mid-run when this fires is NOT waited on --
  // those can take minutes, far longer than Docker's ~10s stop grace
  // period, so waiting would just guarantee a SIGKILL instead. Better-
  // sqlite3's WAL mode is transactional, so an interrupted background job
  // just resumes cleanly on the next cycle rather than corrupting anything.
  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down...');

    const forceExitTimer = setTimeout(() => {
      logger.warn('Shutdown taking too long -- forcing exit');
      process.exit(1);
    }, 8000);
    forceExitTimer.unref();

    try {
      await app.close();
      sqlite.close();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error(err, 'Fatal error during startup');
  process.exit(1);
});
