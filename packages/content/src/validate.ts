import type { CastCard, Content } from './types.ts';

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
    if (Array.isArray(card.traits) && card.traits.length !== 2) errors.push(`cast ${card.id}: needs exactly 2 traits`);
    if (Array.isArray(card.aliases) && card.aliases.length !== 2) errors.push(`cast ${card.id}: needs exactly 2 aliases`);
  }

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
    for (const line of t.lines ?? []) {
      for (const m of String(line).matchAll(/\{([^}]*)\}/g)) {
        if (!roleNames.has(m[1]!)) errors.push(`${where}: line uses {${m[1]}} but the Template casts no such role`);
      }
    }
  }

  return errors;
}
