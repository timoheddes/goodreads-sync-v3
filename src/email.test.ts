import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestSubject, buildDigestText, buildDigestHtml, type DigestContent } from './email.js';

test('subject reports new-book count when books were found', () => {
  const content: DigestContent = {
    found: [{ title: 'A', author: 'X' }],
    stillSearching: [{ title: 'B', author: 'Y' }],
    totalBooks: 10,
  };
  assert.equal(buildDigestSubject(content), '1 new book added to your library');
});

test('subject falls back to still-searching count when nothing was found', () => {
  const content: DigestContent = {
    found: [],
    stillSearching: [
      { title: 'B', author: 'Y' },
      { title: 'C', author: 'Z' },
    ],
    totalBooks: 4,
  };
  assert.equal(buildDigestSubject(content), 'Still searching for 2 books');
});

test('text body follows the intro/still-searching/found template and signs off correctly', () => {
  const content: DigestContent = {
    found: [{ title: 'Dune', author: 'Frank Herbert' }],
    stillSearching: [{ title: 'Mystery Book', author: null }],
    totalBooks: 9,
  };
  const body = buildDigestText('Alice', content);
  assert.match(body, /^Hi Alice!/);
  assert.match(body, /We've found 1 today.*You now have 9 books available to you!/);
  assert.match(body, /unable to find the following books[\s\S]*Mystery Book[\s\S]*We'll keep trying!/);
  assert.match(body, /Overview of new books:[\s\S]*Dune by Frank Herbert/);
  assert.match(body, /Till next time!\n\nTimo - GoodReads Sync$/);
});

test('text body handles zero new books gracefully', () => {
  const content: DigestContent = { found: [], stillSearching: [{ title: 'X', author: null }], totalBooks: 5 };
  const body = buildDigestText('Bob', content);
  assert.match(body, /didn't find any new books today.*you still have 5 books/);
  assert.doesNotMatch(body, /Overview of new books/);
});

test('html body bolds the counts and escapes titles', () => {
  const content: DigestContent = {
    found: [{ title: '<script>Dune</script>', author: 'Frank Herbert' }],
    stillSearching: [],
    totalBooks: 3,
  };
  const html = buildDigestHtml('Alice', content);
  assert.match(html, /<strong>1<\/strong>/);
  assert.match(html, /<strong>3<\/strong>/);
  assert.doesNotMatch(html, /<script>Dune<\/script>/);
  assert.match(html, /&lt;script&gt;Dune&lt;\/script&gt;/);
  assert.match(html, /Timo - GoodReads Sync/);
});

test('html body truncates long lists', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `Book ${i}`, author: null }));
  const content: DigestContent = { found: many, stillSearching: [], totalBooks: 30 };
  const html = buildDigestHtml('Bob', content);
  assert.match(html, /\.\.\.and 5 more/);
});
