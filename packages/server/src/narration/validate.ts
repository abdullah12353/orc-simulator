// Code-side checks on a model's Clash dialogue. The shape rules are `shapeProblem`'s (the one Clash-shape
// definition, shared with the prompt and the fallback scripts); this adds parsing, refusal spotting, and
// mapping a speaker given by display name back to his id (Gemma does that, #13's findings).
import type { Content } from '@orc/content';
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
