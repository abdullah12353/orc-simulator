// The simulate() contract, as locked in data-model.md §2. Later tickets fill in behaviour, not shapes.
import type { BankKey, CaptainId, Claim, Content, TemplateId } from '@orc/content';

export type { BankKey, CaptainId, Claim, Content, TemplateId };
export type PlayerId = string; // uuid
export type MeddleId = string; // uuid
export type FactNo = number; // per-world bigint, allocated from state.world.nextNo
export type RowNo = number;
/** ISO timestamp. The sim never reads the wall clock; time comes in via state.world.now. */
export type Iso = string;

// ---- causality: how Blame is carried ----
export interface BlameEntry {
  meddleId: MeddleId;
  playerId: PlayerId;
  verb: 'rumour' | 'dare';
  landedFact: FactNo;
  landedAt: Iso;
  hops: number;
}
export interface Cause {
  fact: FactNo;
  blame: BlameEntry[];
}

// ---- input state ----
export interface WorldState {
  world: {
    id: string;
    tickSeq: number;
    now: Iso;
    prevTickAt: Iso;
    watched: boolean;
    day: string;
    deathsToday: number;
    warlordId: CaptainId | null;
    nextNo: number;
    contentVersion: string;
  };
  content: Content;
  captains: Record<CaptainId, CaptainState>;
  affinity: Record<`${CaptainId}>${CaptainId}`, number>;
  grudgeTags: GrudgeTag[];
  trophies: Trophy[];
  humiliations: Humiliation[];
  stakes: { playerId: PlayerId; captainId: CaptainId; amount: number }[];
  players: Record<PlayerId, { gold: number; meddles: number; firstMeddleDone: boolean; renderedFor: NameRender[] }>;
  meddles: Record<MeddleId, Meddle>;
  fuses: Fuse[];
  infamy7d: { captainId: CaptainId; fact: FactNo; at: Iso; amount: number }[];
  /**
   * When each Template (last 24 h) and each Captain pair (last 1 h, key `x|y` with x < y) last appeared in
   * a templated Fact. Feeds the variety rule (D47). Entries outside the windows may linger; the sim ignores them.
   */
  recent: { templates: Record<TemplateId, Iso>; pairs: Record<string, Iso> };
}

/**
 * A prerecorded clip of one accuser saying a Player's mangled name (a `name_renders` row, D59). Only a
 * Player with one for an accuser can be Accused by him. Deviates from data-model §2 (`renderedFor:
 * CaptainId[]`): the sim needs the clip key for the Fact and the mangled name for its line.
 */
export interface NameRender {
  accuser: CaptainId;
  clipKey: string;
  /** The mangled name the clip says (one of `players.mangled_names`). */
  says: string;
}

export type Roster = 'active' | 'reserve' | 'dead';
export type HumiliationCat = 'bandage' | 'lost_bit' | 'disguise' | 'epithet' | 'fear';

export interface CaptainState {
  id: CaptainId;
  roster: Roster;
  power: number;
  infamy: number;
  traits: [string, string];
  fears: { fear: string; added: boolean; since: Iso }[];
  epithet: BankKey | null;
  aliasIdx: 0 | 1 | null;
  returnsAt: Iso | null;
  graceUntil: Iso | null;
  death: { cause: Cause; causeTag: string } | null;
  legendaryFact: FactNo | null;
}
export interface GrudgeTag {
  no: RowNo;
  holder: CaptainId;
  toward: CaptainId;
  tag: string;
  at: Iso;
  /** null only for old history seeded at casting: it predates the log, so no Fact caused it. */
  cause: Cause | null;
}
export interface Trophy {
  no: RowNo;
  key: BankKey;
  holder: CaptainId;
  takenFrom: CaptainId;
  origin: Cause;
}
export interface Humiliation {
  no: RowNo;
  captainId: CaptainId;
  cat: HumiliationCat;
  key: BankKey;
  gained: Cause;
  expiresAt: Iso | null;
  ended: boolean;
}
export interface Meddle {
  id: MeddleId;
  playerId: PlayerId;
  intent: RumourIntent | DareIntent;
  status: 'pending' | 'held';
  heldOn: CaptainId | null;
}
export interface Fuse {
  no: RowNo;
  dueAt: Iso;
  meddleId?: MeddleId;
  reaction?: { templateId: TemplateId; cast: Record<string, CaptainId>; parent: Cause };
}

// ---- intents ----
export type IntentEnvelope = { id: string; playerId: PlayerId; at: Iso };
export type Subject = { from: 'trait' | 'fear' | 'trophy'; key: string };
export type RumourIntent = {
  kind: 'rumour';
  source: CaptainId;
  target: CaptainId;
  claim: Claim;
  subject: Subject;
  freeText?: string;
  firstMeddle: boolean;
};
export type DareIntent = {
  kind: 'dare';
  target: CaptainId;
  dareKey: BankKey | 'surprise';
  victim?: CaptainId;
  firstMeddle: boolean;
};
export type Intent = IntentEnvelope &
  (
    | RumourIntent
    | DareIntent
    | { kind: 'back'; captainId: CaptainId; amount: number }
    | { kind: 'withdraw'; captainId: CaptainId }
  );

