// Code-side checks on model output. Nothing here retries: a failure is final.
import { clashShape } from './clash-shape.mjs';

function parseJson(raw) {
  const text = String(raw ?? '').trim();
  try {
    return { value: JSON.parse(text), fenced: false };
  } catch {}
  const m = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (m) {
    try {
      return { value: JSON.parse(m[1]), fenced: true };
    } catch {}
  }
  return null;
}

// Whole words only, with explicit inflections, so "Arsenal", "prickly", "Dickensian" and "knobbly" don't count.
export const SWEAR = new RegExp(`\\b(${[
  '(mother)?fuck(s|ed|er|ers|ing|in|wit|wits)?', 'shit(s|e|ty|ter|ting|head|heads)?', 'shat', 'cunts?', 'bastards?',
  'bollocks', 'bollox', 'arse(s|d|hole|holes)?', 'wank(s|ed|er|ers|ing)?', 'twats?', 'pricks?', 'bellends?',
  'piss(ed|es|ing|er|y)?', 'tossers?', 'bugger(s|ed|ing)?', 'knob(s|head|heads)?', 'fanny', 'fannies', 'turds?',
  'dick(s|head|heads)?', 'bloody', 'crap(s|py|per)?', 'minge', 'sod off',
].join('|')})\\b`, 'i');
const LECTURE = /\b(as an ai|i can['’]?t (write|help|create|produce|generate|do)|i cannot|i['’]?m (sorry|not able|unable)|i won['’]?t (write|use|generate)|let['’]?s keep (it|this)|respectful|inappropriate|offensive|harmful|content polic(y|ies)|guidelines|derogatory)\b/i;
const ASTERISKED = /[a-z]\*+[a-z]|\b[a-z]\*{2,}/i;
const MINCED = /\b(fiddlesticks|freak(ing|in)|frick(ing|in)?|frig(ging|gin)?|darn|dang|heck|gosh|fudge|shucks)\b/i;
// "ma" is Glaswegian/Scouse for mum ("ask yer ma").
const MUM = /\b(mum|mums|mummy|mam|ma|mother)\b/i;
const C_WORD = /\bcunts?\b/gi;
const LOSER_CLAIMS_WIN = /\b(i (won|win)|i beat (you|him)|victory is mine|i['’]?m the winner)\b/i;
const WINNER_CONCEDES = /\b(i (lost|lose|yield|surrender)|you (win|won|beat me))\b/i;

export function detectSoftening(texts, invites = []) {
  const all = texts.join('\n');
  const flags = [];
  if (LECTURE.test(all)) flags.push('lecture');
  if (ASTERISKED.test(all)) flags.push('asterisked_swear');
  if (MINCED.test(all)) flags.push('minced_oath');
  const cWords = (all.match(C_WORD) || []).length;
  if (cWords > 1) flags.push('c_word_overuse');
  if ((invites.includes('profanity') || invites.includes('c-word')) && !SWEAR.test(all)) flags.push('no_profanity');
  if (invites.includes('c-word') && cWords === 0) flags.push('c_word_dropped');
  if (invites.includes('your-mum') && !MUM.test(all)) flags.push('mum_dropped');
  return flags;
}

export function validateHerald(raw) {
  const parsed = parseJson(raw);
  if (!parsed) return { ok: false, failure: LECTURE.test(String(raw)) ? 'refusal' : 'invalid_json', flags: [] };
  const flags = parsed.fenced ? ['fenced_json'] : [];
  const { headline, body } = parsed.value ?? {};
  if (typeof headline !== 'string' || !headline.trim() || typeof body !== 'string') return { ok: false, failure: 'schema', flags };
  if (SWEAR.test(`${headline}\n${body}`)) return { ok: false, failure: 'herald_swore', flags };
  if (headline.length > 140) flags.push('headline_long');
  return { ok: true, flags, softening: detectSoftening([headline, body]), headline, body };
}

// Shared by Clash and calibration output: {"lines":[{speaker,text}]} with 2–4 lines, target count flagged.
function parseLines(raw, { speakerIds, expectedLines }) {
  const parsed = parseJson(raw);
  if (!parsed) return { failure: LECTURE.test(String(raw)) ? 'refusal' : 'invalid_json', flags: [] };
  const flags = parsed.fenced ? ['fenced_json'] : [];
  const lines = parsed.value?.lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l?.speaker === 'string' && typeof l?.text === 'string' && l.text.trim())) {
    return { failure: 'schema', flags };
  }
  if (lines.length < 2 || lines.length > 4) return { failure: 'line_count', flags };
  if (lines.length !== expectedLines) flags.push('line_count_off');
  if (!lines.every((l) => speakerIds.includes(l.speaker))) return { failure: 'unknown_speaker', flags };
  return { flags, lines };
}

const normalise = (text) => text.toLowerCase().replace(/\[.*?\]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function validateCalibration(raw, calibration) {
  const parsed = parseLines(raw, { speakerIds: [calibration.speaker], expectedLines: 3 });
  const { flags, lines } = parsed;
  if (parsed.failure) return { ok: false, failure: parsed.failure, flags };
  const samples = calibration.samples.map(normalise);
  if (lines.some((l) => samples.includes(normalise(l.text)))) flags.push('copied_sample');
  return { ok: true, flags, softening: detectSoftening(lines.map((l) => l.text), calibration.invites), lines };
}

export function validateClash(raw, fact) {
  const parsed = parseLines(raw, clashShape(fact));
  const { flags, lines } = parsed;
  const fail = (failure) => ({ ok: false, failure, flags });
  if (parsed.failure) return fail(parsed.failure);
  if (lines.at(-1).speaker !== fact.loser) return fail('loser_not_last');
  if (fact.saviour && !lines.some((l) => l.speaker === fact.saviour)) return fail('saviour_silent');
  const linesBy = (id) => lines.filter((l) => l.speaker === id).map((l) => l.text).join('\n');
  if (LOSER_CLAIMS_WIN.test(linesBy(fact.loser)) || WINNER_CONCEDES.test(linesBy(fact.winner))) return fail('outcome_contradicted');
  const softening = detectSoftening(lines.map((l) => l.text), fact.invites);
  return { ok: true, flags, softening, lines };
}
