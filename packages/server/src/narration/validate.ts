// Code-side checks on a model's Clash dialogue. The shape rules are `shapeProblem`'s (the one Clash-shape
// definition, shared with the prompt and the fallback scripts); this adds parsing, refusal spotting, and
// mapping a speaker given by display name back to his id (Gemma does that, #13's findings).
import { SWEAR, type Content } from '@orc/content';
import { shapeProblem, type ClashFact, type ClashLine } from '@orc/sim';

/** Why a job kept its fallback (data-model §1.5 `narration_jobs.failure`). */
export type NarrationFailure = 'refusal' | 'timeout' | 'bad_output' | 'quota';

export type ClashVerdict = { ok: true; lines: ClashLine[] } | { ok: false; failure: 'refusal' | 'bad_output'; why: string };

/** A model lecturing instead of writing. */
const LECTURE =
  /\b(as an ai|i can['’]?t (write|help|create|produce|generate|do)|i cannot|i['’]?m (sorry|not able|unable)|i won['’]?t (write|use|generate)|content polic(y|ies)|guidelines)\b/i;

function parseJson(raw: string): unknown {
  const text = raw.trim();
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]!);
    } catch {}
  }
  return undefined;
}

const nameKey = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

export function validateClash(content: Content, fact: ClashFact, raw: string): ClashVerdict {
  const parsed = parseJson(raw);
  if (parsed === undefined) {
    return LECTURE.test(raw) ? { ok: false, failure: 'refusal', why: 'refused' } : { ok: false, failure: 'bad_output', why: 'not JSON' };
  }
  const lines = (parsed as { lines?: unknown })?.lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l?.speaker === 'string' && typeof l?.text === 'string')) {
    return { ok: false, failure: 'bad_output', why: 'not {"lines":[{speaker,text}]}' };
  }
  const speakers = [fact.a, fact.b, ...(fact.saviour ? [fact.saviour] : [])];
  const byName = new Map(
    speakers.flatMap((id) => {
      const name = content.cast.find((c) => c.id === id)?.name;
      return name ? [[nameKey(name), id] as const] : [];
    }),
  );
  const mapped: ClashLine[] = (lines as { speaker: string; text: string }[]).map((l) => ({
    speaker: speakers.includes(l.speaker) ? l.speaker : (byName.get(nameKey(l.speaker)) ?? l.speaker),
    text: l.text.trim(),
  }));
  const problem = shapeProblem(fact, mapped);
  if (problem) return { ok: false, failure: 'bad_output', why: problem };
  return { ok: true, lines: mapped };
}

// Swearing (the Herald never does it) is the tone bible's list, shared with the content check (#44).

/** What the model wrote for one printed story. Blame lines are never among them. */
export interface HeraldWriting {
  rank: number;
  headline: string;
  standfirst: string | null;
  body: string;
}

export type HeraldVerdict = { ok: true; stories: HeraldWriting[] } | { ok: false; failure: 'refusal' | 'bad_output'; why: string };

/** Longest a field may run before it breaks the page. */
export const HERALD_LIMITS = { headline: 200, standfirst: 400, body: 1500 } as const;

/**
 * Checks a model's Herald edition: exactly one story per rank asked for, each with a headline and a
 * body, and not one swear word anywhere. Only the three written fields are kept; anything else the
 * model adds (a Blame line of its own, say) is dropped.
 */
export function validateHerald(raw: string, ranks: number[]): HeraldVerdict {
  const parsed = parseJson(raw);
  if (parsed === undefined) {
    return LECTURE.test(raw) ? { ok: false, failure: 'refusal', why: 'refused' } : { ok: false, failure: 'bad_output', why: 'not JSON' };
  }
  const stories = (parsed as { stories?: unknown })?.stories;
  const fine = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (
    !Array.isArray(stories) ||
    !stories.every(
      (s) =>
        typeof s?.rank === 'number' &&
        fine(s.headline, HERALD_LIMITS.headline) &&
        fine(s.body, HERALD_LIMITS.body) &&
        (s.standfirst == null || (typeof s.standfirst === 'string' && s.standfirst.length <= HERALD_LIMITS.standfirst)),
    )
  ) {
    return { ok: false, failure: 'bad_output', why: 'not {"stories":[{rank,headline,standfirst,body}]}' };
  }
  const got = (stories as { rank: number }[]).map((s) => s.rank).sort((a, b) => a - b);
  const want = [...ranks].sort((a, b) => a - b);
  if (got.length !== want.length || got.some((r, i) => r !== want[i])) {
    return { ok: false, failure: 'bad_output', why: `story count: ranks ${got.join(',')} for ${want.join(',')}` };
  }
  const writing: HeraldWriting[] = (stories as { rank: number; headline: string; standfirst?: string | null; body: string }[])
    .map((s) => ({ rank: s.rank, headline: s.headline.trim(), standfirst: s.standfirst?.trim() || null, body: s.body.trim() }))
    .sort((a, b) => a.rank - b.rank);
  for (const s of writing) {
    const swore = `${s.headline}\n${s.standfirst ?? ''}\n${s.body}`.match(SWEAR);
    if (swore) return { ok: false, failure: 'bad_output', why: `swore: ${swore[0].toLowerCase()}` };
  }
  return { ok: true, stories: writing };
}
