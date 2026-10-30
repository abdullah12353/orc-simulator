// Backing and gold (#36; Backing economy #8: D33–D36). Gold comes only from a flat daily Stipend and
// Backing payouts, banked up to 30 with the overflow lost (logged as `lost`), and never reset. A Stake is
// a standing pile of gold behind one Captain: held through his death, withdrawn for half back. Each
// backer gives his Captain a flat Clash edge, and each win and each point of Infamy pays a slice of the Stake.
//
// Gold is private (decision 7): it lives only in the diff's `ledger` and `stakes`, never on a Fact, and no
// random draw ever depends on an amount. Debits (a new Stake or a top-up) happen at submit_intent; the
// sim only ever credits (Stipend, withdrawals, payouts and refunds), through `credit`.
import { compareCodeUnits } from '@orc/content';
import type { TickContext } from './context.ts';
import type { Intent } from './types.ts';

export const BACKING = {
  /** The daily Stipend, the same for every Player (D33). */
  stipend: 10,
  /** Unstaked gold banks up to this; anything past it is lost (D33). */
  goldCap: 30,
  /** Each backing Player adds this to his Captain's Clash odds, whatever the Stake (D35)… */
  edgePerBacker: 0.05,
  /** …up to this in all. Clashes only: Dares, Rumours and accidents are never nudged. */
  edgeCap: 0.1,
  /** A Clash win pays this % of the Stake (D36)… */
  winPct: 10,
  /** …and each point of Infamy this %, so backing an idiot beats backing a hard man. Both round up. */
  infamyPct: 1,
} as const;

/** The Clash edge for this many backers (rounded, so 2 × 5% is exactly 10%). */
export function edgeFor(backers: number): number {
  return Math.round(Math.min(BACKING.edgeCap, backers * BACKING.edgePerBacker) * 1000) / 1000;
}

/** The Players backing a Captain at this point in the tick, in id order. */
export function backersOf(ctx: TickContext, captainId: string): string[] {
  return currentStakes(ctx)
    .filter((s) => s.captainId === captainId)
    .map((s) => s.playerId);
}

export type LedgerReason = 'stipend' | 'stake' | 'top_up' | 'withdraw' | 'payout_win' | 'payout_infamy' | 'refund';

/** A Player's unstaked gold at this point in the tick. */
export function goldOf(ctx: TickContext, playerId: string): number {
  return ctx.gold.get(playerId) ?? ctx.state.players[playerId]?.gold ?? 0;
}

/**
 * Gives a Player gold, banked up to 30: what doesn't fit is lost, and the ledger row says how much.
 * The only way the sim moves gold.
 */
export function credit(
  ctx: TickContext,
  playerId: string,
  amount: number,
  reason: LedgerReason,
  about: { fact?: number; captainId?: string } = {},
): void {
  const gold = goldOf(ctx, playerId);
  const delta = Math.max(0, Math.min(amount, BACKING.goldCap - gold));
  ctx.gold.set(playerId, gold + delta);
  ctx.diff.ledger.push({ playerId, delta, lost: amount - delta, reason, ...about });
}

/** The day roll's Stipend for every Player, in id order (day.ts calls it). */
export function grantStipends(ctx: TickContext): void {
  for (const playerId of Object.keys(ctx.state.players).sort()) credit(ctx, playerId, BACKING.stipend, 'stipend');
}

const stakeKey = (playerId: string, captainId: string) => `${playerId}|${captainId}`;
const byKey = ([a]: [string, unknown], [b]: [string, unknown]) => compareCodeUnits(a, b);

/** A Player's Stake on a Captain at this point in the tick (0 for none). */
export function stakeOf(ctx: TickContext, playerId: string, captainId: string): number {
  const key = stakeKey(playerId, captainId);
  if (ctx.stakes.has(key)) return ctx.stakes.get(key)!;
  return ctx.state.stakes.find((s) => s.playerId === playerId && s.captainId === captainId)?.amount ?? 0;
}

/** Every Stake as it stands at this point in the tick, in (Player, Captain) order. */
export function currentStakes(ctx: TickContext): { playerId: string; captainId: string; amount: number }[] {
  const all = new Map(ctx.state.stakes.map((s) => [stakeKey(s.playerId, s.captainId), s.amount]));
  for (const [key, amount] of ctx.stakes) all.set(key, amount);
  return [...all]
    .filter(([, amount]) => amount > 0)
    .sort(byKey)
    .map(([key, amount]) => {
      const [playerId, captainId] = key.split('|') as [string, string];
      return { playerId, captainId, amount };
    });
}

