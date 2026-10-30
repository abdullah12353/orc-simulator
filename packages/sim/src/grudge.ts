// Holding a Grudge (D49): what a landed Rumour, a Prank and a lost Clash all leave behind.
import { causeOf } from './blame.ts';
import type { TickContext } from './context.ts';
import type { BlameEntry, CaptainId, Fact } from './types.ts';

/**
 * `holder` now thinks `sting` less of `toward`: affinity down, a silent `grudge` consequence in `head`'s
 * story, and a permanent Grudge tag whose cause is the head (so a later Clash over it is one hop on).
 * `own` is the head's own Meddle, when the head is a Meddle landing: it keeps the Grudge at hop 0.
 */
export function holdGrudge(
  ctx: TickContext,
  head: Fact,
  g: { holder: CaptainId; toward: CaptainId; sting: number; tag: string; own?: BlameEntry[] },
): void {
  const { holder, toward, tag } = g;
  const now = ctx.state.world.now;
  const before = ctx.getAffinity(holder, toward);
  const after = ctx.setAffinity(holder, toward, before - g.sting);
  const cause = causeOf(head);
  const no = ctx.allocNo();
  ctx.facts.push({
    no,
    at: now,
    storyNo: head.no,
    line: '',
    tier: 'silent',
    cast: [holder, toward],
    ...ctx.link(no, { requires: [cause], ...(g.own ? { own: g.own } : {}) }),
    infamy: [],
    kind: 'grudge',
    holder,
    toward,
    tag,
    delta: after - before,
  });
  ctx.diff.grudgeTags.push({ no: ctx.allocNo(), holder, toward, tag, at: now, cause });
}
