import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSearchParams } from './search.js';

test('buildSearchParams does not filter by language', () => {
  // Regression guard: search.ts used to hardcode lang=en&lang=fr&lang=nl,
  // which was confirmed to hide a match Anna's Archive's own UI tagged as
  // "English [en]" ("Japanese Gothic" by Kylie Lee Baker). Whatever the
  // cause on Anna's Archive's end, isGoodMatch never checked language
  // anyway, so the filter had no correctness upside and a demonstrated
  // false-negative cost -- it should not come back.
  assert.doesNotMatch(buildSearchParams(), /lang=/);
});

test('buildSearchParams includes every configured extension', () => {
  const params = buildSearchParams();
  for (const ext of ['epub', 'pdf', 'mobi', 'azw3']) {
    assert.match(params, new RegExp(`ext=${ext}(&|$)`));
  }
});