// ---- Facts (world-readable: never carry Stake amounts, gold or pending Meddles) ----
export interface FactBase {
  no: FactNo;
  at: Iso;
  storyNo: FactNo;
  templateId?: TemplateId;
  variant?: 0 | 1 | 2;
  line: string;
  tier: 'generated' | 'templated' | 'silent';
  cast: CaptainId[];
  causes: FactNo[];
  blame: BlameEntry[];
  infamy: { captainId: CaptainId; amount: number }[];
  comedyWeight?: number;
}
export type Introduction = { captainId: CaptainId; aliasIdx: 0 | 1 | null; epithet: BankKey | null; legendary: boolean };
export type Fact = FactBase &
  (
    | {
        kind: 'rumour';
        meddleId: MeddleId;
        source: CaptainId;
        intended: CaptainId;
        reached: CaptainId;
        outcome: 'works' | 'wrong_orc' | 'garbled';
        claim: Claim;
        garbledTo?: Claim;
        subject: Subject | { from: 'absurd'; key: BankKey };
      }
    | {
        kind: 'dare';
        meddleId: MeddleId;
        dareKey: BankKey;
        target: CaptainId;
        victim?: CaptainId;
        outcome: 'botched' | 'pulled_off' | 'refused';
        playsOnFear: boolean;
      }
    | {
        kind: 'clash';
        a: CaptainId;
        b: CaptainId;
        trigger: 'grudge' | 'forced';
        pA: number;
        edgeA: number;
        edgeB: number;
        outcome: 'won' | 'defeated' | 'fled';
        winner: CaptainId;
        loser: CaptainId;
        saviour?: CaptainId;
        saviourMagnet?: string;
        topTags: string[];
        fallbackKey: BankKey;
      }
    | { kind: 'incident'; trigger: 'ambient' | 'reaction'; roles: Record<string, CaptainId>; outcomeKey: string }
    | { kind: 'unmasked'; captainId: CaptainId; by: 'clash' | 'rumour' }
    | { kind: 'return'; intro: Introduction; graceUntil: Iso }
    | { kind: 'stepped_in'; intro: Introduction; replacing: CaptainId }
    | { kind: 'crowned'; intro: Introduction; previous: CaptainId | null; infamy7d: number }
    | { kind: 'death'; captainId: CaptainId; causeTag: string; returnsAt: Iso }
    | { kind: 'death_averted'; captainId: CaptainId; why: 'grace' | 'daily_cap' }
    | {
        kind: 'humiliation';
        captainId: CaptainId;
        cat: HumiliationCat;
        key: BankKey;
        replaces?: RowNo;
        expiresAt?: Iso;
      }
    | {
        kind: 'humiliation_ended';
        captainId: CaptainId;
        humiliation: RowNo;
        why: 'healed' | 'unmasked' | 'replaced' | 'died';
      }
    | { kind: 'trophy'; trophy: RowNo; key: BankKey; from: CaptainId; to: CaptainId }
    | { kind: 'grudge'; holder: CaptainId; toward: CaptainId; tag: string; delta: number }
    | { kind: 'power'; captainId: CaptainId; from: number; to: number }
    | { kind: 'benched'; captainId: CaptainId }
    | { kind: 'warlord_fell'; captainId: CaptainId; why: 'death' | 'clash_loss' | 'botched_dare' }
    | { kind: 'legendary'; captainId: CaptainId; deed: FactNo }
    | { kind: 'accusation'; accuser: CaptainId; accused: PlayerId; correct: boolean; clipKey: string }
  );
export type FactKind = Fact['kind'];

// ---- diff (typed patches; counters as deltas so concurrent RPCs can't be overwritten) ----
export interface StateDiff {
  world: Partial<Pick<WorldState['world'], 'warlordId' | 'deathsToday' | 'day' | 'nextNo'>>;
  captains: (Pick<CaptainState, 'id'> & Partial<Omit<CaptainState, 'id'>>)[];
  affinity: { holder: CaptainId; toward: CaptainId; value: number }[];
  grudgeTags: GrudgeTag[];
  trophies: { upsert: Trophy[] };
  fears: { captainId: CaptainId; add?: string; remove?: string }[];
  humiliations: { upsert: Humiliation[] };
  meddles: { id: MeddleId; status: 'pending' | 'held' | 'landed'; heldOn?: CaptainId | null; landedFact?: FactNo }[];
  newMeddles: Meddle[];
  fuses: { add: Fuse[]; remove: RowNo[] };
  stakes: { playerId: PlayerId; captainId: CaptainId; amount: number }[];
  ledger: {
    playerId: PlayerId;
    delta: number;
    lost: number;
    reason: string;
    fact?: FactNo;
    captainId?: CaptainId;
  }[];
  playerDeltas: { playerId: PlayerId; meddles?: number; firstMeddleDone?: true }[];
  intents: { id: string; status: 'consumed' | 'rejected'; reason?: string }[];
  /**
   * Templates and Captain pairs this tick's Facts used, for the variety rule (not in data-model §2: the
   * DB rebuilds `recent` from `facts`, so the commit ignores this; applyDiff needs it to step in memory).
   */
  recent: WorldState['recent'];
}

/** A Clash Fact (the story head of a Clash). */
export type ClashFact = Extract<Fact, { kind: 'clash' }>;

export interface SimResult {
  facts: Fact[];
  stateDiff: StateDiff;
}
