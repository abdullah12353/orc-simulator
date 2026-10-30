import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BARK_EMOTIONS,
  STINGERS,
  barkPath,
  content,
  epithetPath,
  introShoutPath,
  introSignaturePath,
  stingerPath,
} from '@orc/content';

const PUBLIC = join(import.meta.dirname, '..', '..', '..', 'apps', 'web', 'public');
const missing = (paths: string[]) => paths.filter((p) => !existsSync(join(PUBLIC, p)));

test('the PWA ships a bark for every Captain and emotion, and every stinger (placeholders until #19)', () => {
  assert.deepEqual(
    missing([...content.cast.flatMap((c) => BARK_EMOTIONS.map((e) => barkPath(c.id, e))), ...STINGERS.map(stingerPath)]),
    [],
    'run `npm run audio:placeholders -- --missing`',
  );
});

test('every Captain has his Introduction clips (his shout, under each alias too, and his signature line)', () => {
  assert.deepEqual(
    missing(
      content.cast.flatMap((c) => [
        introShoutPath(c.id),
        introShoutPath(c.id, 0),
        introShoutPath(c.id, 1),
        introSignaturePath(c.id),
      ]),
    ),
    [],
    'run `npm run audio:placeholders -- --missing`',
  );
});

test('the announcer has a clip for every Epithet in the bank', () => {
  assert.deepEqual(missing(Object.keys(content.banks.epithets).map(epithetPath)), [], 'run `npm run audio:placeholders -- --missing`');
});
