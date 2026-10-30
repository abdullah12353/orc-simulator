// The narration prompt (data-model decision 13, #13's bake-off): a fixed system prefix (the house rules
// and the whole tone bible), byte-identical on every call so providers can cache it, then one JSON input
// built from Facts only: the Clash, the speakers' voice cards and the pair's top Grudge tags. Nothing
// private goes in (no Blame, no Players, no gold).
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

No preamble, no markdown, no commentary. JSON only.

=== TONE BIBLE ===
`;

/** The cached prefix: the same bytes on every call, Clash or Herald (#38 adds its task to the contract). */
export const NARRATION_PREFIX = CONTRACT + TONE_BIBLE;

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

/** A Clash and what its story took: the Trophy that changed hands, if one did. */
export interface ClashStory {
  clash: ClashFact;
  trophy: { key: string; from: string; to: string } | null;
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
    captains: shape.speakers.map((id) => voiceCard(content, id)),
  };
}

/** A speaker's voice card, from the cast card (the bundle's, so the prompt is Facts and content only). */
function voiceCard(content: Content, id: string) {
  const c = content.cast.find((x) => x.id === id);
  if (!c) return { id };
  const epithet = c.epithet ? content.banks.epithets[c.epithet]?.text : undefined;
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
