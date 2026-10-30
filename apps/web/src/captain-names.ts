// How the PWA names a Captain, in one place: his name from the cast, with his Epithet, or (US78) the
// alias he goes by while disguised, until he's Unmasked. Pure, so it's tested in apps/web/test.
import { content, type CastCard, type HumiliationRow } from '@orc/content';

const cards = new Map<string, CastCard>(content.cast.map((c) => [c.id, c]));

/** His static card from the cast, if the id is one. */
export const castCard = (id: string): CastCard | undefined => cards.get(id);

/** His plain name from the cast (an unknown id is shown as itself). */
export const captainName = (id: string): string => cards.get(id)?.name ?? id;

/** A name with its Epithet tacked on ("Krúg the Barely Awake"). */
export function displayName(name: string, epithet: string | null | undefined): string {
  const text = epithet ? content.banks.epithets[epithet]?.text : undefined;
  return text ? `${name} ${text}` : name;
}

/** The alias he goes by, when disguised (alias index 0 or 1). */
export function aliasOf(id: string, aliasIdx: 0 | 1 | null | undefined): string | undefined {
  return aliasIdx === null || aliasIdx === undefined ? undefined : cards.get(id)?.aliases[aliasIdx];
}

/** What he goes by: his alias while disguised, else his name and Epithet. */
export function goesBy(id: string, now: { epithet?: string | null; aliasIdx?: 0 | 1 | null } = {}): string {
  return aliasOf(id, now.aliasIdx) ?? displayName(captainName(id), now.epithet);
}

/** A Captain as the Rumour and Dare pickers list him: what he goes by, marked Warlord or dead. */
export function pickerLabel(
  id: string,
  row: { epithet: string | null; aliasIdx: 0 | 1 | null; roster: 'active' | 'reserve' | 'dead' } | undefined,
  warlordId: string | null,
): string {
  return goesBy(id, row ?? {}) + (id === warlordId ? ' (Warlord)' : '') + (row?.roster === 'dead' ? ' (dead)' : '');
}

/**
 * His alias as of Fact `factNo` (a Clash, say): only if a disguise was on him then AND he's still in it now
 * (`aliasIdx`, his current alias). Once Unmasked, which alias he used is no longer known, so his own name.
 */
export function aliasAsOf(aliasIdx: 0 | 1 | null, rows: HumiliationRow[], factNo: number): 0 | 1 | null {
  if (aliasIdx === null) return null;
  const disguised = rows.some(
    (r) => content.banks.humiliations[r.kind]?.cat === 'disguise' && r.gainedFact <= factNo && (r.endedFact === null || r.endedFact > factNo),
  );
  return disguised ? aliasIdx : null;
}
