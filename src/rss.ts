import crypto from 'node:crypto';
import axios from 'axios';
import Parser from 'rss-parser';
import { logger } from './logger.js';
import {
  getShelfState,
  upsertShelfState,
  upsertGoodreadsBook,
  linkUserBook,
  getUsersForBook,
} from './db/repo.js';
import { findExistingCopyForBook, copyExistingFileToUser } from './bookCopy.js';
import { collapseWhitespace } from './utils.js';
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

    // Goodreads' RSS feed occasionally has irregular whitespace in these
    // fields (confirmed: an author_name of "Thomas  Harris", double space)
    // -- collapse it here so nothing downstream (the Anna's Archive search
    // query in particular) ever has to deal with it.
    const rawAuthor = item.author_name || item.creator || null;
    const title = item.title ? collapseWhitespace(item.title) : null;
    const author = rawAuthor ? collapseWhitespace(rawAuthor) : null;

    const { book, isNew } = upsertGoodreadsBook({ goodreadsBookId, isbn, title, author });

    if (book.status === 'downloaded') {
      // This user's shelf sync just linked them to a book someone else
      // already has. A `downloaded` book never gets revisited by the
      // queue (getNextEligibleBook only considers pending/not_found
      // rows), so this is the only chance to get this user a copy without
      // a manual intervention -- see findExistingCopyForBook's doc
      // comment.
      //
      // otherUsers must explicitly exclude `user` themselves. The old
      // assumption here -- that getUsersForBook(book.id) can't yet include
      // `user` because linkUserBook hasn't run this pass -- only holds the
      // very first time this book is linked. This branch runs on *every*
      // sync pass where the book is still on the feed and still marked
      // `downloaded`, not just the first, so on any later pass `user` is
      // already linked from before and getUsersForBook returns them too.
      // Left unfiltered, findExistingCopyForBook can match the user's own
      // existing file and copyExistingFileToUser would then copy it onto
      // itself -- confirmed on a real NAS to throw EACCES for one file
      // (differing ownership/permissions from a manual add) and, because
      // nothing here caught it, abort this whole shelf sync and skip the
      // download queue for the entire cycle (see Bugs fixed #14).
      // copyExistingFileToUser guards against this too, but filtering here
      // keeps the log from spamming a self-copy "success" for every
      // already-downloaded book on every unchanged-feed re-sync.
      const otherUsers = getUsersForBook(book.id).filter((u) => u.id !== user.id);
      const existing = findExistingCopyForBook(book, otherUsers);
      if (existing) {
        try {
          copyExistingFileToUser(existing, user);
        } catch (err) {
          // Isolate this one book's copy failure so it can't take down the
          // rest of this user's shelf sync (or, propagated further, the
          // whole cycle including the download queue -- see Bugs fixed
          // #14). The queue's own retry path will pick this book up again
          // if it's ever reset to pending; for now just log it clearly.
          logger.error(
            { err, user: user.name, title: book.title, author: book.author, bookId: book.id },
            '[RSS] Failed to copy existing file into newly-linked user\'s folder -- skipping, not aborting the sync'
          );
        }
      } else {
        logger.warn(
          { user: user.name, title: book.title, author: book.author, bookId: book.id },
          "[RSS] Book already marked downloaded but no copy found in any linked user's folder -- can't fulfil the new link automatically"
        );
      }
    }

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
