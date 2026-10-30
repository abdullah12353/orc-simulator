import { ACCENTS, CASTING, CAUSE_TAGS, CLAIMS, FEARS, KRUG, TRAITS } from './pools.ts';
import type { CastCard, ClashOutcome, Content } from './types.ts';

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
  errors.push(...validateBlameLines(c));
  errors.push(...validateClashes(c));
  errors.push(...validateReactions(c));
  errors.push(...validateRoster(c));
  errors.push(...validateAccusations(c));
  return errors;
}

/** Accusation lines (#39): a few to pick from, each saying the mangled name. */
function validateAccusations(c: Content): string[] {
  const lines = c.banks.accusations ?? [];
  const errors = lines.length < 3 ? [`banks.accusations: needs at least 3 lines, has ${lines.length}`] : [];
  lines.forEach((line, i) => {
    if (!line.includes('{name}')) errors.push(`banks.accusations[${i}]: missing {name}`);
  });
  return errors;
}

/** The roster's story heads (#32); the sim writes them by these slugs, with exactly these roles. */
export const ROSTER_TEMPLATES = {
  return: { id: 'roster.return', roles: ['returner'] },
  stepped_in: { id: 'roster.stepped-in', roles: ['newcomer', 'dead'] },
  unmasked: { id: 'roster.unmasked', roles: ['captain'] },
} as const;

const CAUSE_SET = new Set<string>(CAUSE_TAGS);
const HUMILIATION_TEXT = new Set(['name', 'alias', 'epithet']);

/** Death, Return and Humiliations (#32): every way to die picks a Humiliation that fits it. */
function validateRoster(c: Content): string[] {
  const errors: string[] = [];
  for (const [kind, def] of Object.entries(ROSTER_TEMPLATES)) {
    const t = c.templates.find((x) => x.id === def.id);
    if (!t) {
      errors.push(`templates: the roster Template "${def.id}" is missing`);
      continue;
    }
    if (t.kind !== kind || t.trigger !== 'roster') errors.push(`template ${t.id}: needs kind ${kind} and trigger roster`);
    const roles = (t.roles ?? []).map((r) => r.name).sort().join(',');
    if (roles !== [...def.roles].sort().join(',')) errors.push(`template ${t.id}: casts exactly ${def.roles.join(', ')}`);
  }
  for (const t of c.templates) {
    if (t.trigger === 'roster' && !Object.values(ROSTER_TEMPLATES).some((d) => d.id === t.id)) {
      errors.push(`template ${t.id}: only the roster Templates use trigger roster`);
    }
    const roles = new Set((t.roles ?? []).map((r) => r.name));
    for (const o of t.outcomes ?? []) {
      if (!o.death) continue;
      if (!roles.has(o.death.role)) errors.push(`template ${t.id}: outcome "${o.key}" kills role "${o.death.role}", which it doesn't cast`);
      if (!CAUSE_SET.has(o.death.tag)) errors.push(`template ${t.id}: outcome "${o.key}" has unknown cause tag "${o.death.tag}"`);
    }
  }

  const bank = c.banks.humiliations ?? {};
  for (const tag of CAUSE_TAGS) {
    if (!Object.values(bank).some((h) => h.causes?.includes(tag))) errors.push(`banks.humiliations: no Humiliation fits the cause "${tag}"`);
  }
  for (const [key, h] of Object.entries(bank)) {
    const where = `banks.humiliations.${key}`;
    if (!h.text?.trim() || !h.label?.trim()) errors.push(`${where}: needs a label and text`);
    for (const name of placeholders(h.text ?? '')) {
      if (!HUMILIATION_TEXT.has(name)) errors.push(`${where}: "{${name}}" can't be used (only {name}, {alias}, {epithet})`);
    }
    if (!h.causes?.length) errors.push(`${where}: fits no cause`);
    for (const tag of h.causes ?? []) if (!CAUSE_SET.has(tag)) errors.push(`${where}: unknown cause tag "${tag}"`);
    const marks = h.cat === 'bandage' || h.cat === 'lost_bit' || h.cat === 'disguise';
    if (marks && !(h.overlay && Number.isInteger(h.overlay.slot) && h.overlay.slot >= 2 && h.overlay.slot <= 8)) {
      errors.push(`${where}: a ${h.cat} needs a portrait overlay in slot 2–8`);
    }
    if (h.cat === 'epithet' && !(h.epithet && c.banks.epithets?.[h.epithet])) {
      errors.push(`${where}: Epithet "${h.epithet}" is not in the Epithet bank`);
    }
    if (h.cat === 'fear' && !(h.fear && c.banks.subjects?.[h.fear]?.trim())) {
      errors.push(`${where}: Fear "${h.fear}" has no Rumour subject phrase in banks.subjects`);
    }
    if (h.cat === 'disguise' && !String(h.text).includes('{alias}')) errors.push(`${where}: a disguise names his {alias}`);
  }

  const death = c.banks.death;
  const lists: [string, string[] | undefined][] = [
    ['banks.death.died', death?.died],
    ['banks.death.averted.grace', death?.averted?.grace],
    ['banks.death.averted.daily_cap', death?.averted?.daily_cap],
    ['banks.death.benched', death?.benched],
  ];
  for (const [where, list] of lists) {
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${where}: needs at least 1 sentence`);
      continue;
    }
    for (const line of list) {
      if (!String(line).includes('{captain}')) errors.push(`${where}: "${line}" doesn't name {captain}`);
    }
  }
  return errors;
}

