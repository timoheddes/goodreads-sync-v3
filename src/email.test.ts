import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestSubject, buildDigestBody, type DigestContent } from './email.js';

test('subject lists both counts when both sections are non-empty', () => {
  const content: DigestContent = {
    found: [{ title: 'A', author: 'X' }],
    stillSearching: [
      { title: 'B', author: 'Y' },
      { title: 'C', author: 'Z' },
    ],
  };
  assert.equal(buildDigestSubject(content), 'Goodreads Sync: 1 found, 2 still searching');
});

test('subject omits a section that has nothing in it', () => {
  const content: DigestContent = { found: [{ title: 'A', author: 'X' }], stillSearching: [] };
  assert.equal(buildDigestSubject(content), 'Goodreads Sync: 1 found');
});

test('body lists titles with author, falling back when author is missing', () => {
  const content: DigestContent = {
    found: [{ title: 'Dune', author: 'Frank Herbert' }],
    stillSearching: [{ title: 'Mystery Book', author: null }],
  };
  const body = buildDigestBody('Alice', content);
  assert.match(body, /Hi Alice/);
  assert.match(body, /Dune - Frank Herbert/);
  assert.match(body, /Mystery Book/);
});

test('body truncates long lists and notes how many more there are', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `Book ${i}`, author: null }));
  const content: DigestContent = { found: many, stillSearching: [] };
  const body = buildDigestBody('Bob', content);
  assert.match(body, /\.\.\.and 5 more/);
});
