import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAST } from '../fixtures/cast.mjs';
import { FACTS } from '../fixtures/facts.mjs';
import { HERALDS } from '../fixtures/heralds.mjs';

test('about 30 Facts, every one well-formed against the cast', () => {
  assert.ok(FACTS.length >= 28 && FACTS.length <= 32);
  assert.equal(new Set(FACTS.map((f) => f.id)).size, FACTS.length);
  for (const f of FACTS) {
    for (const id of [f.a, f.b, f.saviour].filter(Boolean)) assert.ok(CAST[id], `${f.id}: unknown ${id}`);
    assert.ok([f.a, f.b].includes(f.winner), f.id);
    assert.notEqual(f.loser, f.winner, f.id);
    assert.ok(!f.saviour || ![f.a, f.b].includes(f.saviour), f.id);
  }
});

test('the Facts cover the ticket\'s required situations', () => {
  const tags = new Set(FACTS.flatMap((f) => f.tags));
  for (const t of ['rumour-wrong-orc', 'rumour-garbled', 'dare-botched', 'saviour', 'trophy', 'player-line', 'c-word', 'your-mum', 'innuendo', 'muffled']) {
    assert.ok(tags.has(t), `no Fact tagged ${t}`);
  }
  assert.ok(FACTS.some((f) => f.blame), 'need some Facts carrying Blame to prove it is stripped');
});

test('2-3 Herald inputs of templated lines', () => {
  assert.ok(HERALDS.length >= 2 && HERALDS.length <= 3);
  for (const h of HERALDS) assert.ok(h.events.length >= 2);
});
