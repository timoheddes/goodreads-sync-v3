import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findExistingCopyForBook } from './bookCopy.js';

function makeUser(id: number, name: string, downloadPath: string) {
  return {
    id,
    name,
    goodreadsId: `gr-${id}`,
    downloadPath,
    email: null,
    createdAt: new Date(),
    lastDigestSentAt: null,
  } as any;
}

function makeBook(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    goodreadsBookId: 'gid-1',
    isbn: null,
    title: 'Red Dragon',
    author: 'Thomas Harris',
    status: 'pending',
    source: 'goodreads',
    attempts: 0,
    nextRetryAt: null,
    lastError: null,
    filePath: null,
    addedAt: new Date(),
    updatedAt: new Date(),
    downloadedAt: null,
    ...overrides,
  } as any;
}

test('findExistingCopyForBook finds the exact known filename when the book is already downloaded', () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'bookcopy-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'bookcopy-b-'));
  fs.writeFileSync(path.join(dirA, 'Thomas Harris - Red Dragon.epub'), 'fake epub');

  const userA = makeUser(1, 'Alice', dirA);
  const userB = makeUser(2, 'Bob', dirB);
  const book = makeBook({ filePath: 'Thomas Harris - Red Dragon.epub', status: 'downloaded' });

  const result = findExistingCopyForBook(book, [userA, userB]);
  assert.ok(result);
  assert.equal(result!.user.id, userA.id);
  assert.equal(result!.filename, 'Thomas Harris - Red Dragon.epub');
});

test('findExistingCopyForBook falls back to the deterministic "Author - Title" filename when the book has no filePath yet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookcopy-c-'));
  fs.writeFileSync(path.join(dir, 'Thomas Harris - Red Dragon.pdf'), 'fake pdf');

  const user = makeUser(1, 'Alice', dir);
  const book = makeBook({ filePath: null, status: 'pending' });

  const result = findExistingCopyForBook(book, [user]);
  assert.ok(result);
  assert.equal(result!.filename, 'Thomas Harris - Red Dragon.pdf');
});

test('findExistingCopyForBook returns null when no matching file exists anywhere', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookcopy-d-'));
  const user = makeUser(1, 'Alice', dir);
  const book = makeBook();

  assert.equal(findExistingCopyForBook(book, [user]), null);
});

test('findExistingCopyForBook does not match an unrelated file when the book already has a known filePath', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookcopy-e-'));
  fs.writeFileSync(path.join(dir, 'Some Other - Book.epub'), 'unrelated');

  const user = makeUser(1, 'Alice', dir);
  const book = makeBook({ filePath: 'Thomas Harris - Red Dragon.epub', status: 'downloaded' });

  assert.equal(findExistingCopyForBook(book, [user]), null);
});
