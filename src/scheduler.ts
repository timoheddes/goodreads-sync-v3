import axios from 'axios';
import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { runCycle } from './cycle.js';
import { sleep } from './utils.js';

async function waitForFlareSolverr(maxRetries = 30, intervalMs = 5000): Promise<void> {
  const healthUrl = config.flareSolverrUrl.replace('/v1', '/health');
  logger.info({ healthUrl }, 'Waiting for FlareSolverr...');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.get(healthUrl, { timeout: 5000, validateStatus: () => true });
      logger.info({ attempt, status: res.status }, 'FlareSolverr is ready');
      return;
    } catch (err) {
      logger.info({ attempt, maxRetries }, 'FlareSolverr not ready yet');
      if (attempt < maxRetries) await sleep(intervalMs);
    }
  }

  logger.warn('FlareSolverr did not become ready in time -- proceeding anyway');
}

/**
 * Starts the background sync loop: an immediate run on boot (after
 * FlareSolverr is reachable), then every config.syncCronSchedule (default
 * every 10 minutes). SIGUSR1 still works as a manual trigger, same as v2,
 * for scripting/debugging -- the dashboard (Phase 4) will add a button that
 * does the same thing via the API.
 */
export function startScheduler(): void {
  process.on('SIGUSR1', () => {
    logger.info('Received SIGUSR1 -- triggering manual cycle');
    void runCycle('manual');
  });

  cron.schedule(config.syncCronSchedule, () => {
    void runCycle('cron');
  });

  logger.info({ schedule: config.syncCronSchedule }, 'Scheduler started');

  void (async () => {
    await sleep(5000); // let the container network settle
    await waitForFlareSolverr();
    await runCycle('startup');
  })();
}
