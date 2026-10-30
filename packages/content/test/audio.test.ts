import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BARK_EMOTIONS, STINGERS, barkPath, content, stingerPath } from '@orc/content';

const PUBLIC = join(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'public');

test('the PWA ships a bark for every Captain and emotion, and every stinger (placeholders until #19)', () => {
  const missing = [
    ...content.cast.flatMap((c) => BARK_EMOTIONS.map((e) => barkPath(c.id, e))),
    ...STINGERS.map(stingerPath),
  ].filter((p) => !existsSync(join(PUBLIC, p)));
  assert.deepEqual(missing, [], 'run `npm run audio:placeholders -- --missing`');
});
