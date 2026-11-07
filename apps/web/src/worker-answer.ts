// What a world job's answer from the Worker means to a Player (#69). Pure, so it's tested in apps/web/test;
// the fetch is worker.ts's. The Worker answers `{ error: "<reason>" }` on a refusal, and while the usage
// guard has closed the gutter (#70) every world job gets `503 {"error":"gutter_closed"}`.
import { gutterNotice } from './gutter.ts';
import { reasonText } from './reasons.ts';

export type WorkerAnswer<T> = { data: T; error?: undefined } | { data?: undefined; error: string };

/** The line a Player sees when the gutter is closed: the same as the banner's. */
export const GUTTER_CLOSED_LINE = gutterNotice({ state: 'closed' })!.line;

/** Turns the Worker's response into data, or the line to show. Never throws. */
export async function readWorkerAnswer<T>(res: Response, fallback: string): Promise<WorkerAnswer<T>> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && body !== null) return { data: body as T };
  const reason = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (reason === 'gutter_closed') return { error: GUTTER_CLOSED_LINE };
  if (res.status === 401) return { error: reasonText({ message: 'not_signed_in' }) };
  if (typeof reason === 'string' && reason) return { error: reasonText({ message: reason }) };
  return { error: fallback };
}
