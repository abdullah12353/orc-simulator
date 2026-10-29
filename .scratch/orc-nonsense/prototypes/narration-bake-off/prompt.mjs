// Builds the fixed system prefix and the per-call user messages.
// The prefix must be byte-identical on every call (Clash or Herald) so providers can cache it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TONE_BIBLE = fileURLToPath(new URL('../../tone-bible.md', import.meta.url));

export function loadToneBible() {
  // Normalise line endings so a Windows checkout produces the same bytes.
  return readFileSync(TONE_BIBLE, 'utf8').replace(/\r\n/g, '\n');
}

const CONTRACT = `You write the generated lines for ORC NONSENSE, a private comedy game about stupid orc Captains.
The tone bible below is the law. Its section 6 samples are the approved heat: match it, do not soften it, do not exceed it.

The simulation decides what happens. You only decide how it is said. Never change who won, who lost, or what was taken.

You get one JSON input per call, with a "task" field.

TASK "clash": write the Clash dialogue.
- Output ONLY a JSON object: {"lines":[{"speaker":"<speaker id>","text":"<line>"}]}
- Exactly "expectedLines" lines: 3 normally (opening jab, comeback, the loser's last word), 4 when there is a wrong saviour (his line crashes in and makes it worse).
- "speaker" must be one of "speakerIds". The LOSER speaks the LAST line.
- Each Captain speaks in his own accent through word choice and grammar only, no phonetic respelling. His jokes come from his Traits, Fear, Grudges and Trophies, never from his accent (swap test). Muffled Captains speak in MMF noises with the meaning in [square brackets].
- If "playerRumourLine" is present, the Captains may quote or mangle it.
- Full British profanity is allowed for the orcs. The c-word at most once per Clash.

TASK "herald": write one edition of The Gutter Herald from the templated event lines.
- Output ONLY a JSON object: {"headline":"<ALL CAPS HEADLINE>","body":"<two to four deadpan sentences>"}
- Clean, deadpan red-top tabloid. No swearing at all. Treat orc idiocy with the gravity of history.
- Do not name or mention Players. Blame lines are added by the game, not by you.

No preamble, no markdown, no commentary. JSON only.

=== TONE BIBLE ===
`;

let cached;
export function loadPrefix() {
  if (cached) return cached;
  const bible = loadToneBible();
  const body = bible.slice(bible.indexOf('## 1.'));
  cached = CONTRACT + body.trim() + '\n';
  return cached;
}

function card(c) {
  if (!c) return undefined;
  // Whitelist: only card fields go to the model.
  const { id, name, epithet, accent, traits, fear, catchphrase, power, infamy, humiliations, trophies, overlays, status } = c;
  return { id, name, epithet, accent, traits, fear, catchphrase, power, infamy, humiliations, trophies, overlays, status };
}

export function clashInput(fact, cast) {
  // Whitelist the Fact too, so Blame and Accusations can't leak in.
  return {
    task: 'clash',
    speakerIds: [fact.a, fact.b, fact.saviour].filter(Boolean),
    expectedLines: fact.saviour ? 4 : 3,
    fact: {
      why: fact.why,
      winner: fact.winner,
      loser: fact.loser,
      result: fact.result,
      aftermath: fact.aftermath,
      saviour: fact.saviour,
      trophy: fact.trophy,
    },
    captains: [card(cast[fact.a]), card(cast[fact.b]), card(cast[fact.saviour])].filter(Boolean),
    grudges: fact.grudges ?? [],
    playerRumourLine: fact.rumourLine,
  };
}

export function buildClashMessages(prefix, fact, cast) {
  return [
    { role: 'system', content: prefix },
    { role: 'user', content: JSON.stringify(clashInput(fact, cast)) },
  ];
}

export function buildHeraldMessages(prefix, herald) {
  return [
    { role: 'system', content: prefix },
    { role: 'user', content: JSON.stringify({ task: 'herald', events: herald.events }) },
  ];
}

// §6 of the tone bible: "**Name** (desc)" followed by numbered or bulleted lines.
export function parseCalibrationSamples(bible) {
  const start = bible.indexOf('## 6.');
  const section = bible.slice(start).split('\n').slice(1);
  const groups = [];
  for (const line of section) {
    const head = line.match(/^\*\*(.+?)\*\*\s*(\(.+\))?\s*$/);
    if (head) {
      groups.push({ who: head[1] + (head[2] ? ' ' + head[2] : ''), lines: [] });
    } else if (groups.length && /^(\d+\.|-)\s+/.test(line)) {
      groups.at(-1).lines.push(line.replace(/^(\d+\.|-)\s+/, ''));
    }
  }
  return groups;
}
