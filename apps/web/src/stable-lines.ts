// "Your Stable" ledger lines (#36), private to their Player: "+8 gold: Krúg drowned in 30cm of moat".
// Pure (no DOM), so it's unit-tested. Shapes mirror `YourStable` in packages/server/src/backing.ts.

export type LedgerReason = 'stipend' | 'stake' | 'top_up' | 'withdraw' | 'payout_win' | 'payout_infamy' | 'refund';

export interface GoldChange {
  delta: number;
  lost: number;
  reason: LedgerReason;
  captainId: string | null;
  /** The story's line, for a payout. */
  line: string | null;
}

/** "Your Stable" as frozen into an edition. */
export interface YourStable {
  gold: number;
  meddles: number;
  goldChanges: (GoldChange & { at: string; factNo: number | null })[];
  stakes: { captainId: string; amount: number; held: boolean }[];
  meddlesLanded: { meddleId: string; verb: 'rumour' | 'dare'; targetId: string; factNo: number; line: string }[];
  pendingMeddles: number;
}

/** One ledger row as a line. `nameOf` turns a Captain id into his name. */
export function goldLine(c: GoldChange, nameOf: (id: string) => string): string {
  const who = c.captainId ? nameOf(c.captainId) : 'a Captain';
  const story = c.line?.trim().replace(/\.$/, '') || null;
  const why: Record<LedgerReason, string> = {
    stipend: 'your daily Stipend',
    stake: `you backed ${who}`,
    top_up: `you topped up your Stake on ${who}`,
    withdraw: `you pulled your Stake off ${who} (half back)`,
    // A win pays on the Clash, whose line is about both of them: say who won.
    payout_win: `${who} won a Clash`,
    payout_infamy: story ?? `${who} disgraced himself`,
    refund: 'a Stake that never took, refunded',
  };
  const sign = c.delta < 0 ? '−' : '+';
  const lost = c.lost > 0 ? ` (${c.lost} lost: your purse was full)` : '';
  return `${sign}${Math.abs(c.delta)} gold: ${why[c.reason]}${lost}`;
}
