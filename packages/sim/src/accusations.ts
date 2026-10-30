// Accusations (D20, D59): after a misfortune, one of the 6 accuser Captains may name a Player as its
// cause. Rare, often wrong, and flavour only: an Accusation changes no state. He can only name a Player
// whose name has been rendered for him (a `name_renders` row), so late joiners become accusable once
// rendered.
//
// Misfortunes are reported through `ctx.misfortune(victim, fact)` as they happen (a lost Clash now;
// deaths and Humiliations call it too). The Accusations are made once, at the end of the tick, on their
// own random stream and with Fact numbers taken after everything else, so with or without them every
// other Fact and the whole diff come out the same (bar the Fact counter).
import { createRng, type Rng } from './rng.ts';
import type { TickContext } from './context.ts';
import { renderLine } from './rumours.ts';
import type { CaptainId, Fact, NameRender, PlayerId } from './types.ts';

export const ACCUSATION = {
  /** Chance an accuser names someone after a misfortune: rare. */
  chance: 0.25,
  /** When a Player he could name really is to blame, the chance he gets it right on purpose. */
  rightChance: 0.35,
  /** Mixed into the tick seed for the Accusations' own random stream. */
  salt: 0xacc05ed,
} as const;

/** A misfortune reported this tick: `victim` suffered `fact`. */
export interface Misfortune {
  victim: CaptainId;
  fact: Fact;
}

/** The Accusations' random stream for a tick seed: separate, so Accusations never shift other rolls. */
export const accusationRng = (seed: number): Rng => createRng((seed ^ ACCUSATION.salt) >>> 0);

/**
 * Turns this tick's misfortunes into Accusations: at most one per victim per story, only by accusers,
 * only naming Players rendered for that accuser. Each is a consequence of the misfortune's story.
 */
export function makeAccusations(ctx: TickContext, rng: Rng): void {
  const { state } = ctx;
  const accusers = new Set(state.content.cast.filter((c) => c.accuser).map((c) => c.id));
  const lines = state.content.banks.accusations;
  const seen = new Set<string>();
  for (const { victim, fact } of ctx.misfortunes) {
    const key = `${fact.storyNo}:${victim}`;
    if (seen.has(key) || !accusers.has(victim)) continue;
    seen.add(key);

    const renders = renderedFor(ctx, victim);
    if (renders.length === 0 || !rng.chance(ACCUSATION.chance)) continue;
    const blamed = new Set(fact.blame.map((b) => b.playerId));
    const guilty = renders.filter((r) => blamed.has(r.playerId));
    const pool = guilty.length > 0 && rng.chance(ACCUSATION.rightChance) ? guilty : renders;
    const { playerId, render } = rng.pick(pool);
    const quote = rng.pick(lines);

    const no = ctx.allocNo();
    ctx.facts.push({
      no,
      at: state.world.now,
      storyNo: fact.storyNo,
      line: renderLine(ctx, `{accuser}: "${quote}"`, { accuser: victim }, { name: render.says }),
      tier: 'templated',
      cast: [victim],
      // He is reacting to what happened to him, so it carries that misfortune's Blame one hop on.
      ...ctx.link(no, { requires: [{ fact: fact.no, blame: fact.blame }] }),
      infamy: [],
      kind: 'accusation',
      accuser: victim,
      accused: playerId,
      correct: blamed.has(playerId),
      clipKey: render.clipKey,
    });
  }
}

/** The Players this accuser can name, in id order, with their render for him. */
function renderedFor(ctx: TickContext, accuser: CaptainId): { playerId: PlayerId; render: NameRender }[] {
  return Object.keys(ctx.state.players)
    .sort()
    .flatMap((playerId) => {
      const render = ctx.state.players[playerId]!.renderedFor.find((r) => r.accuser === accuser);
      return render ? [{ playerId, render }] : [];
    });
}
