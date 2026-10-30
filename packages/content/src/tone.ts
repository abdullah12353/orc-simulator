// The tone bible's checkable boundaries (§4): the Herald never swears, and nothing names a real person,
// a party, or Tolkien / Shadow of War / Mike Brooks content. The content check (#44) and the generated
// Herald's validator (#38) share these.
import type { Content } from './types.ts';

/**
 * Swearing, which the Herald never does (tone bible: "everywhere except the Herald"). Whole words with
 * explicit inflections, so "Arsenal", "prickly", "Dickensian" and "knobbly" don't count (#13's list).
 */
export const SWEAR = new RegExp(
  `\\b(${[
    '(mother)?fuck(s|ed|er|ers|ing|in|wit|wits)?', 'shit(s|e|ty|ter|ting|head|heads)?', 'shat', 'cunts?', 'bastards?',
    'bollocks', 'bollox', 'arse(s|d|hole|holes)?', 'wank(s|ed|er|ers|ing)?', 'twats?', 'pricks?', 'bellends?',
    'piss(ed|es|ing|er|y)?', 'tossers?', 'bugger(s|ed|ing)?', 'knob(s|head|heads)?', 'fanny', 'fannies', 'turds?',
    'dick(s|head|heads)?', 'bloody', 'crap(s|py|per)?', 'minge', 'sod off',
  ].join('|')})\\b`,
  'i',
);

/**
 * Names that must never appear: real politicians and parties (Brexit is a register, never a topic), and
 * Tolkien, Shadow of Mordor / War and Mike Brooks' ork books (inspiration only, original content only).
 * Matched as whole words, accents folded, any case.
 */
export const FORBIDDEN_NAMES = new RegExp(
  `\\b(${[
    // Real people and parties.
    'boris', 'farage', 'thatcher', 'corbyn', 'starmer', 'sunak', 'truss', 'cameron', 'blair', 'theresa may',
    'tory', 'tories', 'labour', 'lib ?dems?', 'ukip', 'reform uk', 'brexit party', 'westminster', 'downing street',
    'trump', 'biden', 'putin', 'macron',
    // Tolkien.
    'tolkien', 'sauron', 'saruman', 'gandalf', 'frodo', 'bilbo', 'baggins', 'gollum', 'smeagol', 'aragorn', 'legolas',
    'gimli', 'mordor', 'isengard', 'gondor', 'rohan', 'rivendell', 'hobbits?', 'nazgul', 'uruks?', 'uruk-hai',
    'grishna(kh|c?k)', 'shagrat', 'gorbag', 'ugluk', 'lugburz', 'azog', 'bolg', 'lurtz', 'gothmog', 'snaga', 'muzgash',
    'lagduf', 'radbug', 'lugdush', 'mauhur', 'balrogs?', 'shelob', 'barad-dur', 'minas', 'morgul', 'mithril',
    'middle-earth', 'smaug', 'orthanc', 'celebrimbor',
    // Shadow of Mordor / Shadow of War.
    'shadow of war', 'shadow of mordor', 'talion', 'eltariel', 'ratbag', 'bruz', 'ograth', 'torvin', 'hirgon',
    'baranor', 'carnan',
    // Mike Brooks' ork books, and Warhammer orks.
    'ufthak', 'blackjaw', 'snazzhammer', 'mogrot', 'da big dakka', 'brutal kunnin', 'dakka', 'kunnin', 'waa+gh',
    'gork', 'mork', 'ghazghkull', 'grotsnik', 'warhammer', 'squigs?', 'mekboy', 'boyz',
  ].join('|')})\\b`,
  'i',
);

/** Lowercases and strips accents, so "Grishnákh" is caught like "grishnakh". */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The first swear word in `text`, or null. */
export function swearIn(text: string): string | null {
  return text.match(SWEAR)?.[0] ?? null;
}

/** The first forbidden name in `text`, or null. */
export function forbiddenNameIn(text: string): string | null {
  return fold(text).match(FORBIDDEN_NAMES)?.[0]?.toLowerCase() ?? null;
}

/**
 * Every bundle string that ends up in the Herald's own words (Template lines and the banks spliced into
 * them, Grudge tags, Humiliations, Dares, the masthead), as `[where, text]`. Orc banter (fallback Clash
 * scripts, catchphrases) and the accusers' quotes are not the Herald's voice, so they may swear.
 */
export function heraldText(c: Content): [string, string][] {
  const out: [string, string][] = [];
  const add = (where: string, list: readonly (string | undefined)[]) => {
    for (const s of list) if (typeof s === 'string') out.push([where, s]);
  };
  for (const t of c.templates) add(`template ${t.id}`, t.lines);
  const b = c.banks;
  add('banks.oldHistory', b.oldHistory);
  for (const [k, e] of Object.entries(b.epithets)) add(`banks.epithets.${k}`, [e.text]);
  add('banks.masthead', [...b.masthead.days, ...b.masthead.months, ...b.masthead.prices, ...b.masthead.weather]);
  for (const [k, s] of Object.entries(b.subjects)) add(`banks.subjects.${k}`, [s]);
  for (const [k, s] of Object.entries(b.absurdSubjects)) add(`banks.absurdSubjects.${k}`, [s]);
  for (const [k, d] of Object.entries(b.claims)) add(`banks.claims.${k}`, [d.label, ...d.phrasings]);
  add('banks.blame', [b.blame.one, b.blame.two, b.blame.many, ...Object.values(b.blame.verbs).flatMap((v) => [v.began, v.noun])]);
  for (const [k, t] of Object.entries(b.trophies)) add(`banks.trophies.${k}`, [t.text]);
  for (const [k, list] of Object.entries(b.clash.results)) add(`banks.clash.results.${k}`, list);
  add('banks.clash.noTag', [b.clash.noTag, b.clash.anyMagnet]);
  for (const [k, m] of Object.entries(b.clash.magnets)) add(`banks.clash.magnets.${k}`, [m]);
  add('banks.clash.tags', [...b.clash.tags.beaten, ...b.clash.tags.fled, b.clash.tags.trophy, b.clash.tags.saviour]);
  for (const [k, h] of Object.entries(b.humiliations)) add(`banks.humiliations.${k}`, [h.label, h.text]);
  add('banks.death', [...b.death.died, ...b.death.averted.grace, ...b.death.averted.daily_cap, ...b.death.benched]);
  add('banks.throne', [...Object.values(b.throne.fell).flat(), ...b.throne.legendary, b.throne.emptyThrone]);
  for (const [k, d] of Object.entries(b.dares)) add(`banks.dares.${k}`, [d.label, d.text, d.grudge]);
  add('banks.dareFear', b.dareFear);
  return out;
}

/** Every string in the bundle, as `[where, text]` (cast cards, scripts and quotes included). */
export function allText(value: unknown, where = 'content'): [string, string][] {
  if (typeof value === 'string') return [[where, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => allText(v, `${where}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [...allText(k, `${where} key`), ...allText(v, `${where}.${k}`)]);
  }
  return [];
}
