// open-edition (data-model §4.1): a Player's own "Since You Left" edition of The Gutter Herald, built on
// open. It works out the window, decides between a new edition and a Stop press, ranks the story heads
// and fills the lead, the headlines and the gutter. This is the templated edition: headlines are the
// Facts' template lines, and each Meddle-caused story carries its templated Blame line (#29). At most
// one Accusation (#39) runs as a pull quote over its story's true Blame line. "Your Stable" and the
// model call come later.
import { blameLine, content as shippedContent, hashString, type BlameName, type Content } from '@orc/content';
import { DAY_ZERO, londonDate } from '@orc/sim';
import { jsonb, type Sql, type Tx } from './db.ts';

/** Edition rules (D51, data-model §4.1). */
export const HERALD = {
  /** A new edition is due at this many new stories… */
  dueAtStories: 3,
  /** …or at 1 or more once this long has passed since the last edition. */
  dueAfterMinutes: 30,
  /** Ranks 2..8 are headlines; 9..28 go in "Also in the gutter"; the rest fall through to the Hall. */
  lastHeadlineRank: 8,
  lastRank: 28,
} as const;

export type Slot = 'lead' | 'headline' | 'gutter';

export interface Masthead {
  orcDate: string;
  price: string;
  weather: string;
}

export interface EditionStory {
  rank: number;
  storyNo: number;
  slot: Slot;
  headline: string;
  standfirst: string | null;
  body: string | null;
  blameLine: string | null;
}

/**
 * The edition's one Accusation (D53): an accuser's pull quote, printed above the true Blame line of the
 * story it belongs to, playing his clip of the accused's mangled name.
 */
export interface EditionAccusation {
  factNo: number;
  storyNo: number;
  accuser: string;
  /** The accuser's words, with the mangled name in them. */
  line: string;
  /** The name clip in storage (the current render). */
  clipKey: string;
}

export interface Edition {
  id: string;
  no: number;
  coversFrom: string;
  coversTo: string;
  createdAt: string;
  masthead: Masthead;
  status: 'templated' | 'generated';
  stories: EditionStory[];
  accusation: EditionAccusation | null;
}

export interface StopPressLine {
  storyNo: number;
  at: string;
  line: string;
}

export interface OpenEditionResult {
  /** The new edition, or the last one if no new edition is due. */
  edition: Edition;
  created: boolean;
  /** The reader's display name, so the client can highlight it in Blame lines. */
  reader: string;
  /** New stories since the last edition, as lines, when no new edition is due (else empty). */
  stopPress: StopPressLine[];
}

export interface OpenEditionDeps {
  sql: Sql;
  now: () => Date;
  content?: Content;
}

/** A refusal with a machine-readable reason as its message (`not_a_player`). */
export class OpenEditionError extends Error {}

interface Candidate {
  no: number;
  at: string;
  line: string;
  weight: number;
  legendaryDeed: boolean;
}

/** §4.1 order: the Legendary deed first, then comedy weight DESC, then `at` DESC, then `no`. */
function byHeraldOrder(a: Candidate, b: Candidate): number {
  return (
    Number(b.legendaryDeed) - Number(a.legendaryDeed) ||
    b.weight - a.weight ||
    Date.parse(b.at) - Date.parse(a.at) ||
    a.no - b.no
  );
}

function slotFor(rank: number): Slot {
  return rank === 1 ? 'lead' : rank <= HERALD.lastHeadlineRank ? 'headline' : 'gutter';
}

const iso = (v: string | Date) => new Date(v).toISOString();

