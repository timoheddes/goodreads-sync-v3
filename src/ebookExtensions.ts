/**
 * The set of file extensions this app recognizes as an ebook, shared
 * between folderScan.ts (matching an unrecognized file in a user's folder
 * against the DB) and bookCopy.ts (checking whether a book's expected
 * filename already exists in another user's folder). Kept in its own tiny
 * module -- with no other imports -- specifically so pulling it in doesn't
 * drag in the DB layer (src/db/*) transitively: bookCopy.ts's
 * findExistingCopyForBook is meant to be a plain, DB-free function so it
 * stays unit-testable the same way match.ts is.
 */
export const RECOGNIZED_EXTENSIONS = new Set(['.epub', '.pdf', '.mobi', '.azw3', '.cbz', '.cbr']);
