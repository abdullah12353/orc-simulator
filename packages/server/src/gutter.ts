// The usage guard (#70, #54 item 8): keeps Neon under Free's 100 CU-hours a month, so compute never
// suspends mid-tick. At each 30-min slot the cron reads this billing period's compute from Neon's project
// API (#65: a control-plane call that doesn't wake Postgres, up to ~1 h stale). From 80 CU-h the gutter
// goes slow (no watched minute ticks, every world ticks on the slots only); from 95 it closes (the slots
// stop too, and sockets are refused). Both lift when the period ends, on the 1st at 00:00 UTC.

export const GUTTER = {
  slowCuHours: 80,
  closedCuHours: 95,
  /** The KV key the cron's last good reading lives under (in the world list's namespace). */
  kvKey: 'gutter',
} as const;

export type GutterState = 'normal' | 'slow' | 'closed';

/** One reading of Neon's compute for the current billing period. */
export interface UsageReading {
  /** CU-hours used this period: `compute_time_seconds / 3600`. */
  cuHours: number;
  /** When the period ends and the figure resets (ISO): Neon's `consumption_period_end`, the 1st at 00:00 UTC. */
  periodEnd: string;
  /** When it was read (ISO). */
  readAt: string;
}

/**
 * The gutter's state from the last reading. A reading from a period that has ended counts for nothing,
 * so slow and closed lift by themselves on the 1st, before the next reading lands. No reading: normal.
 */
export function gutterState(reading: Pick<UsageReading, 'cuHours' | 'periodEnd'> | null | undefined, now: Date): GutterState {
  if (!reading) return 'normal';
  const end = Date.parse(reading.periodEnd);
  if (!Number.isFinite(end) || now.getTime() >= end) return 'normal';
  if (reading.cuHours >= GUTTER.closedCuHours) return 'closed';
  if (reading.cuHours >= GUTTER.slowCuHours) return 'slow';
  return 'normal';
}

/** The 1st of the next month, 00:00 UTC: when Neon Free's period ends. */
export const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

export const NEON_API = 'https://console.neon.tech/api/v2';

/**
 * Reads the project's compute this period: `GET /projects/{id}` → `project.compute_time_seconds`, which
 * Neon resets at the start of each billing period (`consumption_period_start` … `_end`). Throws on
 * anything but a well-formed 200, so a failed reading never passes for a figure.
 */
export async function readNeonUsage(opts: {
  fetch: typeof fetch;
  projectId: string;
  apiKey: string;
  now: Date;
}): Promise<UsageReading> {
  const res = await opts.fetch(`${NEON_API}/projects/${encodeURIComponent(opts.projectId)}`, {
    headers: { authorization: `Bearer ${opts.apiKey}`, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Neon project API: ${res.status}`);
  const body = (await res.json()) as { project?: { compute_time_seconds?: unknown; consumption_period_end?: unknown } };
  const seconds = body.project?.compute_time_seconds;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('Neon project API: no compute_time_seconds');
  const end = body.project?.consumption_period_end;
  const periodEnd = typeof end === 'string' && Number.isFinite(Date.parse(end)) ? new Date(end).toISOString() : nextMonthStart(opts.now);
  return { cuHours: seconds / 3600, periodEnd, readAt: opts.now.toISOString() };
}
