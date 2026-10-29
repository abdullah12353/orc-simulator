import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failureCategory, median } from '../failures.mjs';

test('failures fall into none / refusal / format / rate_limited / transport', () => {
  assert.equal(failureCategory(null), 'none');
  assert.equal(failureCategory('refusal'), 'refusal');
  for (const f of ['invalid_json', 'schema', 'line_count', 'loser_not_last', 'herald_swore', 'json_mode_unmet', 'empty']) assert.equal(failureCategory(f), 'format', f);
  assert.equal(failureCategory('http_429'), 'rate_limited');
  for (const f of ['timeout', 'network', 'http_500', 'http_401']) assert.equal(failureCategory(f), 'transport', f);
});

test('median of odd, even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});
