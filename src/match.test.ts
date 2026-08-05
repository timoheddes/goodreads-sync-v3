import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, wordOverlap, isGoodMatch } from './match.js';

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
