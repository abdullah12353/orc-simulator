// Backing and gold in SQL (#36): the tick's commit of the sim's `stakes` and `ledger` diff sections.
// submit_intent writes the debits (a new Stake or a top-up) itself; the tick writes the credits.
import type { StateDiff } from '@orc/sim';
import { jsonb, type Tx } from './db.ts';

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
