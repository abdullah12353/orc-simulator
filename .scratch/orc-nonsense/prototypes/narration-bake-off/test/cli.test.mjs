import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cli.mjs';

test('no flags: a full real run', () => {
  assert.deepEqual(parseArgs([]), { mock: false, limit: null });
});

test('--mock and a valid --limit', () => {
  assert.deepEqual(parseArgs(['--mock', '--limit', '3']), { mock: true, limit: 3 });
});

test('a bad or missing --limit is rejected', () => {
  for (const argv of [['--limit'], ['--limit', 'abc'], ['--limit', '0'], ['--limit', '-2'], ['--limit', '2.5'], ['--limit', '--mock']]) {
    assert.throws(() => parseArgs(argv), /--limit/, argv.join(' '));
  }
});

test('an unknown flag is rejected', () => {
  assert.throws(() => parseArgs(['--mokc']), /unknown/i);
});
