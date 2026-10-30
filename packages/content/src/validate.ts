import { ACCENTS, CASTING, CLAIMS, FEARS, KRUG, TRAITS } from './pools.ts';
import type { CastCard, Content } from './types.ts';

const TRAIT_POOL = new Set<string>(TRAITS);
const FEAR_POOL = new Set<string>(FEARS);
const ACCENT_SET = new Set<string>(ACCENTS);

const REQUIRED_CARD_FIELDS: (keyof CastCard)[] = [
  'id',
  'name',
  'sayAs',
  'accent',
  'power',
  'traits',
  'fears',
  'catchphrase',
  'aliases',
  'portraitKey',
  'accuser',
];

/**
 * Checks the bundle for the mistakes CI must catch before a strike can break a live world:
 * unresolved slugs, malformed Templates and incomplete cast cards. Returns one message per problem.
 */
export function validateContent(c: Content): string[] {
  const errors: string[] = [];
  const castIds = new Set<string>();

  for (const card of c.cast) {
    if (castIds.has(card.id)) errors.push(`cast: duplicate Captain slug "${card.id}"`);
    castIds.add(card.id);
    for (const field of REQUIRED_CARD_FIELDS) {
      const v = card[field];
      if (v === undefined || v === null || v === '') errors.push(`cast ${card.id}: missing field "${field}"`);
    }
    if (typeof card.power === 'number' && (card.power < 1 || card.power > 10 || !Number.isInteger(card.power))) {
      errors.push(`cast ${card.id}: power must be an integer 1–10`);
    }
    if (Array.isArray(card.traits)) {
      if (card.traits.length !== 2) errors.push(`cast ${card.id}: needs exactly 2 traits`);
      else if (card.traits[0] === card.traits[1]) errors.push(`cast ${card.id}: its 2 traits must be distinct`);
      for (const t of card.traits) {
        if (!TRAIT_POOL.has(t)) errors.push(`cast ${card.id}: trait "${t}" is not in the shared pool`);
      }
    }
    if (Array.isArray(card.fears)) {
      if (card.fears.length !== 1) errors.push(`cast ${card.id}: needs exactly 1 starting Fear`);
      for (const f of card.fears) {
        if (!FEAR_POOL.has(f)) errors.push(`cast ${card.id}: Fear "${f}" is not in the Fear pool`);
      }
    }
    if (card.accent && !ACCENT_SET.has(card.accent)) {
      errors.push(`cast ${card.id}: accent "${card.accent}" is not one of the 6 archetypes`);
    }
    if (Array.isArray(card.aliases) && card.aliases.length !== 2) errors.push(`cast ${card.id}: needs exactly 2 aliases`);
    if (card.epithet !== undefined && !c.banks.epithets?.[card.epithet]) {
      errors.push(`cast ${card.id}: starting Epithet "${card.epithet}" is not in the Epithet bank`);
    }
  }

  // What castWorld needs to cast a world (D57).
  if (!castIds.has(KRUG)) errors.push(`cast: the founding Captain "${KRUG}" is missing`);
  for (const accent of ACCENTS) {
    const n = c.cast.filter((card) => card.accent === accent).length;
    if (n < CASTING.activePerAccent) {
      errors.push(`cast: accent "${accent}" has ${n} Captains; casting needs at least ${CASTING.activePerAccent}`);
    }
  }
  const accusers = c.cast.filter((card) => card.accuser).length;
  if (accusers !== CASTING.accusers) errors.push(`cast: ${accusers} accusers; there must be exactly ${CASTING.accusers}`);
  const history = new Set(c.banks.oldHistory ?? []);
  if (history.size < CASTING.seededGrudges.max) {
    errors.push(`banks.oldHistory: ${history.size} distinct tags; casting needs at least ${CASTING.seededGrudges.max}`);
  }

  const masthead = c.banks.masthead;
  const nonEmpty = (list: unknown) => Array.isArray(list) && list.every((s) => typeof s === 'string' && s.trim() !== '');
  if (!nonEmpty(masthead?.days) || masthead.days.length !== 7) errors.push('banks.masthead.days: needs 7 orc weekdays');
  if (!nonEmpty(masthead?.months) || masthead.months.length !== 12) errors.push('banks.masthead.months: needs 12 orc months');
  if (!nonEmpty(masthead?.prices) || masthead.prices.length === 0) errors.push('banks.masthead.prices: needs at least 1 price gag');
  if (!nonEmpty(masthead?.weather) || masthead.weather.length === 0) errors.push('banks.masthead.weather: needs at least 1 weather report');

  const templateIds = new Set<string>();
  for (const t of c.templates) {
    const where = `template ${t.id}`;
    if (templateIds.has(t.id)) errors.push(`templates: duplicate Template slug "${t.id}"`);
    templateIds.add(t.id);

    if (!Array.isArray(t.lines) || t.lines.length !== 3 || t.lines.some((l) => typeof l !== 'string' || l === '')) {
      errors.push(`${where}: needs exactly 3 line variants`);
    }
    if (!Array.isArray(t.outcomes) || t.outcomes.length === 0) {
      errors.push(`${where}: outcome table is empty`);
    } else {
      for (const o of t.outcomes) {
        if (!o.key || !(o.weight > 0)) errors.push(`${where}: outcome "${o.key}" needs a key and a positive weight`);
      }
    }
    if (!(typeof t.baseWeight === 'number' && t.baseWeight >= 0)) errors.push(`${where}: baseWeight must be >= 0`);

    const roleNames = new Set<string>();
    for (const role of t.roles ?? []) {
      if (roleNames.has(role.name)) errors.push(`${where}: duplicate role "${role.name}"`);
      roleNames.add(role.name);
      if (role.captain !== undefined && !castIds.has(role.captain)) {
        errors.push(`${where}: role "${role.name}" names unknown Captain slug "${role.captain}"`);
      }
    }
    const slots = new Set(t.slots ?? []);
    for (const line of t.lines ?? []) {
      for (const m of String(line).matchAll(/\{([^}]*)\}/g)) {
        if (!roleNames.has(m[1]!) && !slots.has(m[1]!)) {
          errors.push(`${where}: line uses {${m[1]}} but the Template casts no such role or slot`);
        }
      }
    }
  }

  errors.push(...validateRumours(c, templateIds));
  return errors;
}