/** The roles a reaction can cast from its parent Fact, per parent kind (incidents offer their Template's roles). */
export const PARENT_ROLES = {
  rumour: ['source', 'target', 'reached'],
  clash: ['a', 'b', 'winner', 'loser', 'saviour'],
} as const;

const CLASH_OUTCOMES: ClashOutcome[] = ['won', 'defeated', 'fled'];
const placeholders = (text: string) => [...String(text).matchAll(/\{([^}]*)\}/g)].map((m) => m[1]!);

/** Clash banks and Templates (#30): what the Grudge roll, the headline and the fallback dialogue need. */
function validateClashes(c: Content): string[] {
  const errors: string[] = [];
  const clash = c.banks.clash;
  if (Object.keys(c.banks.trophies ?? {}).length === 0) errors.push('banks.trophies: Clashes need at least 1 Trophy');
  for (const [key, t] of Object.entries(c.banks.trophies ?? {})) {
    if (!t?.text?.trim()) errors.push(`banks.trophies.${key}: needs text`);
  }

  const resultNames = new Set(['winner', 'loser', 'saviour', 'magnet']);
  for (const kind of [...CLASH_OUTCOMES, 'saviour'] as const) {
    const list = clash?.results?.[kind];
    if (!Array.isArray(list) || list.length !== 3) {
      errors.push(`banks.clash.results.${kind}: needs exactly 3 phrasings`);
      continue;
    }
    for (const p of list) {
      for (const name of placeholders(p)) {
        if (!resultNames.has(name)) errors.push(`banks.clash.results.${kind}: "{${name}}" is not a Clash name or the magnet`);
      }
    }
  }
  if (!clash?.noTag?.trim()) errors.push('banks.clash.noTag: needs text');
  if (!clash?.anyMagnet?.trim()) errors.push('banks.clash.anyMagnet: needs text');
  for (const [trait, magnet] of Object.entries(clash?.magnets ?? {})) {
    if (!TRAIT_POOL.has(trait)) errors.push(`banks.clash.magnets: "${trait}" is not a Trait`);
    if (!magnet?.trim()) errors.push(`banks.clash.magnets.${trait}: needs text`);
  }
  const tags = clash?.tags;
  if (!tags?.beaten?.length || !tags?.fled?.length) errors.push('banks.clash.tags: needs beaten and fled tags');
  if (!String(tags?.trophy ?? '').includes('{trophy}')) errors.push('banks.clash.tags.trophy: missing {trophy}');
  if (!String(tags?.saviour ?? '').includes('{magnet}')) errors.push('banks.clash.tags.saviour: missing {magnet}');

  const scriptNames = new Set(['winner', 'loser', 'saviour', 'magnet']);
  const covered = new Set<string>();
  for (const [key, s] of Object.entries(clash?.scripts ?? {})) {
    const where = `banks.clash.scripts.${key}`;
    const lines = Array.isArray(s?.lines) ? s.lines : [];
    const want = s?.saviour ? 4 : 3;
    if (lines.length !== want) errors.push(`${where}: needs ${want} lines${s?.saviour ? ' with a wrong saviour' : ''}`);
    if (lines.at(-1)?.speaker !== 'loser') errors.push(`${where}: the loser must speak last`);
    const saviourLines = lines.filter((l) => l.speaker === 'saviour').length;
    if (s?.saviour && saviourLines !== 1) errors.push(`${where}: a wrong-saviour script needs 4 lines, one of them his`);
    if (!s?.saviour && saviourLines > 0) errors.push(`${where}: only a wrong-saviour script gives the saviour a line`);
    for (const l of lines) {
      if (!['winner', 'loser', 'saviour'].includes(l?.speaker) || !l?.text?.trim()) errors.push(`${where}: a line needs a speaker and text`);
      for (const name of placeholders(l?.text ?? '')) {
        if (!scriptNames.has(name) || (name === 'saviour' && !s.saviour)) {
          errors.push(`${where}: "{${name}}" can't be used in a script`);
        }
      }
    }
    for (const o of s?.outcomes ?? []) covered.add(`${o}:${Boolean(s.saviour)}`);
  }
  for (const o of CLASH_OUTCOMES) {
    for (const saviour of [false, true]) {
      if (!covered.has(`${o}:${saviour}`)) {
        errors.push(`banks.clash.scripts: no fallback script for "${o}" ${saviour ? 'with' : 'without'} a wrong saviour`);
      }
    }
  }

  const clashTemplates = c.templates.filter((t) => t.kind === 'clash');
  if (clashTemplates.filter((t) => t.trigger === 'grudge').length !== 1) {
    errors.push('templates: there must be exactly one Grudge Clash Template (kind clash, trigger grudge)');
  }
  for (const t of clashTemplates) {
    const roles = (t.roles ?? []).map((r) => r.name).sort().join(',');
    if (roles !== 'a,b') errors.push(`template ${t.id}: a Clash Template casts exactly the roles a and b`);
    if (t.trigger !== 'grudge' && t.trigger !== 'reaction') errors.push(`template ${t.id}: a Clash starts from a Grudge or a reaction`);
    for (const slot of ['tag', 'result']) {
      if (!(t.slots ?? []).includes(slot)) errors.push(`template ${t.id}: a Clash Template needs the {${slot}} slot`);
    }
  }
  return errors;
}

