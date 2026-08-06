import { and, eq, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { db } from './index.js';
import { books, shelfState, userBooks, users } from './schema.js';

// ---- users ----

export function listUsers() {
  return db.select().from(users).all();
}

// ---- shelf_state (feed-hash short-circuit for RSS sync) ----

export function getShelfState(userId: number) {
  return db.select().from(shelfState).where(eq(shelfState.userId, userId)).get();
}

export function upsertShelfState(
  userId: number,
  data: { feedHash: string; changed: boolean; now?: Date }
) {
  const now = data.now ?? new Date();
  const existing = getShelfState(userId);

  if (!existing) {
    db.insert(shelfState)
      .values({
        userId,
        feedHash: data.feedHash,
        lastCheckedAt: now,
        lastChangedAt: data.changed ? now : null,
      })
      .run();
    return;
  }

  db.update(shelfState)
    .set({
      feedHash: data.feedHash,
      lastCheckedAt: now,
      ...(data.changed ? { lastChangedAt: now } : {}),
    })
    .where(eq(shelfState.userId, userId))
    .run();
}

// ---- books ----

export function getBookByGoodreadsId(goodreadsBookId: string) {
  return db.select().from(books).where(eq(books.goodreadsBookId, goodreadsBookId)).get();
}

/**
 * Insert a book discovered via a user's Goodreads shelf, or update the
 * cached title/author/isbn if it already exists. Returns the row.
 */
export function upsertGoodreadsBook(data: {
  goodreadsBookId: string;
  isbn: string | null;
  title: string | null;
  author: string | null;
}) {
  const existing = getBookByGoodreadsId(data.goodreadsBookId);

  if (existing) {
    db.update(books)
      .set({
        isbn: data.isbn ?? existing.isbn,
        title: data.title ?? existing.title,
        author: data.author ?? existing.author,
        updatedAt: new Date(),
      })
      .where(eq(books.id, existing.id))
      .run();
    return { book: getBookByGoodreadsId(data.goodreadsBookId)!, isNew: false };
  }

  const inserted = db
    .insert(books)
    .values({
      goodreadsBookId: data.goodreadsBookId,
      isbn: data.isbn,
      title: data.title,
      author: data.author,
      source: 'goodreads',
    })
    .returning()
    .get();
  return { book: inserted, isNew: true };
}

export function linkUserBook(userId: number, bookId: number) {
  db.insert(userBooks)
    .values({ userId, bookId })
    .onConflictDoNothing()
    .run();
}

/**
 * Next book eligible for a search/download attempt: not yet downloaded, and
 * either never attempted (nextRetryAt is null) or its backoff window has
 * elapsed. Excludes any ids already skipped this cycle (e.g. because every
 * linked user is at their daily download cap). No attempt cap -- books are
 * never marked permanently failed, see src/backoff.ts.
 */
export function getNextEligibleBook(excludeIds: number[] = [], now: Date = new Date()) {
  // Prefer never-attempted books (attempts = 0) over retries, then oldest first.
  return db
    .select()
    .from(books)
    .where(
      and(
        or(eq(books.status, 'pending'), eq(books.status, 'not_found')),
        or(isNull(books.nextRetryAt), lte(books.nextRetryAt, now)),
        excludeIds.length > 0 ? notInArray(books.id, excludeIds) : sql`1=1`
      )
    )
    .orderBy(books.attempts, books.addedAt)
    .limit(1)
    .get();
}

export function getUsersForBook(bookId: number) {
  return db
    .select({
      id: users.id,
      name: users.name,
      downloadPath: users.downloadPath,
      email: users.email,
    })
    .from(users)
    .innerJoin(userBooks, eq(userBooks.userId, users.id))
    .where(eq(userBooks.bookId, bookId))
    .all();
}

export function incrementAttempt(bookId: number, nextRetryAt: Date, lastError: string) {
  db.update(books)
    .set({
      attempts: sql`${books.attempts} + 1`,
      status: 'not_found',
      nextRetryAt,
      lastError,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId))
    .run();
}

export function markDownloaded(bookId: number, filePath: string) {
  const now = new Date();
  db.update(books)
    .set({
      status: 'downloaded',
      filePath,
      nextRetryAt: null,
      lastError: null,
      downloadedAt: now,
      updatedAt: now,
    })
    .where(eq(books.id, bookId))
    .run();
}

export function countDownloadsToday(): number {
  const row = db
    .select({ cnt: sql<number>`count(*)` })
    .from(books)
    .where(
      and(
        eq(books.status, 'downloaded'),
        sql`date(${books.downloadedAt}, 'unixepoch') = date('now')`
      )
    )
    .get();
  return row?.cnt ?? 0;
}

export function countUserDownloadsToday(userId: number): number {
  const row = db
    .select({ cnt: sql<number>`count(*)` })
    .from(books)
    .innerJoin(userBooks, eq(userBooks.bookId, books.id))
    .where(
      and(
        eq(books.status, 'downloaded'),
        eq(userBooks.userId, userId),
        sql`date(${books.downloadedAt}, 'unixepoch') = date('now')`
      )
    )
    .get();
  return row?.cnt ?? 0;
}

// ---- folder scan (Phase 2) ----

/**
 * Filenames already known for this user -- i.e. books linked to them whose
 * file_path is set. Used to skip files the app already put there itself
 * (or already reconciled on a previous scan) without re-processing them
 * every day.
 */
export function getTrackedFilenamesForUser(userId: number): Set<string> {
  const rows = db
    .select({ filePath: books.filePath })
    .from(books)
    .innerJoin(userBooks, eq(userBooks.bookId, books.id))
    .where(and(eq(userBooks.userId, userId), sql`${books.filePath} is not null`))
    .all();
  return new Set(rows.map((r) => r.filePath).filter((f): f is string => !!f));
}

/** A user's books that are still waiting to be found -- candidates an unrecognized file might match. */
export function getPendingBooksForUser(userId: number) {
  return db
    .select({ id: books.id, title: books.title, author: books.author })
    .from(books)
    .innerJoin(userBooks, eq(userBooks.bookId, books.id))
    .where(
      and(eq(userBooks.userId, userId), or(eq(books.status, 'pending'), eq(books.status, 'not_found')))
    )
    .all();
}

/** An untracked file matched an existing pending/not_found book: mark it fulfilled manually. */
export function markManualMatch(bookId: number, filename: string, foundAt: Date) {
  db.update(books)
    .set({
      status: 'downloaded',
      source: 'manual',
      filePath: filename,
      downloadedAt: foundAt,
      nextRetryAt: null,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId))
    .run();
}

/** An untracked file didn't match anything on the shelf: record it as a new manual book. */
export function insertManualBook(data: {
  title: string | null;
  author: string | null;
  filePath: string;
  foundAt: Date;
}) {
  return db
    .insert(books)
    .values({
      title: data.title,
      author: data.author,
      source: 'manual',
      status: 'downloaded',
      filePath: data.filePath,
      downloadedAt: data.foundAt,
    })
    .returning()
    .get();
}

// ---- daily digest (Phase 3) ----

/**
 * Books downloaded for this user that haven't been included in a digest
 * yet (userBooks.notifiedAt is null). Once reported, notifiedAt gets set
 * so they never appear in a digest again -- see markUserBooksNotified.
 */
export function getUnnotifiedDownloadedBooksForUser(userId: number) {
  return db
    .select({ id: books.id, title: books.title, author: books.author })
    .from(books)
    .innerJoin(userBooks, eq(userBooks.bookId, books.id))
    .where(and(eq(userBooks.userId, userId), eq(books.status, 'downloaded'), isNull(userBooks.notifiedAt)))
    .all();
}

/**
 * Books still being searched for (status='not_found', i.e. at least one
 * failed attempt so far). Unlike the "found" list, this isn't gated by
 * notifiedAt -- it's reported every digest for as long as the book stays
 * unresolved, since "still looking" is an ongoing status rather than a
 * one-off event.
 */
export function getStillSearchingBooksForUser(userId: number) {
  return db
    .select({ id: books.id, title: books.title, author: books.author })
    .from(books)
    .innerJoin(userBooks, eq(userBooks.bookId, books.id))
    .where(and(eq(userBooks.userId, userId), eq(books.status, 'not_found')))
    .all();
}

export function markUserBooksNotified(userId: number, bookIds: number[], now: Date = new Date()): void {
  if (bookIds.length === 0) return;
  db.update(userBooks)
    .set({ notifiedAt: now })
    .where(and(eq(userBooks.userId, userId), inArray(userBooks.bookId, bookIds)))
    .run();
}

export function markDigestSent(userId: number, now: Date = new Date()): void {
  db.update(users).set({ lastDigestSentAt: now }).where(eq(users.id, userId)).run();
}

/** Total books currently in this user's library (any source), for the "you now have N books" line. */
export function countDownloadedBooksForUser(userId: number): number {
  const row = db
    .select({ cnt: sql<number>`count(*)` })
    .from(books)
    .innerJoin(userBooks, eq(userBooks.bookId, books.id))
    .where(and(eq(userBooks.userId, userId), eq(books.status, 'downloaded')))
    .get();
  return row?.cnt ?? 0;
}

export function countPending(): number {
  const row = db
    .select({ cnt: sql<number>`count(*)` })
    .from(books)
    .where(
      and(
        or(eq(books.status, 'pending'), eq(books.status, 'not_found')),
        or(isNull(books.nextRetryAt), lte(books.nextRetryAt, new Date()))
      )
    )
    .get();
  return row?.cnt ?? 0;
}