/** One Template per Rumour outcome; the sim looks them up by these slugs. */
export const RUMOUR_TEMPLATES = {
  works: 'rumour.works',
  wrong_orc: 'rumour.wrong-orc',
  garbled: 'rumour.garbled',
} as const;

/** What Rumours need: subject phrases, Claim phrasings, the Garble ladder and absurd subjects (#28). */
function validateRumours(c: Content, templateIds: Set<string>): string[] {
  const errors: string[] = [];
  for (const id of Object.values(RUMOUR_TEMPLATES)) {
    if (!templateIds.has(id)) errors.push(`templates: the Rumour Template "${id}" is missing`);
  }
  const { subjects, absurdSubjects, claims, garbleLadder } = c.banks;
  for (const key of [...TRAITS, ...FEARS]) {
    if (!subjects?.[key]?.trim()) errors.push(`banks.subjects: no Rumour subject phrase for "${key}"`);
  }
  if (Object.keys(absurdSubjects ?? {}).length === 0) errors.push('banks.absurdSubjects: Garbles need at least 1 absurd subject');
  for (const claim of CLAIMS) {
    const def = claims?.[claim];
    if (!def?.label?.trim()) errors.push(`banks.claims.${claim}: needs a label`);
    if (!Array.isArray(def?.phrasings) || def.phrasings.length !== 3) {
      errors.push(`banks.claims.${claim}: needs exactly 3 phrasings`);
      continue;
    }
    for (const p of def.phrasings) {
      if (!String(p).includes('{subject}')) errors.push(`banks.claims.${claim}: phrasing "${p}" has no {subject}`);
    }
  }
  const ladder = garbleLadder ?? [];
  if (ladder.length !== 4 || new Set(ladder).size !== 4 || ladder.some((x) => !(CLAIMS as readonly string[]).includes(x))) {
    errors.push('banks.garbleLadder: needs 4 distinct Claims, bottom to top');
  }
  return errors;
}
