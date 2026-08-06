import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestContent } from './digestContent.js';

test('returns null when there is nothing to report', () => {
  assert.equal(buildDigestContent([], []), null);
});

test('returns content when there are newly found books', () => {
  const content = buildDigestContent([{ title: 'Dune', author: 'Frank Herbert' }], []);
  assert.ok(content);
  assert.equal(content!.found.length, 1);
  assert.equal(content!.stillSearching.length, 0);
});

test('returns content when there are still-searching books, even with nothing found', () => {
  const content = buildDigestContent([], [{ title: 'Obscure Book', author: null }]);
  assert.ok(content);
  assert.equal(content!.found.length, 0);
  assert.equal(content!.stillSearching.length, 1);
});

test('includes both lists when both are non-empty', () => {
  const content = buildDigestContent(
    [{ title: 'Found Book', author: 'A' }],
    [{ title: 'Missing Book', author: 'B' }]
  );
  assert.ok(content);
  assert.equal(content!.found[0].title, 'Found Book');
  assert.equal(content!.stillSearching[0].title, 'Missing Book');
});
