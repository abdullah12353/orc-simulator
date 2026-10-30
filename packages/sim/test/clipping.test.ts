// #41 Clippings (D54, user stories 96–97): any Herald story cut into a shareable card that never changes.
// What goes on the card is decided here, purely: the pull quote (for a Clash, the loser's last line),
// whose portraits, and any Trophy. The faces are frozen as composed at clip time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePortrait, content } from '@orc/content';
import { buildClipping, dayZero, fallbackDialogue, pullQuote, type ClashLine, type Fact } from '@orc/sim';

type ClashFact = Extract<Fact, { kind: 'clash' }>;

const dayZeroFacts = (seed: number) =>
  dayZero(content, seed, '2026-10-30T12:00:00.000Z', 'w').steps.flatMap((s) => s.facts);

/** A day zero with a wrong saviour in it, and its Clashes. */
function clashes(): ClashFact[] {
  for (let seed = 1; seed < 40; seed++) {
    const found = dayZeroFacts(seed).filter((f): f is ClashFact => f.kind === 'clash');
    if (found.some((f) => f.saviour) && found.some((f) => !f.saviour)) return found;
  }
  throw new Error('no day zero with both kinds of Clash');
}

const nameOf = (id: string) => content.cast.find((c) => c.id === id)!.name;

test("a clipped Clash's pull quote is the loser's last line, saviour or not", () => {
  for (const clash of clashes()) {
    const lines = fallbackDialogue(content, clash);
    const quote = pullQuote(content, clash, { dialogue: lines });
    assert.deepEqual(quote, { speaker: clash.loser, name: nameOf(clash.loser), text: lines.at(-1)!.text }, `Clash ${clash.no}`);
  }
});

test('when the loser speaks more than once, the quote is the last thing he said', () => {
  const clash = clashes().find((f) => !f.saviour)!;
  const lines: ClashLine[] = [
    { speaker: clash.loser, text: 'First, a boast.' },
    { speaker: clash.winner, text: 'A thump.' },
    { speaker: clash.loser, text: 'Ow. My dignity.' },
  ];
  assert.equal(pullQuote(content, clash, { dialogue: lines })!.text, 'Ow. My dignity.');
  assert.equal(pullQuote(content, clash, { dialogue: null }), null, 'no dialogue stored, no quote');
});

test("any other story quotes the edition's Accusation if it ran with it, else nothing", () => {
  const head = dayZeroFacts(3).find((f) => f.kind === 'incident' && f.no === f.storyNo)!;
  assert.equal(pullQuote(content, head, {}), null);
  const accusation = {
    ...head,
    no: head.no + 1,
    kind: 'accusation',
    accuser: 'krug',
    accused: 'p1',
    correct: false,
    clipKey: 'k',
    line: 'Krúg: "It was Mudhammad, I seen him."',
  } as Fact;
  assert.deepEqual(pullQuote(content, head, { accusation }), { speaker: 'krug', name: 'Krúg', text: 'It was Mudhammad, I seen him.' });
});

test("a clipping freezes the headline, both Clashers' faces as given, the Blame line and the Trophy", () => {
  const all = dayZeroFacts(7);
  const trophy = all.find((f) => f.kind === 'trophy')!;
  const head = all.find((f) => f.no === trophy.storyNo) as ClashFact;
  assert.equal(head.kind, 'clash');
  const story = all.filter((f) => f.storyNo === head.no);
  const marks = [{ key: 'bandage.mouth', no: 4 }];

  const snap = buildClipping(content, {
    head,
    story,
    dialogue: fallbackDialogue(content, head),
    headline: 'ORCS IN SCUFFLE',
    blameLine: 'It all began when Mo spread a Rumour.',
    faces: { [head.loser]: { marks, legendary: true } },
    edition: { id: 'e1', no: 2, orcDate: 'Moanday' },
  });

  assert.equal(snap.storyNo, head.no);
  assert.equal(snap.kind, 'clash');
  assert.equal(snap.headline, 'ORCS IN SCUFFLE');
  assert.equal(snap.blameLine, 'It all began when Mo spread a Rumour.');
  assert.deepEqual(snap.portraits.map((p) => p.captainId), [head.a, head.b]);
  const loser = snap.portraits.find((p) => p.captainId === head.loser)!;
  assert.equal(loser.name, nameOf(head.loser));
  assert.deepEqual(loser.face, composePortrait(content, { captainId: head.loser, marks, legendary: true }));
  const winner = snap.portraits.find((p) => p.captainId === head.winner)!;
  assert.deepEqual(winner.face, composePortrait(content, { captainId: head.winner, marks: [] }), 'no face history: bare');
  assert.equal(snap.pullQuote!.speaker, head.loser);
  const t = trophy as Extract<Fact, { kind: 'trophy' }>;
  assert.deepEqual(snap.trophy, {
    key: t.key,
    text: content.banks.trophies[t.key]!.text,
    from: t.from,
    to: t.to,
  });
  assert.deepEqual(snap.edition, { id: 'e1', no: 2, orcDate: 'Moanday' });
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap, 'stores as plain JSON');
});

test("a story that isn't a Clash shows the first two Captains it cast", () => {
  const head = dayZeroFacts(3).find((f) => f.no === f.storyNo && f.kind !== 'clash' && new Set(f.cast).size >= 2)!;
  const snap = buildClipping(content, { head, story: [head], dialogue: null, headline: head.line, blameLine: null, faces: {}, edition: null });
  assert.deepEqual(snap.portraits.map((p) => p.captainId), [...new Set(head.cast)].slice(0, 2));
  assert.equal(snap.trophy, null);
  assert.equal(snap.pullQuote, null);
});
