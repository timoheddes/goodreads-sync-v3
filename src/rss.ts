import crypto from 'node:crypto';
import axios from 'axios';
import Parser from 'rss-parser';
import { logger } from './logger.js';
import { getShelfState, upsertShelfState, upsertGoodreadsBook, linkUserBook } from './db/repo.js';
import type { users } from './db/schema.js';

type UserRow = typeof users.$inferSelect;

interface GoodreadsFeedItem {
  book_id?: string;
  isbn?: string;
  author_name?: string;
  title?: string;
  creator?: string;
  content?: string;
}

const rssParser = new Parser<{}, GoodreadsFeedItem>({
  customFields: {
    item: [
      ['book_id', 'book_id'],
      ['isbn', 'isbn'],
      ['author_name', 'author_name'],
    ],
  },
});

function hashFeed(rawXml: string): string {
  return crypto.createHash('sha256').update(rawXml).digest('hex');
}

/**
 * Checks one user's Goodreads "to-read" shelf and queues any new books.
 *
 * The expensive part isn't the RSS fetch itself, it's everything downstream
 * (Anna's Archive searches). So the real optimization here is being able to
 * run this check every ~10 minutes cheaply: fetch the raw feed, hash it, and
 * compare against the hash from the last check. If it's unchanged, skip
 * parsing and diffing entirely -- this is what lets the sync interval drop
 * from v2's hourly default without meaningfully increasing load on
 * Goodreads or the DB.
 */
export async function syncUserShelf(user: UserRow): Promise<{ newBooks: number; changed: boolean }> {
  const feedUrl = `https://www.goodreads.com/review/list_rss/${user.goodreadsId}?shelf=to-read`;

  let rawXml: string;
  try {
    const response = await axios.get(feedUrl, { responseType: 'text', timeout: 30000 });
    rawXml = response.data;
  } catch (err) {
    logger.error({ err, user: user.name }, '[RSS] Failed to fetch shelf feed');
    return { newBooks: 0, changed: false };
  }

  const hash = hashFeed(rawXml);
  const previous = getShelfState(user.id);

  if (previous?.feedHash === hash) {
    logger.debug({ user: user.name }, '[RSS] Shelf unchanged since last check, skipping parse');
    upsertShelfState(user.id, { feedHash: hash, changed: false });
    return { newBooks: 0, changed: false };
  }

  logger.info({ user: user.name }, '[RSS] Shelf changed (or first check) -- parsing feed');

  let feed: Parser.Output<GoodreadsFeedItem>;
  try {
    feed = await rssParser.parseString(rawXml);
  } catch (err) {
    logger.error({ err, user: user.name }, '[RSS] Failed to parse shelf feed');
    return { newBooks: 0, changed: false };
  }

  let newBooks = 0;
  let existingBooks = 0;
  let skipped = 0;

  for (const item of feed.items) {
    const goodreadsBookId = item.book_id || null;
    if (!goodreadsBookId) {
      skipped++;
      continue;
    }

    let isbn: string | null = item.isbn?.trim() || null;
    if (!isbn && item.content) {
      const isbn13Match = item.content.match(/isbn13:\s*(\d{13})/);
      if (isbn13Match) isbn = isbn13Match[1];
    }

    const title = item.title || null;
    const author = item.author_name || item.creator || null;

    const { book, isNew } = upsertGoodreadsBook({ goodreadsBookId, isbn, title, author });
    linkUserBook(user.id, book.id);

    if (isNew) {
      newBooks++;
      logger.info(
        { user: user.name, title, author, goodreadsBookId },
        '[RSS] New book queued'
      );
    } else {
      existingBooks++;
    }
  }

  upsertShelfState(user.id, { feedHash: hash, changed: true });

  logger.info(
    { user: user.name, newBooks, existingBooks, skipped },
    '[RSS] Shelf sync complete'
  );

  return { newBooks, changed: true };
}

export async function syncAllShelves(users: UserRow[]): Promise<number> {
  let totalNew = 0;
  for (const user of users) {
    const { newBooks } = await syncUserShelf(user);
    totalNew += newBooks;
  }
  return totalNew;
}
