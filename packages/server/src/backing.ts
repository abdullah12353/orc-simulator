// Backing and gold in SQL (#36): the tick's commit of the sim's `stakes` and `ledger` diff sections.
// submit_intent writes the debits (a new Stake or a top-up) itself; the tick writes the credits.
import type { LedgerReason, StateDiff } from '@orc/sim';
import { jsonb, type Sql, type Tx } from './db.ts';

/**
 * "Your Stable" (data-model §4.1): the reader's private section of an edition, frozen into
 * `editions.stable` when it's printed. Never in the shared Herald, never in a push.
 */
export interface YourStable {
  /** Unstaked gold and Meddles left, as they stood when the edition was printed. */
  gold: number;
  meddles: number;
  /** The reader's ledger rows in the edition's window, oldest first ("+8 gold: Krúg drowned in…"). */
  goldChanges: {
    at: string;
    delta: number;
    lost: number;
    reason: LedgerReason;
    captainId: string | null;
    factNo: number | null;
    /** The story's line, for a payout. */
    line: string | null;
  }[];
  /** Every Stake, by Captain; `held` while he is dead (it resumes on his Return). */
  stakes: { captainId: string; amount: number; held: boolean }[];
  /** The reader's Meddles that landed in the window, oldest first, with their story's line. */
  meddlesLanded: { meddleId: string; verb: 'rumour' | 'dare'; targetId: string; factNo: number; line: string }[];
  /** Meddles still to land: queued, fused or held. */
  pendingMeddles: number;
}

/** The reader's Stable for an edition covering `(from, to]`. */
export async function buildStable(tx: Sql | Tx, playerId: string, from: string, to: string): Promise<YourStable> {
  const [me] = await tx<{ gold: number; meddles: number }[]>`
    select gold, meddles_available as meddles from player_private where player_id = ${playerId}`;
  const ledger = await tx<
    { at: string; delta: number; lost: number; reason: LedgerReason; captain_id: string | null; fact_no: number | null; line: string | null }[]
  >`
    select to_json(l.at)#>>'{}' as at, l.delta, l.lost, l.reason, l.captain_id, l.fact_no::float8 as fact_no, f.line
    from gold_ledger l left join facts f on f.world_id = l.world_id and f.no = l.fact_no
    where l.player_id = ${playerId} and l.at > ${from} and l.at <= ${to}
    order by l.at, l.id`;
  const stakes = await tx<{ captain_id: string; amount: number; held: boolean }[]>`
    select s.captain_id, s.amount, c.roster = 'dead' as held
    from stakes s join captains c on c.world_id = s.world_id and c.id = s.captain_id
    where s.player_id = ${playerId}
    order by s.captain_id collate "C"`;
  const landed = await tx<{ id: string; verb: 'rumour' | 'dare'; target_id: string; fact_no: number; line: string }[]>`
    select m.id, m.verb::text as verb, m.target_id, f.no::float8 as fact_no, f.line
    from meddles m join facts f on f.world_id = m.world_id and f.no = m.landed_fact
    where m.player_id = ${playerId} and f.at > ${from} and f.at <= ${to}
    order by f.at, f.no`;
  const [pending] = await tx<{ n: number }[]>`
    select (select count(*) from meddles where player_id = ${playerId} and status in ('pending', 'held'))
         + (select count(*) from intents where player_id = ${playerId} and status = 'queued' and kind in ('rumour', 'dare'))
           as n`;
  return {
    gold: me!.gold,
    meddles: me!.meddles,
    goldChanges: ledger.map((l) => ({
      at: new Date(l.at).toISOString(),
      delta: l.delta,
      lost: l.lost,
      reason: l.reason,
      captainId: l.captain_id,
      factNo: l.fact_no,
      line: l.line,
    })),
    stakes: stakes.map((s) => ({ captainId: s.captain_id, amount: s.amount, held: s.held })),
    meddlesLanded: landed.map((m) => ({ meddleId: m.id, verb: m.verb, targetId: m.target_id, factNo: m.fact_no, line: m.line })),
    pendingMeddles: Number(pending!.n),
  };
}

/**
 * Stakes are absolute (0 deletes the row). Ledger rows are inserted as the sim wrote them (already capped
 * at 30, with the overflow in `lost`), and each Player's gold moves by the sum of their deltas. The tick
 * holds the Player rows, so nothing else moved the gold since it was loaded.
 */
export async function commitBacking(tx: Tx, worldId: string, diff: Pick<StateDiff, 'stakes' | 'ledger'>, now: string): Promise<void> {
  const gone = diff.stakes.filter((s) => s.amount === 0);
  const kept = diff.stakes.filter((s) => s.amount !== 0);
  if (gone.length > 0) {
    await tx`
      delete from stakes s using jsonb_array_elements(${jsonb(tx, gone)}) as g
      where s.player_id = (g->>'playerId')::uuid and s.captain_id = g->>'captainId'`;
  }
  if (kept.length > 0) {
    await tx`
      insert into stakes (world_id, player_id, captain_id, amount, created_at, updated_at)
      select ${worldId}, (s->>'playerId')::uuid, s->>'captainId', (s->>'amount')::int, ${now}, ${now}
      from jsonb_array_elements(${jsonb(tx, kept)}) as s
      on conflict (player_id, captain_id) do update set amount = excluded.amount, updated_at = excluded.updated_at`;
  }
  if (diff.ledger.length === 0) return;
  await tx`
    insert into gold_ledger (world_id, player_id, delta, lost, reason, fact_no, captain_id, at)
    select ${worldId}, (l->>'playerId')::uuid, (l->>'delta')::int, (l->>'lost')::int, l->>'reason',
           (l->>'fact')::bigint, l->>'captainId', ${now}
    from jsonb_array_elements(${jsonb(tx, diff.ledger)}) with ordinality as x(l, n)
    order by n`;
  await tx`
    update player_private pp set gold = least(30, greatest(0, pp.gold + d.delta))
    from (
      select (l->>'playerId')::uuid as player_id, sum((l->>'delta')::int)::int as delta
      from jsonb_array_elements(${jsonb(tx, diff.ledger)}) as l
      group by 1
    ) d
    where pp.player_id = d.player_id`;
}
