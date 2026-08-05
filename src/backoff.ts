/**
 * Retry backoff for books that weren't found on Anna's Archive yet. There is
 * no attempt cap and no permanent failure state -- new titles get added to
 * Anna's Archive all the time, so a book that isn't there today might be
 * there next week. Instead, each failed attempt pushes the next retry
 * further out, exponentially, capped at a week, so the queue doesn't waste
 * cycles re-searching for the same not-yet-available book too often.
 *
 * attempts=1 -> 30m, 2 -> 2h, 3 -> 8h, 4 -> ~32h, 5 -> ~5.3d, 6+ -> capped at 7d.
 */
const BASE_DELAY_MINUTES = 30;
const BACKOFF_FACTOR = 4;
const MAX_DELAY_MINUTES = 7 * 24 * 60;

export function computeNextRetry(attempts: number, now: Date = new Date()): Date {
  const delayMinutes = Math.min(
    BASE_DELAY_MINUTES * Math.pow(BACKOFF_FACTOR, Math.max(attempts - 1, 0)),
    MAX_DELAY_MINUTES
  );
  return new Date(now.getTime() + delayMinutes * 60 * 1000);
}
