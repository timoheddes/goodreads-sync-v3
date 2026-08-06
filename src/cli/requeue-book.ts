/**
 * Recovery tool: resets book(s) back to `pending` (clearing filePath,
 * downloadedAt, attempts, and any retry backoff) so the queue picks them
 * back up on the next cycle.
 *
 * Usage:
 *   node dist/cli/requeue-book.js --all-downloaded   # reset every currently-downloaded book
 *   node dist/cli/requeue-book.js <bookId> [<bookId> ...]
 */
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { books } from '../db/schema.js';

const args = process.argv.slice(2);

function requeue(ids: number[]) {
  if (ids.length === 0) {
    console.log('Nothing to requeue.');
    return;
  }
  db.update(books)
    .set({
      status: 'pending',
      filePath: null,
      downloadedAt: null,
      nextRetryAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(inArray(books.id, ids))
    .run();
  console.log(`Requeued ${ids.length} book(s): ${ids.join(', ')}`);
}

if (args[0] === '--all-downloaded') {
  const rows = db.select({ id: books.id }).from(books).where(eq(books.status, 'downloaded')).all();
  requeue(rows.map((r) => r.id));
} else if (args.length > 0) {
  const ids = args.map((a) => parseInt(a, 10)).filter((n) => !Number.isNaN(n));
  requeue(ids);
} else {
  console.error('Usage: requeue-book --all-downloaded | requeue-book <bookId> [<bookId> ...]');
  process.exit(1);
}
