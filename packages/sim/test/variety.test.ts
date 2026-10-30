// #30 Variety (D47): a Template used in the last 24 h and a pair seen together in the last hour count
// half; Krúg counts double when a cast is picked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { content as shipped, KRUG, type Content, type TemplateDef } from '@orc/content';
import { simulate, type CaptainId, type WorldState } from '@orc/sim';
import { activeIds, addMinutes, freshWorld, SEEDS, step } from './support.ts';

const lines: TemplateDef['lines'] = ['{a} and {b}.', '{a} with {b}.', '{b} and {a}.'];
const ambient = (id: string, roles: TemplateDef['roles'] = [{ name: 'a' }, { name: 'b' }]): TemplateDef => ({
  id,
  kind: 'incident',
  trigger: 'ambient',
  roles,
  outcomes: [{ key: 'x', weight: 1 }],
  lines,
  baseWeight: 1,
});

/** A watched world with only the given ambient Templates, no Grudges and no reactions. */
function world(templates: TemplateDef[], recent: WorldState['recent'] = { templates: {}, pairs: {} }): WorldState {
  const c: Content = structuredClone(shipped);
  c.templates = [...c.templates.filter((t) => t.kind === 'rumour' || t.kind === 'clash'), ...templates].filter(
    (t) => t.trigger !== 'reaction',
  );
  const base = freshWorld({ content: c, watched: true });
  return { ...base, affinity: {}, grudgeTags: [], recent, world: { ...base.world, tickSeq: 1 } };
}

/** The ambient incidents one tick produces under each of n tick seeds. */
function incidents(state: WorldState, n: number) {
  const out = [];
  for (let seed = 1; seed <= n; seed++) {
    for (const f of simulate(state, [], seed).facts) if (f.kind === 'incident') out.push(f);
  }
  return out;
}

const N = Math.max(12_000, SEEDS * 300);
const hoursAgo = (state: WorldState, h: number) => addMinutes(state.world.now, -h * 60);

test('Krúg counts double when a cast is picked', () => {
  const state = world([ambient('test.pair')]);
  const all = incidents(state, N);
  const rate = all.filter((f) => f.cast.includes(KRUG)).length / all.length;
  // 12 active, Krúg weighs 2: P = 2/13 + (11/13)(2/12) ≈ 0.295, against 2/12 ≈ 0.167 if he counted once.
  assert.ok(Math.abs(rate - 0.295) < 0.03, `Krúg in ${rate} of incidents`);
});

test('a Template used in the last 24 h counts half; one used longer ago counts in full', () => {
  const pick = (h: number) => {
    const s = world([ambient('test.x'), ambient('test.y')]);
    const state = { ...s, recent: { templates: { 'test.x': hoursAgo(s, h) }, pairs: {} } };
    const all = incidents(state, N);
    return all.filter((f) => f.templateId === 'test.x').length / all.length;
  };
  const recent = pick(23);
  assert.ok(Math.abs(recent - 1 / 3) < 0.03, `recent Template picked ${recent}`);
  const old = pick(25);
  assert.ok(Math.abs(old - 1 / 2) < 0.03, `day-old Template picked ${old}`);
});

test('a pair seen together in the last hour counts half', () => {
  const s = world([]);
  const [pinned, partner] = activeIds(s, (id) => id !== KRUG);
  const state0 = world([ambient('test.pinned', [{ name: 'a', captain: pinned }, { name: 'b' }])]);
  const rate = (minutesAgo: number) => {
    const pairs = { [pinned! < partner! ? `${pinned}|${partner}` : `${partner}|${pinned}`]: addMinutes(state0.world.now, -minutesAgo) };
    const all = incidents({ ...state0, recent: { templates: {}, pairs } }, N);
    return all.filter((f) => f.cast.includes(partner as CaptainId)).length / all.length;
  };
  // 11 others for role b, Krúg weighing 2: 1/12 in full, 0.5/11.5 at half.
  const fresh = rate(30);
  const stale = rate(61);
  assert.ok(Math.abs(fresh - 0.5 / 11.5) < 0.012, `recent pair ${fresh}`);
  assert.ok(Math.abs(stale - 1 / 12) < 0.015, `hour-old pair ${stale}`);
});

test('the state remembers what each tick used, and forgets it once it is out of the window', () => {
  let state = world([ambient('test.pair')]);
  let used: { at: string; cast: string[] } | null = null;
  for (let i = 0; i < 60 && !used; i++) {
    const r = step(state, 3, 5);
    state = r.state;
    const f = r.facts.find((x) => x.kind === 'incident');
    if (f) used = { at: f.at, cast: f.cast };
  }
  assert.ok(used);
  assert.equal(state.recent.templates['test.pair'], used.at);
  const [x, y] = [...used.cast].sort();
  assert.equal(state.recent.pairs[`${x}|${y}`], used.at);

  // Quiet ticks (no ambient) for 2 hours: the pair is forgotten, the Template is still remembered.
  const quiet = { ...state, world: { ...state.world, watched: false } };
  let later = quiet;
  for (let i = 0; i < 25; i++) later = step({ ...later, content: { ...later.content, templates: [] } }, 3, 5).state;
  assert.equal(later.recent.pairs[`${x}|${y}`], undefined);
  assert.equal(later.recent.templates['test.pair'], used.at);
});
