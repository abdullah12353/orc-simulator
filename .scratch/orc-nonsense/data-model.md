# Final data model and sim interface

Status: **locked** on [ticket #21](https://github.com/abdullah12353/orc-simulator/issues/21) (2026-10-29). Builds on [GDD §8](./gdd.md) and D1–D62. Vocabulary: [GLOSSARY.md](../../GLOSSARY.md). The numbers are the placeholders from the Answers. Narration runs on Gemma 4 26B (thinking off), with Groq gpt-oss-120b as the fallback ([#13](https://github.com/abdullah12353/orc-simulator/issues/13)).

Shape in one line: **normalised state tables are canonical, the event log is an append-only record of Facts, and `simulate()` is the only writer of world state.**

Conventions: every world-scoped table carries `world_id uuid` (FK `worlds`). `ts` = `timestamptz`. Sim-created rows use per-world `bigint` numbers allocated by the sim (decision 5). Captains, Templates and bank entries are **text slugs** from the content bundle in the repo (decision 6), so they have no FK.

---

## 1. Postgres tables (Supabase)

Enums: `roster` (active, reserve, dead) · `meddle_verb` (rumour, dare) · `meddle_status` (pending, held, landed) · `claim` (insult, fear, theft, mum, coup) · `humiliation_cat` (bandage, lost_bit, disguise, epithet, fear) · `tier` (generated, templated, silent) · `intent_status` (queued, consumed, rejected) · `job_status` (queued, done, fallback).

### 1.1 Worlds, Players, onboarding

| Table | Columns | Keys / notes |
|---|---|---|
| `worlds` | `id uuid`, `name text`, `created_by uuid` (FK players), `seed bigint`, `tick_seq bigint`, `last_tick_at ts`, `next_no bigint` (sim's id counter), `warlord_id text` (null only before casting), `day date` (London date of the last tick), `deaths_today smallint`, `content_version text`, `created_at ts` | PK `id`. The row lock serialises ticks (decision 2). |
| `invites` | `token text` (128-bit random), `world_id`, `created_by uuid`, `created_at ts`, `expires_at ts` (+7 days), `revoked_at ts?` | PK `token`. Reusable until expiry. The 8-Player cap is checked in the `join_world(token)` RPC. |
| `players` | `id uuid`, `world_id`, `user_id uuid` (auth.users), `display_name text`, `mangled_names text[]` (orc pronunciations), `joined_at ts`, `removed_at ts?` | PK `id`, UQ `(world_id, user_id)`. **Public** to world members. |
| `player_private` | `player_id uuid`, `gold int` (0–30 unstaked), `meddles_available smallint` (0–6), `last_seen_at ts`, `first_open_at ts?`, `first_meddle_done bool`, `hints_seen text[]` (dare, backing, stable), `last_edition_no int`, `pushes_today smallint`, `push_day date` | PK/FK `player_id`. **Owner-only** (decision 7). `last_seen_at` drives "watched". |
| `push_subscriptions` | `id uuid`, `player_id`, `endpoint text`, `p256dh text`, `auth text`, `created_at ts` | PK `id`, UQ `endpoint`. Owner-only. Quiet hours are fixed at 23:00–08:00 world time (decision 12). |
| `name_renders` | `player_id`, `accuser_id text` (one of the 6 accuser Captains), `clip_key text` (R2 path), `rendered_at ts` | PK `(player_id, accuser_id)`. A Player can be Accused by an accuser only once the matching row exists (D59). |

### 1.2 Captains and their marks

| Table | Columns | Keys / notes |
|---|---|---|
| `captains` | `world_id`, `id text` (cast slug, e.g. `krug`), `roster roster`, `power smallint` (1–10), `infamy int` (lifetime), `traits text[2]`, `epithet text?`, `alias_idx smallint?` (0/1 while disguised), `died_at ts?`, `returns_at ts?`, `death_fact bigint?`, `death_cause_tag text?` (picks the Return's Humiliation), `grace_until ts?`, `legendary_fact bigint?` (non-null = Legendary; the fact is the Legendary deed) | PK `(world_id, id)`. The static card (name, say-as, voice, accent archetype, catchphrase, aliases, portrait and its face-box overrides, `accuser` flag) lives in the content bundle. Overlay slot order and pinning come from the overlay bank ([#18](https://github.com/abdullah12353/orc-simulator/issues/18)): the newest overlays pick which 3 show, the mouth bandage and active disguise are pinned, and a lost tusk and the Legendary stamp sit outside the limit. **Warlord** is `worlds.warlord_id`, not a roster value. |
| `captain_fears` | `world_id`, `captain_id`, `fear text`, `added bool` (false = starting Fear, never replaced), `since ts`, `cause_fact bigint?` | PK `(world_id, captain_id, fear)`. At most 3 per Captain. A new one replaces the oldest `added`. |
| `humiliations` | `world_id`, `no bigint`, `captain_id`, `cat humiliation_cat`, `kind text` (bank key; sets the overlay, its slot and whether it is pinned or outside the 3-overlay limit, and muffled), `gained_fact bigint`, `gained_at ts`, `expires_at ts?` (bandages ≈ +2 d), `ended_at ts?`, `ended_fact bigint?` (healed, Unmasked, replaced Epithet) | PK `(world_id, no)`. Index `(world_id, captain_id) WHERE ended_at IS NULL`. Ended rows are kept as history (old Epithets, disguises). |
| `trophies` | `world_id`, `no bigint`, `kind text` (bank key), `holder_id text`, `taken_from_id text`, `origin_fact bigint`, `acquired_at ts` | PK `(world_id, no)`. Current holder only; the history is in the log (D15: a tag, not an inventory). |
| `infamy_gains` | `world_id`, `fact_no bigint`, `captain_id`, `amount smallint` | PK `(world_id, fact_no, captain_id)`. Index `(world_id, captain_id, fact_no)`. Timestamps come from `facts.at`. Feeds the 7-day window and payouts. |

### 1.3 Grudges

| Table | Columns | Keys / notes |
|---|---|---|
| `affinity` | `world_id`, `holder_id text`, `toward_id text`, `value smallint` (−100..+100), `updated_at ts` | PK `(world_id, holder_id, toward_id)`. **Directed** (decision 11). Rows at 0 are deleted. Drifts back to 0 by about 5 a day, applied by the sim. |
| `grudge_tags` | `world_id`, `no bigint`, `holder_id`, `toward_id`, `tag text`, `cause_fact bigint`, `created_at ts` | PK `(world_id, no)`. Index `(world_id, holder_id, toward_id, no DESC)`. Permanent. Narration gets the 3 most recent. |

### 1.4 Meddles, Backing, gold

| Table | Columns | Keys / notes |
|---|---|---|
| `intents` | `id uuid` (client-generated, idempotent), `world_id`, `player_id`, `kind text` (rumour, dare, back, withdraw), `payload jsonb` (the `Intent` minus its envelope), `created_at ts`, `status intent_status`, `consumed_tick bigint?`, `reject_reason text?` | PK `id`. Index `(world_id, created_at) WHERE status='queued'`. Inserted only through the `submit_intent` RPC (decision 4). |
| `meddles` | `id uuid` (= intent id), `world_id`, `player_id`, `verb meddle_verb`, `target_id text`, `source_id text?` (Rumour), `victim_id text?` (Prank dare), `claim claim?`, `subject jsonb?`, `free_text text?`, `dare_key text?`, `created_at ts`, `status meddle_status`, `held_on text?`, `landed_fact bigint?` | PK `id`. **Secret** until `landed_fact` is set (decision 7). `held` means the target is dead, waiting for his Return. |
| `fuses` | `world_id`, `no bigint`, `due_at ts`, `kind text` (meddle, reaction), `meddle_id uuid?`, `template_id text?`, `cast jsonb?` (role → Captain), `parent_fact bigint?`, `created_tick bigint` | PK `(world_id, no)`. Index `(world_id, due_at, no)`. **The fuse queue**: Meddle fuses (10–90 min, 2–5 for the guided first one) and chain follow-ups past depth 3 (5–30 min). Service role only. |
| `stakes` | `world_id`, `player_id`, `captain_id text`, `amount int` (≥1), `created_at ts`, `updated_at ts` | PK `(player_id, captain_id)`. Held through death; "held" is derived from `captains.roster='dead'`. Amount is owner-only; who backs whom is public through the `backers` view. |
| `gold_ledger` | `id bigint identity`, `world_id`, `player_id`, `delta int`, `lost int` (overflow over 30), `reason text` (stipend, stake, top_up, withdraw, payout_win, payout_infamy), `fact_no bigint?`, `captain_id text?`, `at ts` | PK `id`. Index `(player_id, at)`. Owner-only. It is the source of "+8 gold: Krúg drowned in 30cm of moat". `player_private.gold` is its running total. |

### 1.5 The event log, Blame, narration

| Table | Columns | Keys / notes |
|---|---|---|
| `ticks` | `world_id`, `seq bigint`, `at ts`, `seed bigint`, `watched bool`, `content_version text`, `intent_ids uuid[]`, `fact_count smallint`, `cpu_ms int`, `state_hash text` | PK `(world_id, seq)`. For debugging determinism and replay. |
| `facts` | `world_id`, `no bigint`, `tick_seq bigint`, `at ts`, `kind text`, `story_no bigint` (= `no` for a story head), `template_id text?`, `variant smallint?`, `line text` (rendered template line; '' if silent), `tier tier`, `cast text[]`, `comedy_weight smallint?` (heads only), `payload jsonb` (the full `Fact`) | PK `(world_id, no)`. **Append-only** (no UPDATE or DELETE grant). Indexes: `(world_id, at DESC)`; GIN `cast`; `(world_id, at DESC) WHERE comedy_weight >= 20` (the Hall of Shame's moments index); `(world_id, template_id, at)`. |
| `fact_causes` | `world_id`, `fact_no`, `cause_no` | PK `(world_id, fact_no, cause_no)`. The causal DAG edges. |
| `fact_blame` | `world_id`, `fact_no`, `meddle_id uuid`, `player_id uuid`, `hops smallint` | PK `(world_id, fact_no, meddle_id)`. Index `(player_id, fact_no)`. The transitive Blame set, materialised at write time (decision 9). |
| `clash_dialogue` | `world_id`, `fact_no`, `lines jsonb` (`[{speaker, text}]`, 3, or 4 with a wrong saviour), `source text` (generated, fallback), `fallback_key text`, `provider text?`, `model text?`, `updated_at ts` | PK `(world_id, fact_no)`. Written **with the fallback script in the tick's own transaction**, then upgraded once by the job. Replays read this table and never call a model. |
| `narration_jobs` | `id bigint identity`, `world_id`, `kind text` (clash, herald), `fact_no bigint?`, `edition_id uuid?`, `status job_status`, `provider text?`, `failure text?` (refusal, timeout, bad_output, quota), `excerpt text?`, `neurons int?`, `tokens int?`, `created_at ts`, `finished_at ts?` | PK `id`. The outbox, and also **the failure log** (rows where `status='fallback'`). No retries. |
| `llm_usage` | `day date` (UTC, the provider's reset), `provider text`, `neurons int`, `requests int`, `tokens int` | PK `(day, provider)`. **The Neuron counter.** Bumped by an atomic `UPDATE … RETURNING`. Clash calls switch to Groq at about 9k Neurons. Global, because it's per account and not per world. |
| `push_jobs` | `id bigint identity`, `player_id`, `fact_no bigint`, `text text`, `status text` (queued, sent, dropped_cap, dropped_quiet), `created_at ts` | PK `id`. The push outbox, also an audit trail for the 3-a-day cap. |

### 1.6 The Herald and the Hall of Shame

| Table | Columns | Keys / notes |
|---|---|---|
| `editions` | `id uuid`, `world_id`, `player_id`, `no int` (per Player), `covers_from ts`, `covers_to ts`, `created_at ts`, `masthead jsonb` (orc date, price gag, weather), `accusation_fact bigint?`, `stable jsonb` (frozen "Your Stable"), `status text` (templated, generated) | PK `id`, UQ `(player_id, no)`. Owner-only. Kept forever; the UI shows the last 7 (decision 14). |
| `edition_stories` | `edition_id`, `rank smallint`, `story_no bigint`, `slot text` (lead, headline, gutter), `headline text`, `standfirst text?`, `body text?`, `blame_line text?` | PK `(edition_id, rank)`. `headline` starts as the template line, and the Herald job overwrites it. Blame lines are always templated (D53). |
| `clippings` | `id uuid`, `world_id`, `player_id`, `story_no bigint`, `edition_id uuid?`, `snapshot jsonb` (headline, pull quote, Blame line, both portraits with their overlays *at that moment*, Trophy), `created_at ts` | PK `id`. Index `(world_id, created_at DESC)`. World-readable. A snapshot, because portraits change later. |

Views (`security_invoker = false`, filtered to the caller's world): `backers` (player_id, captain_id; no amount), `hall_legends`, `hall_moments`, `rap_sheets`, `captain_story` (§4).

---

## 2. The `simulate()` interface

```ts
// ---- ids & primitives ----
type PlayerId = string;  type MeddleId = string;  // uuids
type CaptainId = string; type TemplateId = string; type BankKey = string; // content slugs
type FactNo = number;    type RowNo = number;     // per-world bigint, allocated from state.world.nextNo
type Iso = string;       // the sim never reads the wall clock; time comes in via state.world.now

export function simulate(state: WorldState, intents: Intent[], seed: number): SimResult;
export function applyDiff(state: WorldState, diff: StateDiff): WorldState;  // pure; day zero + tests
export function castWorld(content: Content, seed: number, now: Iso, players: PlayerId[]): WorldState; // D57
export interface SimResult { facts: Fact[]; stateDiff: StateDiff }

// ---- causality: how Blame is carried ----
export interface BlameEntry { meddleId: MeddleId; playerId: PlayerId; verb: 'rumour' | 'dare';
  landedFact: FactNo; landedAt: Iso; hops: number }   // hops from the Meddle landing to this Fact
export interface Cause { fact: FactNo; blame: BlameEntry[] } // stored on any state that can cause later events
// Rule: fact.causes = the Facts whose state this Fact's Template *required* (parent reaction, the Grudge tags
// that put the pair below −50, his death for a Return, the Warlord's fall for a succession, a held Meddle).
// fact.blame = dedupe(union of every cause's blame, with hops + 1) ∪ this Fact's own Meddle (hops 0), and
// entries past the hop cap are dropped (decision 8). Callbacks add comedy weight but are NOT causes.

// ---- input state (loaded by the tick; small: ~30 Captains, <1k affinity rows) ----
export interface WorldState {
  world: { id: string; tickSeq: number; now: Iso; prevTickAt: Iso; watched: boolean; day: string;
           deathsToday: number; warlordId: CaptainId | null; nextNo: number; contentVersion: string };
  content: Content;                                    // Templates + banks + static cards (decision 6)
  captains: Record<CaptainId, CaptainState>;
  affinity: Record<`${CaptainId}>${CaptainId}`, number>; // holder>toward
  grudgeTags: GrudgeTag[];                             // last 3 per pair + any newer than the Blame window
  trophies: Trophy[]; humiliations: Humiliation[];     // current only
  stakes: { playerId: PlayerId; captainId: CaptainId; amount: number }[];
  players: Record<PlayerId, { gold: number; meddles: number; firstMeddleDone: boolean; renderedFor: CaptainId[] }>;
  meddles: Record<MeddleId, Meddle>;                   // pending + held only
  fuses: Fuse[];                                       // due_at <= now, in (dueAt, no) order
  infamy7d: { captainId: CaptainId; fact: FactNo; at: Iso; amount: number }[];
  recent: { templates: Record<TemplateId, Iso>; pairs: Record<string, Iso> }; // 24 h / 1 h variety halving
}
export interface CaptainState { id: CaptainId; roster: 'active' | 'reserve' | 'dead'; power: number; infamy: number;
  traits: [string, string]; fears: { fear: string; added: boolean; since: Iso }[]; epithet: BankKey | null;
  aliasIdx: 0 | 1 | null; returnsAt: Iso | null; graceUntil: Iso | null;
  death: { cause: Cause; causeTag: string } | null; legendaryFact: FactNo | null }
export interface GrudgeTag { no: RowNo; holder: CaptainId; toward: CaptainId; tag: string; at: Iso; cause: Cause }
export interface Trophy { no: RowNo; key: BankKey; holder: CaptainId; takenFrom: CaptainId; origin: Cause }
export interface Humiliation { no: RowNo; captainId: CaptainId; cat: 'bandage' | 'lost_bit' | 'disguise' | 'epithet' | 'fear';
  key: BankKey; gained: Cause; expiresAt: Iso | null; ended: boolean }
export type Content = { cast: CastCard[]; templates: TemplateDef[]; banks: Banks }; // inner shapes follow D46; written at implementation
export interface Meddle { id: MeddleId; playerId: PlayerId; intent: RumourIntent | DareIntent;
  status: 'pending' | 'held'; heldOn: CaptainId | null }
export interface Fuse { no: RowNo; dueAt: Iso; meddleId?: MeddleId;
  reaction?: { templateId: TemplateId; cast: Record<string, CaptainId>; parent: Cause } }

// ---- intents (Players' only input; resources already debited by submit_intent) ----
type IntentEnvelope = { id: string; playerId: PlayerId; at: Iso };
export type Claim = 'insult' | 'fear' | 'theft' | 'mum' | 'coup';
export type Subject = { from: 'trait' | 'fear' | 'trophy'; key: string };  // absurd subjects come only from Garbles
export type RumourIntent = { kind: 'rumour'; source: CaptainId; target: CaptainId; claim: Claim;
  subject: Subject; freeText?: string; firstMeddle: boolean };            // firstMeddle → 2–5 min fuse
export type DareIntent = { kind: 'dare'; target: CaptainId; dareKey: BankKey | 'surprise';
  victim?: CaptainId; firstMeddle: boolean };                              // victim set ⇔ Prank dare
export type Intent = IntentEnvelope & (RumourIntent | DareIntent
  | { kind: 'back'; captainId: CaptainId; amount: number }                // new Stake or top-up
  | { kind: 'withdraw'; captainId: CaptainId });                          // half back, rounded down

// ---- Facts (world-readable: never carry Stake amounts, gold or pending Meddles) ----
interface FactBase { no: FactNo; at: Iso; storyNo: FactNo; // = no for a story head; consequences point at the head
  templateId?: TemplateId; variant?: 0 | 1 | 2; line: string; tier: 'generated' | 'templated' | 'silent';
  cast: CaptainId[]; causes: FactNo[]; blame: BlameEntry[];
  infamy: { captainId: CaptainId; amount: number }[]; comedyWeight?: number } // heads only (D50)
type Introduction = { captainId: CaptainId; aliasIdx: 0 | 1 | null; epithet: BankKey | null; legendary: boolean };
export type Fact = FactBase & (
  // story heads
  | { kind: 'rumour'; meddleId: MeddleId; source: CaptainId; intended: CaptainId; reached: CaptainId;
      outcome: 'works' | 'wrong_orc' | 'garbled'; claim: Claim; garbledTo?: Claim; subject: Subject | { from: 'absurd'; key: BankKey } }
  | { kind: 'dare'; meddleId: MeddleId; dareKey: BankKey; target: CaptainId; victim?: CaptainId;
      outcome: 'botched' | 'pulled_off' | 'refused'; playsOnFear: boolean }
  | { kind: 'clash'; a: CaptainId; b: CaptainId; trigger: 'grudge' | 'forced'; pA: number; edgeA: number; edgeB: number;
      outcome: 'won' | 'defeated' | 'fled'; winner: CaptainId; loser: CaptainId; saviour?: CaptainId;
      saviourMagnet?: string; topTags: string[]; fallbackKey: BankKey }
  | { kind: 'incident'; trigger: 'ambient' | 'reaction'; roles: Record<string, CaptainId>; outcomeKey: string }
  | { kind: 'unmasked'; captainId: CaptainId; by: 'clash' | 'rumour' }
  | { kind: 'return'; intro: Introduction; graceUntil: Iso }
  | { kind: 'stepped_in'; intro: Introduction; replacing: CaptainId }
  | { kind: 'crowned'; intro: Introduction; previous: CaptainId | null; infamy7d: number }
  // consequences (storyNo = their head)
  | { kind: 'death'; captainId: CaptainId; causeTag: string; returnsAt: Iso }
  | { kind: 'death_averted'; captainId: CaptainId; why: 'grace' | 'daily_cap' }      // followed by a humiliation
  | { kind: 'humiliation'; captainId: CaptainId; cat: 'bandage' | 'lost_bit' | 'disguise' | 'epithet' | 'fear';
      key: BankKey; replaces?: RowNo; expiresAt?: Iso }
  | { kind: 'humiliation_ended'; captainId: CaptainId; humiliation: RowNo; why: 'healed' | 'unmasked' | 'replaced' | 'died' }
  | { kind: 'trophy'; trophy: RowNo; key: BankKey; from: CaptainId; to: CaptainId }
  | { kind: 'grudge'; holder: CaptainId; toward: CaptainId; tag: string; delta: number }
  | { kind: 'power'; captainId: CaptainId; from: number; to: number }
  | { kind: 'benched'; captainId: CaptainId }
  | { kind: 'warlord_fell'; captainId: CaptainId; why: 'death' | 'clash_loss' | 'botched_dare' }
  | { kind: 'legendary'; captainId: CaptainId; deed: FactNo }                       // deed = the head that crossed 150
  | { kind: 'accusation'; accuser: CaptainId; accused: PlayerId; correct: boolean; clipKey: string } );

// ---- diff (typed patches; counters as deltas so concurrent RPCs can't be overwritten) ----
export interface StateDiff {
  world: Partial<Pick<WorldState['world'], 'warlordId' | 'deathsToday' | 'day' | 'nextNo'>>;
  captains: (Pick<CaptainState, 'id'> & Partial<Omit<CaptainState, 'id'>>)[];
  affinity: { holder: CaptainId; toward: CaptainId; value: number }[];   // absolute; 0 = delete
  grudgeTags: GrudgeTag[]; trophies: { upsert: Trophy[] };
  fears: { captainId: CaptainId; add?: string; remove?: string }[];
  humiliations: { upsert: Humiliation[] };
  meddles: { id: MeddleId; status: 'pending' | 'held' | 'landed'; heldOn?: CaptainId | null; landedFact?: FactNo }[];
  newMeddles: Meddle[]; fuses: { add: Fuse[]; remove: RowNo[] };
  stakes: { playerId: PlayerId; captainId: CaptainId; amount: number }[]; // 0 = delete
  ledger: { playerId: PlayerId; delta: number; lost: number; reason: string; fact?: FactNo; captainId?: CaptainId }[];
  playerDeltas: { playerId: PlayerId; meddles?: number; firstMeddleDone?: true }[];
  intents: { id: string; status: 'consumed' | 'rejected'; reason?: string }[];
}
```

Determinism: the sim walks Captains in slug order and fuses in `(dueAt, no)` order. It uses one seeded PRNG (sfc32) stream with `seed = hash(worlds.seed, tick_seq)`, and never uses `Date`, `Math.random` or `crypto`. Comedy weight, ledger entries and Blame are all computed inside the sim, so the tests cover them.

---

## 3. How the tick Edge Function uses it

1. **Clock.** The Cloudflare Worker cron POSTs to `/functions/v1/tick` every minute with a shared secret (D39). That's all it does.
2. **Lock and cadence.** The function opens **one Postgres transaction** over postgres.js through the Supavisor pooler (decision 3) and runs `SELECT … FROM worlds WHERE id=$1 FOR UPDATE NOWAIT`. If the row is locked, another tick is running, so it exits. `watched = max(player_private.last_seen_at) > now − 5 min`. If it isn't watched and `now − last_tick_at < 5 min`, it commits empty and exits. The call still counts as activity for the pause rule.
3. **Load state.** It loads everything in parallel inside the same transaction: captains, fears and active humiliations; non-zero affinity; grudge tags (last 3 per pair plus those inside the Blame window, each with its `Cause`, meaning the cause fact and its `fact_blame` rows); trophies; stakes; `player_private … FOR UPDATE` (this blocks `submit_intent` until the commit); pending and held meddles; **fuses with `due_at <= now`**; `infamy_gains` joined to `facts.at` for the last 7 days; and template and pair recency from `facts` over the last 24 h. Then it builds `WorldState` with `now` and `watched`.
4. **Consume intents.** `SELECT … FROM intents WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED`. Gold and Meddle allowance were already debited by `submit_intent`. The sim turns Rumours and Dares into `newMeddles` and `fuses.add` (10–90 min, or 2–5 for `firstMeddle`). It applies `back` and `withdraw` to `stakes` and `ledger`. Invalid intents (target removed, Stake gone) come back as `rejected`, and the commit refunds them.
5. **Simulate.** `seed = hash(world.seed, tick_seq + 1)`, then `simulate(state, intents, seed)`. Inside one call the sim:
   - rolls the day if needed: Stipend +10 and Meddles +3 per Player, capped (30 / 6), with overflow logged as `lost`; resets `deathsToday`; and drifts affinity;
   - processes due **Returns** (the Humiliation picked from `death.causeTag`, grace for 1 h, benching, and every held Meddle re-fused for 10–90 min) and expired bandages;
   - fires **due fuses in order**. A Meddle whose target is dead becomes `held`, and that change is **diff only, never a Fact**;
   - rolls ambient events (1 in 3 watched, 1 in 10 unwatched) and Grudge Clashes (about 5% per pair below −50);
   - runs reactions up to **3 deep**, and the next one goes onto a 5–30 min fuse;
   - enforces the **death counter**: at `deathsToday = 3`, or during grace, a death becomes `death_averted` plus a `humiliation`;
   - pays out (10% a win, 1% per Infamy point, rounded up, capped), checks for Legendary, Warlord falls and succession, and Accusations.
6. **Commit (same transaction).** It inserts `facts`, `fact_causes`, `fact_blame` and `infamy_gains`. It applies the diff tables, using `gold = least(30, gold + δ)` style deltas. It inserts `clash_dialogue` with the fallback script for every Clash. It writes the **outbox** rows: one `narration_jobs` row per Clash, plus `push_jobs`. Pushes are picked by the commit layer, not the sim: deaths, Returns, Warlord changes and Legendary deeds touching your Stable, and your Meddles' heads with weight ≥ 15. It skips any Player already at 3 today or inside quiet hours (logged as dropped). It marks intents consumed, sets `worlds.tick_seq += 1, last_tick_at = now, next_no`, inserts the `ticks` row and runs `COMMIT`. **Any error rolls everything back.** The next call retries with the same `tick_seq`, so it gets the same seed and the same result.
7. **After commit, out of band.** If `facts.length > 0 && watched`, it sends **one Realtime broadcast** `{tick_seq}` on the private channel `world:<id>`, and clients refetch. Then `EdgeRuntime.waitUntil(drainJobs())`:
   - for each queued Clash job, it reserves quota in `llm_usage` (Workers AI under about 9k Neurons, else Groq under its cap minus a Herald reserve, else straight to `fallback`), makes **one** call with no retry, validates (3 lines, or 4 with a saviour), and upgrades `clash_dialogue` or records the failure;
   - it sends queued pushes over VAPID;
   - it sends one more broadcast `{dialogue: fact_no}` if watched, so a live Clash that was waiting for its dialogue can swap it in.
8. **Missed ticks.** There's one simulation step per call. After an outage, every overdue fuse, Return and expiry fires in due order on the next tick, but ambient rolls are **not** back-filled (decision 15).
9. **Day zero.** `create_world` calls `castWorld()` (Krúg plus 2 per accent archetype, the highest Power as Warlord, about 6 seeded Grudges from the old-history bank). Then it loops `simulate` → `applyDiff` in memory for about 288 unwatched 5-minute steps, with `now` running from `created_at − 24 h`, and commits everything once, along with about 25 events' worth of Clash jobs. Edition #1 then covers that day.
10. **Herald on open.** This is a separate `open-edition` function (§4.1). It calls a model at most once, waits up to about 8 s, and otherwise returns the templated edition and finishes the job in the background.

---

## 4. How derived views are computed

### 4.1 Herald ranking (per Player, on open)
- **Window:** `(last edition's covers_to, now]`. A brand-new Player's window is day zero; a late joiner's is the last 24 h. Candidates are story heads (`no = story_no`) with `tier <> 'silent'`.
- **New edition or Stop press:** a new edition is due if there are ≥ 3 candidates, or ≥ 1 and ≥ 30 min since the last edition. Otherwise the client gets the last edition plus a **Stop press** built from the new candidates' `line`s, with no model call.
- **Order:** sort by `(kind='legendary' deed first, comedy_weight DESC, at DESC, no)`. Rank 1 is the **lead**, ranks 2–8 are headlines, and ranks 9–28 go into **"Also in the gutter"** as `line`. Anything past that falls through to the Hall of Shame.
- **Blame line per story:** if `fact_blame` has rows, the earliest `landedAt` is "It all began when…" and the latest is "…finished the job". Anyone in between is named in order, and your own name is highlighted on the client.
- **Accusation:** the highest-weight `accusation` Fact whose `story_no` is in the edition, only if its accused Player has a `name_renders` row for that accuser. It sits above the true Blame line.
- **"Your Stable":** your `gold_ledger` rows in the window, your Stakes (held if the Captain is dead), your Meddles (landed in the window, and the pending count), and your current gold and Meddles. Frozen into `editions.stable`.

### 4.2 Rap sheets (`rap_sheets` view)
`SELECT DISTINCT ON (f.no) …` over `fact_blame b JOIN facts f` where `b.player_id = $1` and `f.no = f.story_no`. Take the **top 10 by `comedy_weight`**, then **re-sort by `at`** for display. The caption is the story's latest `edition_stories.headline` if there is one, otherwise `facts.line`. Anyone can read it, and there's no endpoint that returns two Players' rap sheets together.

### 4.3 Hall of Shame shelves
- **Legends:** `captains WHERE legendary_fact IS NOT NULL`, joined to its fact (the Legendary deed).
- **Infamous moments:** heads with `comedy_weight >= 20` (partial index), newest first.
- **Clippings:** `clippings` newest first.
- **By Captain** (`captain_story`): facts where `cast @> {id}` and the kind is death, return, humiliation (including Epithets), trophy or legendary. **Timeline:** the three shelves merged by `at DESC`. Never sorted by anything else. Replays read `clash_dialogue`.

### 4.4 The 7-day Infamy window
`SUM(g.amount) FROM infamy_gains g JOIN facts f USING (world_id, fact_no) WHERE f.at > now − 7 days GROUP BY captain_id`. The sim gets the rows in `infamy7d` and adds the current tick's gains in memory.
- **Succession:** among living `active` Captains, the highest 7-day Infamy wins, then Power, then lifetime Infamy, then slug (decision 16).
- **Benching:** among active Captains other than Krúg (and other than the Warlord, see decision 16), the lowest 7-day Infamy is benched.

### 4.5 Blame chains
- **Who** is to blame: always `fact_blame` for that fact, with one indexed lookup and no recursion.
- **The story of how** ("Rumour → Grudge → Clash → death → Return → coup", for a "trace it back" body or a Hall replay): a recursive CTE up `fact_causes` from the fact. It's bounded by the hop cap, and each step is rendered from `facts.line`.

---

## 5. Decisions

All locked with Mohammed on 2026-10-29 in two grilling rounds. Each one took the recommended option, now marked **Decided**.

1. **Source of truth.** (a) Normalised state tables are canonical, and the log is an append-only record written in the same transaction. (b) Pure event sourcing, where state = fold(Facts), with snapshots. (c) One `world_state jsonb` blob plus the log. **Decided: (a).** Clients read tables directly under RLS, and derived views are plain SQL. (b) means every content change risks breaking a re-fold. (c) loads fastest, but it would leak private fields unless it's split again.
2. **State versioning and concurrency.** (a) `worlds.tick_seq` plus `FOR UPDATE NOWAIT` on the world row, with RPCs blocked by the `player_private` row locks. (b) Optimistic `UPDATE … WHERE tick_seq = $loaded`, aborting on conflict. (c) `pg_advisory_xact_lock`. **Decided: (a).** It's the simplest correct option, and a retry is deterministic because the seed is derived from `tick_seq`.
3. **How the Edge Function writes atomically.** (a) A direct postgres.js connection through Supavisor (transaction mode, `prepare: false`), with the commit written in TS. (b) PostgREST plus one `commit_tick(diff jsonb)` plpgsql function. **Decided: (a).** The diff applier stays in TypeScript next to the types. (b) is the fallback if the Edge runtime's Postgres driver misbehaves.
4. **Who checks Player resources.** (a) The `submit_intent` RPC checks and debits gold and Meddles at once, and the sim refunds rejects. (b) The sim validates everything at consumption, and the UI optimistically shows pending debits. **Decided: (a)**, for instant "2 Meddles left" feedback and no overspending between ticks. *This bends GDD §8.1* ("canonical state changes only inside `simulate()`"). Lock the wording as "**world** state changes only inside `simulate()`; Player ledgers are debited at submit".
5. **IDs.** (a) Per-world `bigint` numbers allocated by the sim from `nextNo` for anything the sim creates, uuids for anything a user creates (players, intents/meddles, editions, clippings), and text slugs for content. (b) uuidv7 everywhere, generated from the seeded RNG. (c) DB identity columns, with temporary references mapped at commit. **Decided: (a).** It's deterministic, time-ordered, compact in URLs ("/hall/412"), and needs no mapping step.
6. **How Templates and banks ship.** (a) TS/JSON modules in the repo (`content/`), bundled into both the Edge Function and the PWA, with a hash recorded as `content_version` on every tick. (b) SQL seed tables. (c) The repo is the source, synced into tables by a migration. **Decided: (a).** Mohammed's strike pass is a PR diff, the sim stays pure and testable, and nothing is needed at runtime. Facts store `template_id`, `variant` and the rendered `line`, so old events survive edits. The cost is no FKs from state to content, so CI checks that every slug the DB uses still exists.
7. **RLS for private data.** (a) Split public and private tables (`players` / `player_private`), keep owner-only policies on gold, ledger, Stakes, editions and pushes, add a `backers` view without amounts, and allow Meddles to be read by `player_id = me OR landed_fact IS NOT NULL`. `fuses` and `narration_jobs` are service-only. (b) Column-level grants on shared tables. (c) All reads go through RPCs. **Decided: (a).** It's the easiest to audit. The Facts rule enforces the rest: no Fact carries an amount or a pending or held Meddle.
8. **Blame propagation rules.** The docs say "the whole chain" but never define what counts as a link. Proposed:
   - (a) Causes are only the state a Template **required**, not bonus callbacks.
   - (b) For an aggregate like affinity, the causes are that pair's Grudge tags from the last 7 days, at most 3.
   - (c) A **hop cap of 6**. The GDD's worked chain is 5 hops.

   The alternatives are unbounded propagation, or a time limit instead of hops. **Decided: (a)+(b)+(c).** Unbounded propagation eventually blames whoever started the first Grudge for everything Krúg ever does.
9. **Blame storage.** (a) Materialise `fact_blame` at write time (the sim already holds its parents' sets). (b) Compute it at read time with a recursive CTE over `fact_causes`. **Decided: (a).** Rap sheets, Blame lines and push targeting all become indexed lookups. The edges are kept anyway for "trace it back".
10. **Fact granularity.** (a) Granular Facts, where each consequence points at its story head (`story_no`), and comedy weight sits on heads only. (b) One fat Fact per story with nested effects. **Decided: (a).** Payouts, Infamy gains and Captain timelines key off individual consequences, and the Herald still ranks one row per story. Return, `stepped_in` and `crowned` are heads, because each plays an Introduction.
11. **Is affinity directed?** (a) Directed per ordered pair, as in the GDD worked example ("Snarlbottom → Krúg −60"); a Clash is possible when either direction is below −50. (b) Symmetric per pair, as [Event catalogue v1](https://github.com/abdullah12353/orc-simulator/issues/15) words it. **Decided: (a).** One-sided Grudges are funnier (Krúg doesn't know he's hated), and it's at most 870 rows.
12. **Day boundary and time zone.** The death cap, Stipend, Meddle allowance, push count and quiet hours all need a "day". (a) A world time zone (`Europe/London`), with the day rolling at 00:00. (b) UTC. (c) Per-Player time zones. **Decided: (a)**, with LLM quotas still keyed on UTC because that's when the providers reset. Also lock this: allowances accrue at the world's day rollover, not on a rolling 24 h per Player.
13. **Where narration runs.** (a) `EdgeRuntime.waitUntil` in the tick function, calling Workers AI over its REST API and Groq over HTTP. (b) A separate `narrate` function that the Worker invokes after each tick. (c) The Worker, using its AI binding. **Decided: (a)**, which keeps the Worker as only the clock (D39). Neurons are counted from the returned token usage × a per-model rate table kept in code. The bake-off ([#13](https://github.com/abdullah12353/orc-simulator/issues/13)) measured ~26 Neurons per Gemma Clash (an estimate; read the real rate off the Cloudflare dashboard on the first build). A format failure from Gemma retries once on Groq.
14. **Edition retention.** (a) Keep every edition and show the last 7. (b) Prune past 7 with a cron job. **Decided: (a).** It's only kilobytes, and the rap sheet and Hall reuse generated headlines as captions. Clippings snapshot either way.
15. **Catching up after downtime.** (a) One step per call; overdue fuses, Returns and expiries fire, and ambient rolls are not back-filled. (b) Replay every missed slot. **Decided: (a).** A Supabase pause shouldn't dump 300 events into one edition, and the Meddles still land.
16. **Tie-breaks and protections the docs don't cover.**
    - Succession after Power: lifetime Infamy, then slug. **Decided: this**, since it's deterministic.
    - Can the reigning Warlord be Benched? **Decided: no**.
    - Does a withdrawal refund over the 30 cap get lost like a payout does? **Decided: yes**, for consistency.
    - Is a Rumour held when its *source* is dead? **Decided: no**: only a dead *target* holds a Meddle.
17. **Glossary gaps.** "Fact", "Intent", "Tick" and "Fuse" are used everywhere but aren't defined. Also, **Clipping** is defined as "after a Clash", but D54 says any story can be clipped. **Decided:** the four terms are added and Clipping is widened.
