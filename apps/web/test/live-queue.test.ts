// What plays live (#31, #33): Clashes as their card, Returns and step-ins as their Introduction, other
// notable heads as a notice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveItems, type LiveFact } from '../src/live-queue.ts';

const fact = (no: number, kind: string, patch: Partial<LiveFact> = {}): LiveFact => ({
  no,
  story_no: no,
  tick_seq: 300,
  kind,
  tier: 'templated',
  line: `${kind} ${no}`,
  ...patch,
});

test('Return and stepped_in heads play as Introductions, in story order with the rest', () => {
  assert.deepEqual(
    liveItems([
      fact(12, 'stepped_in'),
      fact(10, 'return'),
      fact(11, 'humiliation', { story_no: 10, tier: 'silent' }),
      fact(13, 'clash'),
      fact(14, 'incident'),
    ]),
    [
      { kind: 'introduction', no: 10 },
      { kind: 'introduction', no: 12 },
      { kind: 'clash', no: 13 },
      { kind: 'notice', no: 14, line: 'incident 14' },
    ],
  );
});

test('a crowned Captain plays his Introduction (#34); the fall itself is part of the story that caused it', () => {
  assert.deepEqual(
    liveItems([
      fact(20, 'clash'),
      fact(21, 'warlord_fell', { story_no: 20, tier: 'silent' }),
      fact(22, 'crowned'),
    ]),
    [
      { kind: 'clash', no: 20 },
      { kind: 'introduction', no: 22 },
    ],
  );
});
