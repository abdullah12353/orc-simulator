import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blameLine, content, validateContent, type Content } from '@orc/content';

// §4.1: the earliest landing "began it", the latest "finished the job", anyone between is named in order.
// The Herald mocks the Meddle, never the Player (tone bible §2).

test('one Meddle: it all began with it', () => {
  assert.equal(blameLine(content, [{ name: 'Mo', verb: 'rumour' }]), 'It all began when Mo planted a Rumour.');
});

test('two Meddles: the first began it and the last finished the job', () => {
  assert.equal(
    blameLine(content, [
      { name: 'Haris', verb: 'rumour' },
      { name: 'Dazza', verb: 'dare' },
    ]),
    "It all began when Haris planted a Rumour, and Dazza's Dare finished the job.",
  );
});

test('anyone in between is named in order', () => {
  assert.equal(
    blameLine(content, [
      { name: 'Dazza', verb: 'rumour' },
      { name: 'Mo', verb: 'rumour' },
      { name: 'Kev', verb: 'dare' },
      { name: 'Baz', verb: 'rumour' },
    ]),
    "It all began when Dazza planted a Rumour, Mo's Rumour and Kev's Dare kept it going, and Baz's Rumour finished the job.",
  );
  assert.equal(
    blameLine(content, ['A', 'B', 'C', 'D', 'E'].map((name) => ({ name, verb: 'rumour' as const }))),
    "It all began when A planted a Rumour, B's Rumour, C's Rumour and D's Rumour kept it going, and E's Rumour finished the job.",
  );
});

test('no Blame, no line', () => {
  assert.equal(blameLine(content, []), null);
});

test('the Blame line bank needs every placeholder', () => {
  const broken: Content = structuredClone(content);
  broken.banks.blame.many = 'It all began when {first}, and {last} finished the job.';
  const errors = validateContent(broken);
  assert.ok(errors.some((e) => e.includes('banks.blame.many') && e.includes('{middle}')), errors.join('\n'));
});
