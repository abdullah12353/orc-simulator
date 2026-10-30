// #39: a back issue read straight from the database shows its Accusation too, under the same rule the
// Herald printed it by: only while the accused Player is still in the world and his name render exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accusationsFrom } from '../src/accusation.ts';

const fact = { no: 41, story_no: 40, line: 'Snaga: "It was Moo-hammed!"', payload: { kind: 'accusation', accused: 'p1', accuser: 'snaga' } };
const render = { player_id: 'p1', accuser_id: 'snaga', clip_key: 'names/p1/snaga.wav' };

test("a stored Accusation comes back as the pull quote over its story's Blame", () => {
  const found = accusationsFrom([fact], [render], [{ id: 'p1', removed_at: null }]);
  assert.deepEqual(found.get(41), { factNo: 41, storyNo: 40, accuser: 'snaga', line: fact.line, clipKey: 'names/p1/snaga.wav' });
});

test("no render for that accuser, or the accused has left: no pull quote", () => {
  assert.equal(accusationsFrom([fact], [{ ...render, accuser_id: 'gob' }], [{ id: 'p1', removed_at: null }]).size, 0);
  assert.equal(accusationsFrom([fact], [render], [{ id: 'p1', removed_at: '2026-10-01T00:00:00Z' }]).size, 0);
  assert.equal(accusationsFrom([fact], [render], []).size, 0);
});
