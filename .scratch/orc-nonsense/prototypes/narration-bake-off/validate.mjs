// Code-side checks on model output. Nothing here retries: a failure is final.

function parseJson(raw) {
  if (raw && typeof raw === 'object') return { value: raw, fenced: false };
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

export const SWEAR = /\b(fuck|shit|cunt|bastard|bollock|arse|wank|twat|prick|bellend|piss|tosser|bugger|knob|fanny|turd|dick|bloody|crap|minge|sod off)/i;
const LECTURE = /as an ai|i can['’]?t (write|help|create|produce|generate|do)|i cannot|i['’]?m (sorry|not able|unable)|i won['’]?t (write|use|generate)|let['’]?s keep (it|this)|respectful|inappropriate|offensive|harmful|content polic|guidelines|derogatory/i;
const ASTERISKED = /[a-z]\*+[a-z]|\b[a-z]\*{2,}/i;
const MINCED = /\b(fiddlesticks|freak(ing|in)|frick|frig(gin)?|darn|dang|heck|gosh|fudge|shucks)\b/i;
const MUM = /\b(mum|mummy|mother|ma)\b/i;
const LOSER_CLAIMS_WIN = /\b(i (won|win)|i beat (you|him)|victory is mine|i['’]?m the winner)\b/i;
const WINNER_CONCEDES = /\b(i (lost|lose|yield|surrender)|you (win|won|beat me))\b/i;

export function detectSoftening(texts, invites = []) {
  const all = texts.join('\n');
  const flags = [];
  if (LECTURE.test(all)) flags.push('lecture');
  if (ASTERISKED.test(all)) flags.push('asterisked_swear');
  if (MINCED.test(all)) flags.push('minced_oath');
  const cWords = (all.match(/cunt/gi) || []).length;
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

export function validateClash(raw, fact) {
  const parsed = parseJson(raw);
  if (!parsed) return { ok: false, failure: LECTURE.test(String(raw)) ? 'refusal' : 'invalid_json', flags: [] };
  const flags = parsed.fenced ? ['fenced_json'] : [];
  const fail = (failure) => ({ ok: false, failure, flags });
  const lines = parsed.value?.lines;
  if (!Array.isArray(lines) || !lines.every((l) => typeof l?.speaker === 'string' && typeof l?.text === 'string' && l.text.trim())) {
    return fail('schema');
  }
  const target = fact.saviour ? 4 : 3;
  if (lines.length < 2 || lines.length > 4) return fail('line_count');
  if (lines.length !== target) flags.push('line_count_off');
  const known = new Set([fact.a, fact.b, fact.saviour].filter(Boolean));
  if (!lines.every((l) => known.has(l.speaker))) return fail('unknown_speaker');
  if (lines.at(-1).speaker !== fact.loser) return fail('loser_not_last');
  if (fact.saviour && !lines.some((l) => l.speaker === fact.saviour)) return fail('saviour_silent');
  const by = (id) => lines.filter((l) => l.speaker === id).map((l) => l.text).join('\n');
  if (LOSER_CLAIMS_WIN.test(by(fact.loser)) || WINNER_CONCEDES.test(by(fact.winner))) return fail('outcome_contradicted');
  const softening = detectSoftening(lines.map((l) => l.text), fact.invites);
  return { ok: true, flags, softening, lines };
}