/** Reaction Templates (#30): what they follow, and roles cast only from what that parent offers. */
function validateReactions(c: Content): string[] {
  const errors: string[] = [];
  // An incident offers its own Template's roles, so any incident role name is fair.
  const incidentRoles = new Set(c.templates.filter((t) => t.kind === 'incident').flatMap((t) => t.roles.map((r) => r.name)));
  for (const t of c.templates) {
    const where = `template ${t.id}`;
    if (t.trigger !== 'reaction') {
      if (t.after) errors.push(`${where}: only a reaction Template has "after"`);
      if (t.roles?.some((r) => r.from)) errors.push(`${where}: only a reaction Template casts roles "from" a parent`);
      continue;
    }
    if (!t.after || !['incident', 'rumour', 'clash'].includes(t.after.kind)) {
      errors.push(`${where}: a reaction Template needs "after" naming the Fact kind it follows`);
      continue;
    }
    if (!(t.after.chance > 0 && t.after.chance <= 1)) errors.push(`${where}: after.chance must be in (0, 1]`);
    const offered: ReadonlySet<string> = t.after.kind === 'incident' ? incidentRoles : new Set(PARENT_ROLES[t.after.kind]);
    for (const role of t.roles ?? []) {
      if (role.from !== undefined && !offered.has(role.from)) {
        errors.push(`${where}: role "${role.name}" casts from "${role.from}", which a ${t.after.kind} doesn't offer`);
      }
      if (role.trait !== undefined && !TRAIT_POOL.has(role.trait)) errors.push(`${where}: role "${role.name}" needs unknown Trait "${role.trait}"`);
    }
  }
  return errors;
}

/** One Template per Rumour outcome; the sim looks them up by these slugs. */
export const RUMOUR_TEMPLATES = {
  works: 'rumour.works',
  wrong_orc: 'rumour.wrong-orc',
  garbled: 'rumour.garbled',
} as const;

/** The Blame line templates (#29): a began/noun pair per verb, and every placeholder in its template. */
function validateBlameLines(c: Content): string[] {
  const errors: string[] = [];
  const bank = c.banks.blame;
  for (const verb of ['rumour', 'dare'] as const) {
    const v = bank?.verbs?.[verb];
    if (!v?.began?.trim() || !v?.noun?.trim()) errors.push(`banks.blame.verbs.${verb}: needs "began" and "noun"`);
  }
  const needs = { one: ['{first}'], two: ['{first}', '{last}'], many: ['{first}', '{middle}', '{last}'] } as const;
  for (const [key, slots] of Object.entries(needs) as [keyof typeof needs, readonly string[]][]) {
    for (const slot of slots) {
      if (!String(bank?.[key] ?? '').includes(slot)) errors.push(`banks.blame.${key}: missing ${slot}`);
    }
  }
  return errors;
}

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
