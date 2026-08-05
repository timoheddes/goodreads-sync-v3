import { logger } from './logger.js';
import { listUsers } from './db/repo.js';
import { syncAllShelves } from './rss.js';
import { processQueue, type QueueSummary } from './queue.js';

let cycleRunning = false;

/**
 * One full sync cycle: check every user's shelf for changes (cheap thanks
 * to the feed-hash short-circuit), then work through the download queue.
 * Guarded against overlapping runs -- if a cycle is still in progress when
 * the next cron tick or manual trigger fires, it's skipped rather than
 * queued up.
 */
export async function runCycle(trigger: string): Promise<QueueSummary | null> {
  if (cycleRunning) {
    logger.warn({ trigger }, 'Cycle already running, ignoring trigger');
    return null;
  }

  cycleRunning = true;
  const start = Date.now();
  logger.info({ trigger }, '=== CYCLE START ===');

  try {
    const users = listUsers();
    if (users.length === 0) {
      logger.warn('No users configured yet -- add one from the dashboard');
      return null;
    }

    await syncAllShelves(users);
    const summary = await processQueue();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    logger.info({ trigger, elapsedSeconds: elapsed }, '=== CYCLE END ===');
    return summary;
  } catch (err) {
    logger.error({ err, trigger }, 'Cycle failed');
    return null;
  } finally {
    cycleRunning = false;
  }
}

export function isCycleRunning(): boolean {
  return cycleRunning;
}
