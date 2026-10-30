// Mutable scratch for one tick: allocates sim numbers, collects Facts and the diff, and keeps the
// running values that several steps of one tick touch (affinity, Meddle allowances).
import type { Misfortune } from './accusations.ts';
import { chain, pairCauses, type Links } from './blame.ts';
import type { Rng } from './rng.ts';
import { isoToMs } from './time.ts';
import type { BlameEntry, CaptainId, Cause, Fact, FactNo, PlayerId, StateDiff, TemplateId, Trophy, WorldState } from './types.ts';

/** Player allowance caps (Meddle verbs #7). */
export const MEDDLE_CAP = 6;
/** Directed affinity runs −100..+100 (D49). */
export const AFFINITY_LIMIT = 100;
/** The variety rule (D47): a Template seen in the last 24 h, or a pair seen in the last hour, counts half. */
export const VARIETY = { templateHours: 24, pairHours: 1 } as const;

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
    recent: { templates: {}, pairs: {} },
  };
}

/** The `recent.pairs` key for two Captains, in either order. */
export const pairOf = (x: CaptainId, y: CaptainId) => (x < y ? `${x}|${y}` : `${y}|${x}`);

export const pairKey = (holder: CaptainId, toward: CaptainId) => `${holder}>${toward}` as const;

export class TickContext {
  readonly facts: Fact[] = [];
  readonly diff = emptyDiff();
  /** Callbacks per Fact number, for comedy weight (D50). Never Blame. */
  readonly callbacks = new Map<FactNo, number>();
  /** Unordered pairs (`x|y`) that already Clashed this tick: a pair Clashes at most once a tick. */
  readonly clashedPairs = new Set<string>();
  /** Misfortunes reported this tick, in order (see `misfortune`). */
  readonly misfortunes: Misfortune[] = [];
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

  /**
   * A new Fact's `causes` and `blame` (data-model §2): only what its Template required carries Blame.
   * Callbacks are counted against `no` for comedy weight. Every new Template and Fact kind goes through this.
   */
  link(no: FactNo, links: Links): { causes: FactNo[]; blame: BlameEntry[] } {
    const { causes, blame, callbacks } = chain(links);
    if (callbacks > 0) this.callbacks.set(no, (this.callbacks.get(no) ?? 0) + callbacks);
    return { causes, blame };
  }

  /**
   * The misfortune hook (#39): `victim` just suffered `fact` (a lost Clash; a death or a Humiliation).
   * Call it once the Fact (with its Blame) is written. If the victim is an accuser, he may name a Player
   * for it at the end of the tick (accusations.ts). One Accusation at most per victim per story.
   */
  misfortune(victim: CaptainId, fact: Fact): void {
    this.misfortunes.push({ victim, fact });
  }

  /** A pair's Grudge tags from the last 7 days (the newest 3, this tick's included) as causes. */
  pairCauses(holder: CaptainId, toward: CaptainId): Cause[] {
    return pairCauses([...this.state.grudgeTags, ...this.diff.grudgeTags], holder, toward, this.state.world.now);
  }

  /** Was this Template used in the last 24 h (this tick included)? */
  recentTemplate(id: TemplateId): boolean {
    if (this.facts.some((f) => f.templateId === id)) return true;
    return this.within(this.state.recent.templates[id], VARIETY.templateHours);
  }

  /** Did these two Captains share a templated Fact in the last hour (this tick included)? */
  recentPair(x: CaptainId, y: CaptainId): boolean {
    if (this.facts.some((f) => f.templateId && f.cast.includes(x) && f.cast.includes(y))) return true;
    return this.within(this.state.recent.pairs[pairOf(x, y)], VARIETY.pairHours);
  }

  private within(at: string | undefined, hours: number): boolean {
    return at !== undefined && isoToMs(at) > isoToMs(this.state.world.now) - hours * 3_600_000;
  }

  /** The Trophies as they stand at this point in the tick, in number order. */
  trophies(): Trophy[] {
    const byNo = new Map(this.state.trophies.map((t) => [t.no, t]));
    for (const t of this.diff.trophies.upsert) byNo.set(t.no, t);
    return [...byNo.values()].sort((a, b) => a.no - b.no);
  }

  /** Puts a Trophy in a (new) holder's hands. */
  upsertTrophy(t: Trophy): void {
    const i = this.diff.trophies.upsert.findIndex((x) => x.no === t.no);
    if (i >= 0) this.diff.trophies.upsert[i] = t;
    else this.diff.trophies.upsert.push(t);
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
    for (const f of this.facts) {
      if (!f.templateId) continue;
      this.diff.recent.templates[f.templateId] = f.at;
      for (const x of f.cast) for (const y of f.cast) if (x < y) this.diff.recent.pairs[pairOf(x, y)] = f.at;
    }
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
