import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, wordOverlap, isGoodMatch, sanitizeTitleForSearch, buildSearchQueries } from './match.js';

test('normalizeText strips series info, subtitle noise, and punctuation', () => {
  assert.equal(normalizeText('Consider Phlebas (Culture, #1)'), 'consider phlebas');
  assert.equal(normalizeText('Some Book: A Novel'), 'some book');
  assert.equal(normalizeText("Foo's Bar!"), 'foos bar');
  assert.equal(normalizeText(null), '');
});

test('wordOverlap is 1 for identical titles and 0 for disjoint ones', () => {
  assert.equal(wordOverlap('Consider Phlebas', 'Consider Phlebas'), 1);
  assert.equal(wordOverlap('Consider Phlebas', 'Something Else Entirely'), 0);
});

test('wordOverlap tolerates a subtitle appended to the result title', () => {
  const score = wordOverlap('Consider Phlebas', 'Consider Phlebas: A Culture Novel');
  assert.ok(score >= 0.99, `expected ~1, got ${score}`);
});

test('isGoodMatch accepts a matching title + author', () => {
  const result = isGoodMatch('Consider Phlebas', 'Iain M. Banks', 'Consider Phlebas', 'Iain Banks');
  assert.equal(result.isMatch, true);
  assert.equal(result.authorHit, true);
});

test('isGoodMatch rejects a wrong title even with the right author', () => {
  const result = isGoodMatch('Consider Phlebas', 'Iain M. Banks', 'Use of Weapons', 'Iain Banks');
  assert.equal(result.isMatch, false);
});

test('isGoodMatch rejects a right title with a clearly wrong author', () => {
  const result = isGoodMatch('Consider Phlebas', 'Iain M. Banks', 'Consider Phlebas', 'Someone Else');
  assert.equal(result.isMatch, false);
  assert.equal(result.authorHit, false);
});

test('isGoodMatch accepts on title alone when no expected author is known', () => {
  const result = isGoodMatch('Consider Phlebas', null, 'Consider Phlebas', 'Whoever');
  assert.equal(result.isMatch, true);
  assert.equal(result.authorChecked, false);
});

test('sanitizeTitleForSearch strips parenthetical series annotations', () => {
  assert.equal(sanitizeTitleForSearch('De ontsnapping (John Puller #3)'), 'De ontsnapping');
  assert.equal(sanitizeTitleForSearch('Consider Phlebas (Culture, #1)'), 'Consider Phlebas');
});

test('sanitizeTitleForSearch strips bracketed asides', () => {
  assert.equal(sanitizeTitleForSearch('Some Book [Book 2]'), 'Some Book');
});

test('sanitizeTitleForSearch strips trailing series markers with no brackets', () => {
  assert.equal(sanitizeTitleForSearch('Some Book, Book 3'), 'Some Book');
  assert.equal(sanitizeTitleForSearch('Some Book - Vol. 2'), 'Some Book');
  assert.equal(sanitizeTitleForSearch('Some Book #4'), 'Some Book');
});

test('sanitizeTitleForSearch leaves a plain title untouched', () => {
  assert.equal(sanitizeTitleForSearch('Consider Phlebas'), 'Consider Phlebas');
});

test('buildSearchQueries returns title+author then title-only as a fallback', () => {
  const queries = buildSearchQueries('De ontsnapping (John Puller #3)', 'David Baldacci');
  assert.deepEqual(queries, ['De ontsnapping David Baldacci', 'De ontsnapping']);
});

test('buildSearchQueries de-dupes when there is no author to add', () => {
  const queries = buildSearchQueries('De ontsnapping (John Puller #3)', null);
  assert.deepEqual(queries, ['De ontsnapping']);
});

test('buildSearchQueries falls back to the raw title if sanitizing empties it', () => {
  const queries = buildSearchQueries('(2001)', 'Arthur C. Clarke');
  assert.deepEqual(queries, ['(2001) Arthur C. Clarke', '(2001)']);
});

test('buildSearchQueries collapses a double space inside the author name', () => {
  // Real case: Goodreads' RSS feed sent "Thomas  Harris" (double space)
  // for "Red Dragon (Hannibal Lecter, #1)". Uncollapsed, that produced a
  // literal "%20%20" in the Anna's Archive search URL, and every attempt
  // came back with "Results container not found" rather than a normal
  // empty/no-match result -- the book is on Anna's Archive, findable with
  // a manual search using a single space.
  const queries = buildSearchQueries('Red Dragon (Hannibal Lecter, #1)', 'Thomas  Harris');
  assert.deepEqual(queries, ['Red Dragon Thomas Harris', 'Red Dragon']);
});
