// Mutable scratch for one tick: allocates sim numbers, collects Facts and the diff, and keeps the
// running values that several steps of one tick touch (affinity, Meddle allowances).
import type { Rng } from './rng.ts';
import type { CaptainId, Fact, PlayerId, StateDiff, WorldState } from './types.ts';

/** Player allowance caps (Meddle verbs #7). */
export const MEDDLE_CAP = 6;
/** Directed affinity runs −100..+100 (D49). */
export const AFFINITY_LIMIT = 100;

export function emptyDiff(): StateDiff {
  return {
    world: {},
    captains: [],
    affinity: [],
    grudgeTags: [],
    trophies: { upsert: [] },
    fears: [],
    humiliations: { upsert: [] },
    meddles: [],
    newMeddles: [],
    fuses: { add: [], remove: [] },
    stakes: [],
    ledger: [],
    playerDeltas: [],
    intents: [],
  };
}

export const pairKey = (holder: CaptainId, toward: CaptainId) => `${holder}>${toward}` as const;

export class TickContext {
  readonly facts: Fact[] = [];
  readonly diff = emptyDiff();
  readonly state: WorldState;
  readonly rng: Rng;
  private nextNo: number;
  private readonly affinity = new Map<string, number>();
  private readonly meddles = new Map<PlayerId, number>();
  private readonly firstMeddles = new Set<PlayerId>();

  constructor(state: WorldState, rng: Rng) {
    this.state = state;
    this.rng = rng;
    this.nextNo = state.world.nextNo;
  }

  allocNo(): number {
    const no = this.nextNo++;
    this.diff.world.nextNo = this.nextNo;
    return no;
  }

  /** Living active Captains, in slug order (the determinism rule). */
  activeCaptains(): CaptainId[] {
    return Object.keys(this.state.captains)
      .filter((id) => this.state.captains[id]!.roster === 'active')
      .sort();
  }

  /** Affinity as it stands at this point in the tick. */
  getAffinity(holder: CaptainId, toward: CaptainId): number {
    const key = pairKey(holder, toward);
    return this.affinity.get(key) ?? this.state.affinity[key] ?? 0;
  }

  /** Sets affinity, clamped to −100..+100. 0 deletes the row. */
  setAffinity(holder: CaptainId, toward: CaptainId, value: number): number {
    const v = Math.max(-AFFINITY_LIMIT, Math.min(AFFINITY_LIMIT, Math.round(value)));
    this.affinity.set(pairKey(holder, toward), v);
    return v;
  }

  /** Every pair with non-zero affinity right now, in key order. */
  affinityPairs(): [CaptainId, CaptainId][] {
    const keys = new Set([...Object.keys(this.state.affinity), ...this.affinity.keys()]);
    return [...keys]
      .sort()
      .map((k) => k.split('>') as [CaptainId, CaptainId])
      .filter(([h, t]) => this.getAffinity(h, t) !== 0);
  }

  playerMeddles(p: PlayerId): number {
    return this.meddles.get(p) ?? this.state.players[p]?.meddles ?? 0;
  }

  /** Grants (or refunds) Meddles, capped at 6. */
  addMeddles(p: PlayerId, n: number): void {
    this.meddles.set(p, Math.max(0, Math.min(MEDDLE_CAP, this.playerMeddles(p) + n)));
  }

  firstMeddleDone(p: PlayerId): boolean {
    return this.firstMeddles.has(p) || (this.state.players[p]?.firstMeddleDone ?? false);
  }

  markFirstMeddle(p: PlayerId): void {
    if (!this.firstMeddleDone(p)) this.firstMeddles.add(p);
  }

  /** Writes the running values into the diff. Call once, at the end of the tick. */
  finish(): void {
    for (const [key, value] of [...this.affinity].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (value === (this.state.affinity[key as `${string}>${string}`] ?? 0)) continue;
      const [holder, toward] = key.split('>') as [CaptainId, CaptainId];
      this.diff.affinity.push({ holder, toward, value });
    }
    const players = [...new Set([...this.meddles.keys(), ...this.firstMeddles])].sort();
    for (const playerId of players) {
      const delta: StateDiff['playerDeltas'][number] = { playerId };
      const meddles = this.playerMeddles(playerId) - (this.state.players[playerId]?.meddles ?? 0);
      if (meddles !== 0) delta.meddles = meddles;
      if (this.firstMeddles.has(playerId)) delta.firstMeddleDone = true;
      if (Object.keys(delta).length > 1) this.diff.playerDeltas.push(delta);
    }
  }
}
