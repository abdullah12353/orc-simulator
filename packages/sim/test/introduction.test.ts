// #33 The Captain Introduction (gdd §4.4, #10): about 7 s. Announcer stinger → portrait slam → the
// Captain shouts his own name, badly → the announcer adds his Epithet → one signature line in his voice.
// All audio is prerecorded, keyed by slug. A mouth bandage muffles him, so his lines are subtitled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content, KRUG } from '@orc/content';
import { introductionScript, shoutName, simulate, type Fact, type Introduction, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld } from './support.ts';

const krug = (patch: Partial<Introduction> = {}): Introduction => ({
  captainId: 'krug',
  aliasIdx: null,
  epithet: null,
  legendary: false,
  ...patch,
});
const kinds = (s: ReturnType<typeof introductionScript>) => s.beats.map((b) => b.kind);

test('the beats run stinger, slam, his shout, the Epithet, his signature line, in about 7 s', () => {
  const s = introductionScript(content, krug({ epithet: 'the-damp' }));
  assert.deepEqual(kinds(s), ['stinger', 'slam', 'shout', 'epithet', 'signature']);
  const ms = s.beats.reduce((t, b) => t + b.ms, 0);
  assert.ok(ms >= 6000 && ms <= 8000, `${ms} ms`);
});

test('he shouts his own name badly, the announcer says the Epithet, and he says his catchphrase', () => {
  const s = introductionScript(content, krug({ epithet: 'the-damp' }));
  const [, , shout, epithet, signature] = s.beats;
  assert.equal(s.name, 'Krúg');
  assert.deepEqual(
    { speaker: shout!.speaker, text: shout!.text, clip: shout!.clip },
    { speaker: 'krug', text: 'KRÚÚÚG!', clip: 'audio/intros/krug/shout.wav' },
  );
  assert.deepEqual(
    { speaker: epithet!.speaker, text: epithet!.text, clip: epithet!.clip },
    { speaker: 'announcer', text: '…THE DAMP.', clip: 'audio/epithets/the-damp.wav' },
  );
  assert.deepEqual(
    { speaker: signature!.speaker, text: signature!.text, clip: signature!.clip },
    { speaker: 'krug', text: 'Exit means exit.', clip: 'audio/intros/krug/signature.wav' },
  );
  assert.equal(s.beats[0]!.clip, 'audio/stingers/intro.wav');
});

test('a Captain with no Epithet skips the announcer and still runs about 6–8 s', () => {
  const s = introductionScript(content, krug());
  assert.deepEqual(kinds(s), ['stinger', 'slam', 'shout', 'signature']);
  const ms = s.beats.reduce((t, b) => t + b.ms, 0);
  assert.ok(ms >= 6000 && ms <= 8000, `${ms} ms`);
});

test('in disguise he shouts his alias, and the announcer still adds his current Epithet', () => {
  const s = introductionScript(content, krug({ aliasIdx: 0, epithet: 'the-soggy' }));
  assert.equal(s.name, 'Krúg Bootleg');
  assert.equal(s.really, 'Krúg');
  const shout = s.beats.find((b) => b.kind === 'shout')!;
  assert.equal(shout.text, 'KRÚÚÚG BOOTLEG!');
  assert.equal(shout.clip, 'audio/intros/krug/shout-alias-0.wav');
  assert.equal(s.beats.find((b) => b.kind === 'epithet')!.text, '…THE SOGGY.');
  assert.equal(introductionScript(content, krug({ aliasIdx: 1 })).name, 'Kevin');
});

test("a muffled Captain's lines are muffled and subtitled; the announcer is never muffled", () => {
  const s = introductionScript(content, krug({ epithet: 'the-damp' }), { muffled: true });
  for (const b of s.beats.filter((x) => x.speaker === 'krug')) {
    assert.equal(b.muffled, true, b.kind);
    assert.equal(b.subtitle, b.text, `${b.kind} is subtitled`);
  }
  const announcer = s.beats.find((b) => b.speaker === 'announcer')!;
  assert.equal(announcer.muffled, false);
});

test('a Return head plays its Introduction with his current Epithet and disguise alias', () => {
  // He already has an Epithet; he died and is due back now. Some seed's Return puts him in disguise.
  const quiet = structuredClone(content);
  quiet.templates = quiet.templates.filter((t) => t.trigger !== 'ambient' && t.trigger !== 'reaction');
  for (let seed = 1; seed <= 200; seed++) {
    const base = freshWorld({ content: quiet, seed });
    const id = activeIds(base).find((x) => x !== KRUG && x !== base.world.warlordId)!;
    const stand = Object.keys(base.captains).find((x) => base.captains[x]!.roster === 'reserve')!;
    const now = addMinutes(base.world.now, 5);
    const state: WorldState = {
      ...base,
      affinity: {},
      grudgeTags: [],
      captains: {
        ...base.captains,
        [id]: {
          ...base.captains[id]!,
          epithet: 'the-lukewarm',
          roster: 'dead',
          returnsAt: now,
          death: { cause: { fact: 900, blame: [] }, causeTag: 'beaten' },
        },
        [stand]: { ...base.captains[stand]!, roster: 'active' },
      },
      world: { ...base.world, tickSeq: 1, now, nextNo: 1000 },
    };
    const { facts } = simulate(state, [], seed);
    const ret = facts.find((f): f is Extract<Fact, { kind: 'return' }> => f.kind === 'return');
    const disguise = facts.find((f) => f.kind === 'humiliation' && f.cat === 'disguise');
    if (!ret || !disguise) continue;

    const s = introductionScript(content, ret.intro);
    const card = content.cast.find((c) => c.id === id)!;
    assert.equal(s.name, card.aliases[ret.intro.aliasIdx!], 'introduced under his alias');
    assert.equal(s.really, card.name);
    assert.equal(s.beats.find((b) => b.kind === 'shout')!.text, shoutName(s.name));
    assert.equal(s.beats.find((b) => b.kind === 'epithet')!.text, '…THE LUKEWARM.', 'with the Epithet he has now');
    return;
  }
  assert.fail('no seed brought him back in disguise');
});

test('an unmuffled Captain needs no subtitles: his shout and catchphrase are on screen already', () => {
  const s = introductionScript(content, krug({ epithet: 'the-damp' }));
  assert.ok(s.beats.every((b) => !b.muffled && b.subtitle === null));
});