export async function openEdition(
  deps: OpenEditionDeps,
  input: { userId: string; worldId: string },
): Promise<OpenEditionResult> {
  const content = deps.content ?? shippedContent;
  return deps.sql.begin(async (tx) => {
    const [player] = await tx<{ id: string; display_name: string; world_created_at: string }[]>`
      select p.id, p.display_name, to_json(w.created_at)#>>'{}' as world_created_at
      from players p join worlds w on w.id = p.world_id
      where p.world_id = ${input.worldId} and p.user_id = ${input.userId} and p.removed_at is null`;
    if (!player) throw new OpenEditionError('not_a_player');

    // One open at a time per Player, so two tabs can't both build edition #n.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`edition:${player.id}`}, 0))`;

    const now = iso(deps.now());
    const [last] = await tx<{ id: string; no: number; covers_to: string; created_at: string }[]>`
      select id, no, to_json(covers_to)#>>'{}' as covers_to, to_json(created_at)#>>'{}' as created_at
      from editions where player_id = ${player.id} order by no desc limit 1`;
    // A brand-new Player's window is day zero (D57).
    const from = last
      ? iso(last.covers_to)
      : iso(new Date(Date.parse(player.world_created_at) - DAY_ZERO.steps * DAY_ZERO.minutes * 60_000));

    const candidates = (await loadCandidates(tx, input.worldId, from, now)).sort(byHeraldOrder);
    const due =
      !last ||
      candidates.length >= HERALD.dueAtStories ||
      (candidates.length >= 1 && Date.parse(now) - Date.parse(last.created_at) >= HERALD.dueAfterMinutes * 60_000);

    if (!due) {
      return {
        edition: await loadEdition(tx, last.id),
        created: false,
        reader: player.display_name,
        stopPress: candidates.map((c) => ({ storyNo: c.no, at: c.at, line: c.line })),
      };
    }

    const no = (last?.no ?? 0) + 1;
    const masthead = buildMasthead(content, now, `${input.worldId}:${player.id}:${no}`);
    const printed = candidates.slice(0, HERALD.lastRank);
    const accusation = await loadAccusation(tx, input.worldId, { storyNos: printed.map((c) => c.no) });
    const [edition] = await tx<{ id: string }[]>`
      insert into editions (world_id, player_id, no, covers_from, covers_to, created_at, masthead, status, accusation_fact)
      values (${input.worldId}, ${player.id}, ${no}, ${from}, ${now}, ${now}, ${jsonb(tx, masthead)}, 'templated',
              ${accusation?.factNo ?? null})
      returning id`;
    const blame = await loadBlameNames(tx, input.worldId, printed.map((c) => c.no));
    const stories: EditionStory[] = printed.map((c, i) => ({
      rank: i + 1,
      storyNo: c.no,
      slot: slotFor(i + 1),
      headline: c.line,
      standfirst: null,
      body: null,
      blameLine: blameLine(content, blame.get(c.no) ?? []),
    }));
    if (stories.length > 0) {
      await tx`
        insert into edition_stories (edition_id, rank, story_no, slot, headline, blame_line)
        select ${edition!.id}, (s->>'rank')::smallint, (s->>'storyNo')::bigint, s->>'slot', s->>'headline',
               s->>'blameLine'
        from jsonb_array_elements(${jsonb(tx, stories)}) as s`;
    }
    await tx`update player_private set last_edition_no = ${no} where player_id = ${player.id}`;

    return {
      edition: {
        id: edition!.id,
        no,
        coversFrom: from,
        coversTo: now,
        createdAt: now,
        masthead,
        status: 'templated',
        stories,
        accusation,
      },
      created: true,
      reader: player.display_name,
      stopPress: [],
    };
  });
}

/** Story heads in `(from, to]` that aren't silent, flagged if a `legendary` Fact names them as its deed. */
async function loadCandidates(tx: Tx, worldId: string, from: string, to: string): Promise<Candidate[]> {
  const rows = await tx<{ no: number; at: string; line: string; weight: number | null; legendary_deed: boolean }[]>`
    select f.no::float8 as no, to_json(f.at)#>>'{}' as at, f.line, f.comedy_weight as weight,
           exists (select 1 from facts l
                   where l.world_id = f.world_id and l.kind = 'legendary' and (l.payload->>'deed')::bigint = f.no)
             as legendary_deed
    from facts f
    where f.world_id = ${worldId} and f.no = f.story_no and f.tier <> 'silent'
      and f.at > ${from} and f.at <= ${to}`;
  return rows.map((r) => ({ no: r.no, at: iso(r.at), line: r.line, weight: r.weight ?? 0, legendaryDeed: r.legendary_deed }));
}

/**
 * Who to name in each story's Blame line: the head's `fact_blame` rows (one indexed lookup, no
 * recursion; decision 9), in landing order, with each Player's display name.
 */
async function loadBlameNames(tx: Tx, worldId: string, storyNos: number[]): Promise<Map<number, BlameName[]>> {
  const names = new Map<number, BlameName[]>();
  if (storyNos.length === 0) return names;
  const rows = await tx<{ fact_no: number; display_name: string; verb: BlameName['verb'] }[]>`
    select b.fact_no::float8 as fact_no, p.display_name, b.verb::text as verb
    from fact_blame b join players p on p.id = b.player_id
    where b.world_id = ${worldId} and b.fact_no = any(${storyNos}::bigint[])
    order by b.fact_no, b.landed_at, b.landed_fact, b.meddle_id`;
  for (const r of rows) names.set(r.fact_no, [...(names.get(r.fact_no) ?? []), { name: r.display_name, verb: r.verb }]);
  return names;
}

