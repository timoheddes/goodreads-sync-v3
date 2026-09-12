import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseWhitespace } from './utils.js';

test('collapseWhitespace collapses runs of whitespace to a single space and trims', () => {
  assert.equal(collapseWhitespace('Thomas  Harris'), 'Thomas Harris');
  assert.equal(collapseWhitespace('  Red   Dragon  '), 'Red Dragon');
  assert.equal(collapseWhitespace('Consider Phlebas'), 'Consider Phlebas');
  assert.equal(collapseWhitespace(''), '');
});
