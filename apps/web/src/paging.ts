// "Show more" paging for the Hall's long lists (D55: kept forever). Pure, so it's tested in apps/web/test.

export interface Page<T> {
  items: T[];
  /** The last page came back full: there may be more. */
  more: boolean;
}

/** The rows of the next page (inclusive, as PostgREST's `range` takes them). */
export const nextRange = (shown: number, size: number) => ({ from: shown, to: shown + size - 1 });

/** Adds a page under what's shown, skipping rows already there (new entries shift the pages along). */
export function addPage<T>(shown: T[], page: T[], size: number, key: (t: T) => string): Page<T> {
  const seen = new Set(shown.map(key));
  return { items: [...shown, ...page.filter((t) => !seen.has(key(t)))], more: page.length === size };
}
