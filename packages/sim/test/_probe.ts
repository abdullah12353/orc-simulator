import { content } from '@orc/content';
import { dayZero } from '@orc/sim';
const T0 = '2026-10-30T12:00:00.000Z';
const tot: Record<string, number> = { facts: 0, heads: 0, clash: 0, ambient: 0, reaction: 0, saviour: 0, trophy: 0, firstHalf: 0 };
const N = 40;
for (let seed = 1; seed <= N; seed++) {
  const { steps } = dayZero(content, seed, T0, 'w');
  const f = steps.flatMap((s) => s.facts);
  tot.facts! += f.length;
  tot.heads! += f.filter((x) => x.no === x.storyNo).length;
  tot.clash! += f.filter((x) => x.kind === 'clash').length;
  tot.saviour! += f.filter((x) => x.kind === 'clash' && x.saviour).length;
  tot.trophy! += f.filter((x) => x.kind === 'trophy').length;
  tot.ambient! += f.filter((x) => x.kind === 'incident' && x.trigger === 'ambient').length;
  tot.reaction! += f.filter((x) => x.kind === 'incident' && x.trigger === 'reaction').length;
  tot.firstHalf! += steps.slice(0, 144).flatMap((s) => s.facts).filter((x) => x.kind === 'clash').length;
}
for (const [k, v] of Object.entries(tot)) console.log(k, (v / N).toFixed(1));