export type BackingIntent = Extract<Intent, { kind: 'back' | 'withdraw' }>;

export const isBackingIntent = (i: Intent): i is BackingIntent => i.kind === 'back' || i.kind === 'withdraw';

/**
 * Applies Players' `back` and `withdraw` intents, oldest first. A `back` (new Stake or top-up) was already
 * debited by submit_intent; one for a Captain who doesn't exist is rejected and its gold refunded. A
 * `withdraw` ends the Stake and returns half of it, rounded down (past the cap, the rest is lost); with
 * no Stake left to withdraw, it is rejected.
 */
export function consumeBacking(ctx: TickContext, intents: Intent[]): void {
  for (const intent of intents) {
    if (!isBackingIntent(intent)) continue;
    const reject = (reason: string) => ctx.diff.intents.push({ id: intent.id, status: 'rejected', reason });
    if (!ctx.state.players[intent.playerId]) {
      reject('unknown_player'); // a Player who has left: nothing to refund
      continue;
    }
    const key = stakeKey(intent.playerId, intent.captainId);
    const stake = stakeOf(ctx, intent.playerId, intent.captainId);
    if (intent.kind === 'back') {
      if (!Number.isInteger(intent.amount) || intent.amount < 1) {
        reject('bad_amount'); // submit_intent never debits one of these
        continue;
      }
      if (!ctx.state.captains[intent.captainId]) {
        reject('unknown_captain');
        credit(ctx, intent.playerId, intent.amount, 'refund');
        continue;
      }
      ctx.stakes.set(key, stake + intent.amount);
    } else {
      if (stake <= 0) {
        reject('no_stake');
        continue;
      }
      ctx.stakes.set(key, 0);
      credit(ctx, intent.playerId, Math.floor(stake / 2), 'withdraw', { captainId: intent.captainId });
    }
    ctx.diff.intents.push({ id: intent.id, status: 'consumed' });
  }
}

/** `pct`% of a Stake, rounded up (so every payout is at least 1 gold). */
const slice = (stake: number, pct: number) => Math.floor((stake * pct + 99) / 100);

/**
 * Pays this tick's Backing, story by story in Fact order: the winner of a Clash pays his backers 10% of
 * their Stake (the Clash is the ledger's Fact), and every Captain who gained Infamy in a story pays 1% per
 * point of it (its head is the Fact; a death counts, so a Stake on a dead Captain still pays). Then it writes
 * the tick's Stake changes into the diff (absolute amounts; 0 deletes). Call once, after every Fact is written.
 */
export function settleBacking(ctx: TickContext): void {
  const stakes = currentStakes(ctx);
  const pay = (captainId: string, pct: number, reason: LedgerReason, fact: number) => {
    for (const s of stakes) {
      if (s.captainId === captainId) credit(ctx, s.playerId, slice(s.amount, pct), reason, { fact, captainId });
    }
  };
  const infamy = new Map<number, Map<string, number>>(); // story head → Captain → points
  for (const f of ctx.facts) {
    for (const g of f.infamy) {
      const story = infamy.get(f.storyNo) ?? new Map<string, number>();
      story.set(g.captainId, (story.get(g.captainId) ?? 0) + g.amount);
      infamy.set(f.storyNo, story);
    }
  }
  if (stakes.length > 0) {
    for (const head of ctx.facts) {
      if (head.no !== head.storyNo) continue;
      if (head.kind === 'clash') pay(head.winner, BACKING.winPct, 'payout_win', head.no);
      const story = infamy.get(head.no);
      if (!story) continue;
      for (const [captainId, points] of [...story].sort(byKey)) pay(captainId, BACKING.infamyPct * points, 'payout_infamy', head.no);
    }
  }

  for (const [key, amount] of [...ctx.stakes].sort(byKey)) {
    const [playerId, captainId] = key.split('|') as [string, string];
    const before = ctx.state.stakes.find((s) => s.playerId === playerId && s.captainId === captainId)?.amount ?? 0;
    if (amount !== before) ctx.diff.stakes.push({ playerId, captainId, amount });
  }
}
