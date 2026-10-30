import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TONE_BIBLE } from '@orc/content';

const DOC = join(import.meta.dirname, '..', '..', '..', '.scratch', 'orc-nonsense', 'tone-bible.md');

test('the narration prompt carries the tone bible exactly as written (story 118)', () => {
  const doc = readFileSync(DOC, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(TONE_BIBLE, doc, 'the tone bible changed: run `npm run tone-bible:sync`');
});
