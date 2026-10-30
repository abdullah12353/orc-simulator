// The narration prompt (data-model decision 13, #13's bake-off): a fixed system prefix (the house rules
// and the whole tone bible), byte-identical on every call so providers can cache it, then one JSON input
// built from Facts only: for a Clash, the Clash, the speakers' voice cards and the pair's top Grudge
// tags; for a Herald edition, each printed story head's line and its Captains' names. Nothing private
// goes in (no Blame, no Players, no gold).
import { ACCENT_LABELS, TONE_BIBLE, type Content } from '@orc/content';
import { clashShape, type ClashFact } from '@orc/sim';

const CONTRACT = `You write the generated lines for ORC NONSENSE, a private comedy game about stupid orc Captains.
The tone bible below is the law. Its section 6 samples are the approved heat: match it, do not soften it, do not exceed it.

The simulation decides what happens. You only decide how it is said. Never change who won, who lost, or what was taken.

You get one JSON input per call, with a "task" field.

TASK "clash": write the Clash dialogue.
- Output ONLY a JSON object: {"lines":[{"speaker":"<speaker id>","text":"<line>"}]}
- Exactly "lines" lines: 3 normally (opening jab, comeback, the loser's last word), 4 when there is a wrong saviour (his line crashes in and makes it worse).
- "speaker" must be one of "speakers" (the ids, not the names). The "loser" speaks the LAST line.
- Each Captain speaks in his own accent through word choice and grammar only, no phonetic respelling. His jokes come from his Traits, Fear, Grudges and Trophies, never from his accent (swap test).
- Full British profanity is allowed for the orcs. The c-word at most once per Clash.

TASK "herald": write the stories of one edition of The Gutter Herald from the game's templated story lines.
- Output ONLY a JSON object: {"stories":[{"rank":<rank>,"headline":"<HEADLINE>","standfirst":"<sentence>","body":"<sentences>"}]}
- Exactly one entry per input story, with its "rank". Rank 1 is the lead.
- "headline": an ALL CAPS red-top headline. "standfirst": one deadpan sentence under it. "body": two to four deadpan sentences for the lead, one or two for the others.
- Report only what the story's "line" says happened. Never change who won, who lost, who died or what was taken. Names are the "captains" names.
- Clean, deadpan red-top tabloid. No swearing at all, not even mild. Treat orc idiocy with the gravity of history.
- Do not name or mention Players. Blame lines are added by the game, not by you.

No preamble, no markdown, no commentary. JSON only.

=== TONE BIBLE ===
`;

/** The cached prefix: the same bytes on every call, Clash or Herald. */
export const NARRATION_PREFIX = CONTRACT + TONE_BIBLE;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** A Clash and what its story took: the Trophy that changed hands, if one did. */
export interface ClashStory {
  clash: ClashFact;
  trophy: { key: string; from: string; to: string } | null;
  /**
   * Each speaker's Epithet (a `banks.epithets` key) as the Clash began, where an Epithet Humiliation
   * gave him one; a speaker not in it goes by his cast card's starting Epithet.
   */
  epithets?: Record<string, string | null>;
}

/** The model's input for one Clash. The shape fields (`lines`, `speakers`, `loser`) are `clashShape`'s. */
export function clashInput(content: Content, story: ClashStory) {
  const f = story.clash;
  const shape = clashShape(f);
  return {
    task: 'clash' as const,
    lines: shape.lines,
    speakers: shape.speakers,
    winner: f.winner,
    loser: shape.loser,
    startedBy: f.a,
    result: f.outcome === 'fled' ? 'the loser ran away' : 'the loser was beaten',
    headline: f.line,
    grudges: f.topTags,
    ...(f.saviour ? { wrongSaviour: f.saviour, saviourCameFor: f.saviourMagnet ?? content.banks.clash.anyMagnet } : {}),
    ...(story.trophy
      ? { trophyTaken: { what: content.banks.trophies[story.trophy.key]?.text ?? story.trophy.key, from: story.trophy.from, by: story.trophy.to } }
      : {}),
    captains: shape.speakers.map((id) => voiceCard(content, id, story.epithets)),
  };
}

/**
 * A speaker's voice card, from the cast card (the bundle's, so the prompt is Facts and content only),
 * with the Epithet he carried into the Clash (an Epithet Humiliation replaces the card's).
 */
function voiceCard(content: Content, id: string, epithets: ClashStory['epithets']) {
  const c = content.cast.find((x) => x.id === id);
  if (!c) return { id };
  const key = epithets && id in epithets ? epithets[id] : c.epithet;
  const epithet = key ? content.banks.epithets[key]?.text : undefined;
  return {
    id: c.id,
    name: c.name,
    ...(epithet ? { epithet } : {}),
    accent: ACCENT_LABELS[c.accent],
    traits: c.traits,
    fear: c.fears,
    catchphrase: c.catchphrase,
  };
}

export function clashMessages(content: Content, story: ClashStory): ChatMessage[] {
  return [
    { role: 'system', content: NARRATION_PREFIX },
    { role: 'user', content: JSON.stringify(clashInput(content, story)) },
  ];
}

/** One story the model writes up: a printed head (the lead or a headline), as the log has it. */
export interface HeraldStory {
  rank: number;
  kind: string;
  /** The head's templated line. */
  line: string;
  /** The Captains in it (`fact.cast`). */
  cast: string[];
}

/** The model's input for one edition: whitelisted fields only, so Blame lines and Players can't leak in. */
export function heraldInput(content: Content, stories: HeraldStory[]) {
  return {
    task: 'herald' as const,
    stories: stories.map((s) => ({
      rank: s.rank,
      kind: s.kind,
      line: s.line,
      captains: s.cast.map((id) => content.cast.find((c) => c.id === id)?.name ?? id),
    })),
  };
}

export function heraldMessages(content: Content, stories: HeraldStory[]): ChatMessage[] {
  return [
    { role: 'system', content: NARRATION_PREFIX },
    { role: 'user', content: JSON.stringify(heraldInput(content, stories)) },
  ];
}