/**
 * §4.1: the highest-weight `accusation` Fact whose story is among `storyNos` (by its story's comedy
 * weight, then newest), only if the accused Player (still in the world) has a render for that accuser.
 * Or, for an edition already printed, its stored `factNo` (still only while the render exists).
 */
async function loadAccusation(
  tx: Tx,
  worldId: string,
  which: { storyNos: number[] } | { factNo: number | null },
): Promise<EditionAccusation | null> {
  const storyNos = 'storyNos' in which ? which.storyNos : null;
  const factNo = 'factNo' in which ? which.factNo : null;
  if (storyNos ? storyNos.length === 0 : factNo === null) return null;
  const [row] = await tx<{ no: number; story_no: number; accuser: string; line: string; clip_key: string }[]>`
    select a.no::float8 as no, a.story_no::float8 as story_no, r.accuser_id as accuser, a.line, r.clip_key
    from facts a
    join facts h on h.world_id = a.world_id and h.no = a.story_no
    join name_renders r on r.player_id = (a.payload->>'accused')::uuid and r.accuser_id = a.payload->>'accuser'
    join players p on p.id = r.player_id and p.world_id = a.world_id and p.removed_at is null
    where a.world_id = ${worldId} and a.kind = 'accusation'
      and ${storyNos ? tx`a.story_no = any(${storyNos}::bigint[])` : tx`a.no = ${factNo}`}
    order by h.comedy_weight desc nulls last, a.at desc, a.no
    limit 1`;
  return row ? { factNo: row.no, storyNo: row.story_no, accuser: row.accuser, line: row.line, clipKey: row.clip_key } : null;
}

async function loadEdition(tx: Tx, id: string): Promise<Edition> {
  const [e] = await tx<
    {
      id: string;
      world_id: string;
      no: number;
      covers_from: string;
      covers_to: string;
      created_at: string;
      masthead: Masthead;
      status: Edition['status'];
      accusation_fact: number | null;
    }[]
  >`
    select id, world_id, no, to_json(covers_from)#>>'{}' as covers_from, to_json(covers_to)#>>'{}' as covers_to,
           to_json(created_at)#>>'{}' as created_at, masthead, status, accusation_fact::float8 as accusation_fact
    from editions where id = ${id}`;
  const stories = await tx<
    { rank: number; story_no: number; slot: Slot; headline: string; standfirst: string | null; body: string | null; blame_line: string | null }[]
  >`
    select rank, story_no::float8 as story_no, slot, headline, standfirst, body, blame_line
    from edition_stories where edition_id = ${id} order by rank`;
  return {
    id: e!.id,
    no: e!.no,
    coversFrom: iso(e!.covers_from),
    coversTo: iso(e!.covers_to),
    createdAt: iso(e!.created_at),
    masthead: e!.masthead,
    status: e!.status,
    stories: stories.map((s) => ({
      rank: s.rank,
      storyNo: s.story_no,
      slot: s.slot,
      headline: s.headline,
      standfirst: s.standfirst,
      body: s.body,
      blameLine: s.blame_line,
    })),
    accusation: await loadAccusation(tx, e!.world_id, { factNo: e!.accusation_fact }),
  };
}

const ORDINAL = ['th', 'st', 'nd', 'rd'];
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${ORDINAL[(v - 20) % 10] ?? ORDINAL[v] ?? 'th'}`;
}

/**
 * The masthead for an edition printed at `at`: the orc date (the Europe/London calendar day, in orc
 * weekdays and months), a price gag and the weather, picked deterministically from `key`.
 */
export function buildMasthead(content: Content, at: string, key: string): Masthead {
  const { days, months, prices, weather } = content.banks.masthead;
  const date = londonDate(at);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const pick = <T>(list: T[], salt: string): T => list[parseInt(hashString(`${key}:${salt}`).slice(0, 8), 16) % list.length]!;
  return {
    orcDate: `${days[weekday]}, the ${ordinal(d)} of ${months[m - 1]}`,
    price: pick(prices, 'price'),
    weather: pick(weather, 'weather'),
  };
}
