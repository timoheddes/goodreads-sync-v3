import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRetry } from './backoff.js';

const now = new Date('2026-01-01T00:00:00Z');
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60000;

test('first failed attempt retries in 30 minutes', () => {
  assert.equal(minutesBetween(now, computeNextRetry(1, now)), 30);
});

test('backoff grows exponentially with each attempt', () => {
  assert.equal(minutesBetween(now, computeNextRetry(2, now)), 120);
  assert.equal(minutesBetween(now, computeNextRetry(3, now)), 480);
});

test('backoff is capped at 7 days no matter how many attempts', () => {
  const sevenDaysInMinutes = 7 * 24 * 60;
  assert.equal(minutesBetween(now, computeNextRetry(10, now)), sevenDaysInMinutes);
  assert.equal(minutesBetween(now, computeNextRetry(100, now)), sevenDaysInMinutes);
});

test('there is no cap on attempts itself -- always returns a future date', () => {
  const future = computeNextRetry(9999, now);
  assert.ok(future.getTime() > now.getTime());
});
