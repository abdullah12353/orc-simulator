// Pure calendar arithmetic on ISO strings. The sim must not touch `Date`, so it can't use Intl either.

/** Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's days_from_civil). */
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z: number): [number, number, number] {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

/** Days since epoch of the last Sunday of a month. 1970-01-01 was a Thursday. */
function lastSunday(y: number, m: number): number {
  const lastDay = daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - 1;
  const dow = (((lastDay + 4) % 7) + 7) % 7; // 0 = Sunday
  return lastDay - dow;
}

/** Minutes since epoch for a UTC ISO timestamp, parsed by hand. */
export function isoToMinutes(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) throw new Error(`not an ISO timestamp: ${iso}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return daysFromCivil(y, mo, d) * 1440 + h * 60 + mi;
}

/**
 * The Europe/London calendar date (YYYY-MM-DD) of a UTC instant. BST runs from 01:00 UTC on the
 * last Sunday of March to 01:00 UTC on the last Sunday of October (data-model decision 12).
 */
export function londonDate(iso: string): string {
  const minutes = isoToMinutes(iso);
  const [y] = civilFromDays(Math.floor(minutes / 1440));
  const bstStart = lastSunday(y, 3) * 1440 + 60;
  const bstEnd = lastSunday(y, 10) * 1440 + 60;
  const local = minutes + (minutes >= bstStart && minutes < bstEnd ? 60 : 0);
  const [ly, lm, ld] = civilFromDays(Math.floor(local / 1440));
  return `${String(ly).padStart(4, '0')}-${String(lm).padStart(2, '0')}-${String(ld).padStart(2, '0')}`;
}
