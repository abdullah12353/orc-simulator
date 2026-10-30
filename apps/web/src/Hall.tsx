import { useEffect, useRef, useState, type ReactNode } from 'react';
import { content } from '@orc/content';
import { captainName } from './captain-names.ts';
import { ClashCard } from './ClashCard.tsx';
import { ClippingCard } from './ClippingCard.tsx';
import { OnStage } from './OnStage.tsx';
import { loadClipping, loadClippings, type Clipping } from './clipping-data.ts';
import { clashHeads, loadClashCard, type ClashCardData } from './clash-card-data.ts';
import { factKindLabel } from './fact-labels.ts';
import {
  HALL_PAGE,
  loadCaptainStory,
  loadLegends,
  loadMoments,
  loadPlayers,
  loadRapSheet,
  loadTimeline,
  traceBack,
  type HallEntry,
  type StoryEntry,
  type TraceStep,
} from './hall-data.ts';
import { addPage, type Page } from './paging.ts';

// The Hall of Shame (#40, D55): the best idiocy, kept forever, in time order and never ranked. Shelves
// (Legends, Infamous moments, and Clippings (#41)), browse by Captain or by Player (the rap sheet), and a
// timeline merging the shelves. Any Clash replays from its stored dialogue (no model call), and any story
// can be traced back up its causes. Not checked by hand in a browser.

type View = 'shelves' | 'captains' | 'players' | 'timeline';

const VIEWS: { id: View; label: string }[] = [
  { id: 'shelves', label: 'Shelves' },
  { id: 'captains', label: 'By Captain' },
  { id: 'players', label: 'By Player' },
  { id: 'timeline', label: 'Timeline' },
];

const SHELF_LABEL: Record<HallEntry['shelf'], string> = { legend: 'Legend', moment: 'Moment', clipping: 'Clipping', rap: '' };

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Loads on mount and whenever `deps` change; null while loading. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]): T | { error: string } | null {
  const [state, setState] = useState<T | { error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setState(null);
    load().then(
      (v) => !cancelled && setState(v),
      (e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, deps);
  return state;
}

/**
 * A list that pages (D55: the Hall is kept forever): the first page on mount and whenever `deps` change,
 * then one more page per `more()`. `load(shown, size)` fetches the page `shown` rows in.
 */
function usePaged<T>(
  load: (shown: number, size: number) => Promise<T[]>,
  key: (t: T) => string,
  deps: unknown[],
): { state: Page<T> | { error: string } | null; more: () => void; busy: boolean } {
  const [state, setState] = useState<Page<T> | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped whenever the list starts over, so a late page for the old list is dropped. */
  const epoch = useRef(0);
  useEffect(() => {
    let cancelled = false;
    epoch.current += 1;
    setBusy(false);
    setState(null);
    load(0, HALL_PAGE).then(
      (page) => !cancelled && setState(addPage([], page, HALL_PAGE, key)),
      (e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, deps);
  const more = () => {
    if (busy || !state || 'error' in state || !state.more) return;
    const asked = epoch.current;
    const shown = state.items;
    setBusy(true);
    load(shown.length, HALL_PAGE).then(
      (page) => {
        if (epoch.current !== asked) return;
        setBusy(false);
        setState(addPage(shown, page, HALL_PAGE, key));
      },
      (e: unknown) => {
        if (epoch.current !== asked) return;
        setBusy(false);
        setState({ error: e instanceof Error ? e.message : String(e) });
      },
    );
  };
  return { state, more, busy };
}

function ShowMore({ page, more, busy }: { page: Page<unknown>; more: () => void; busy: boolean }) {
  if (!page.more) return null;
  return (
    <button className="link show-more" disabled={busy} onClick={more}>
      {busy ? 'Fetching more…' : 'Show more'}
    </button>
  );
}

function Loading<T>({ state, children }: { state: T | { error: string } | null; children: (v: T) => ReactNode }) {
  if (state === null) return <p className="quiet">Dusting the shelves…</p>;
  if (typeof state === 'object' && state !== null && 'error' in state) return <p className="error">{state.error}</p>;
  return <>{children(state as T)}</>;
}

interface Handlers {
  /** Replays a Clash. */
  onWatch: (factNo: number) => void;
  /** Opens "trace it back" for a story. */
  onTrace: (factNo: number) => void;
  /** Opens a Clipping (#41). */
  onClipping: (clipping: Clipping | string) => void;
}

interface Actions extends Handlers {
  /** The story heads shown that are Clashes (they can be replayed). */
  clashes: Set<number>;
}

/** Which of these story heads are Clashes, so their rows offer a replay. */
function useClashes(worldId: string, storyNos: number[]): Set<number> {
  const [set, setSet] = useState<Set<number>>(new Set());
  const key = storyNos.join(',');
  useEffect(() => {
    let cancelled = false;
    void clashHeads(worldId, storyNos).then((s) => !cancelled && setSet(s));
    return () => {
      cancelled = true;
    };
  }, [worldId, key]);
  return set;
}

function EntryList({ entries, actions, empty, showShelf }: { entries: HallEntry[]; actions: Actions; empty: string; showShelf?: boolean }) {
  if (entries.length === 0) return <p className="quiet">{empty}</p>;
  return (
    <ul className="hall-list">
      {entries.map((e) => (
        <li key={entryKey(e)}>
          <time>{when(e.at)}</time>
          {showShelf && SHELF_LABEL[e.shelf] && <span className={`shelf-tag ${e.shelf}`}>{SHELF_LABEL[e.shelf]}</span>}
          {e.shelf === 'legend' && e.captainId && <strong className="legend-name">{captainName(e.captainId)} goes Legendary: </strong>}
          <span className="caption">{e.caption}</span>
          {e.clippingId && (
            <button className="link" onClick={() => actions.onClipping(e.clippingId!)}>
              See the Clipping
            </button>
          )}
          <Buttons factNo={e.factNo} actions={actions} />
        </li>
      ))}
    </ul>
  );
}

function Buttons({ factNo, actions }: { factNo: number; actions: Actions }) {
  return (
    <span className="hall-actions">
      {actions.clashes.has(factNo) && (
        <button className="link" onClick={() => actions.onWatch(factNo)}>
          Watch the Clash
        </button>
      )}
      <button className="link" onClick={() => actions.onTrace(factNo)}>
        Trace it back
      </button>
    </span>
  );
}

const entryKey = (e: HallEntry) => `${e.shelf}:${e.factNo}:${e.captainId ?? ''}:${e.clippingId ?? ''}`;

function Shelves({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const legends = useLoad(() => loadLegends(worldId), [worldId]);
  const moments = usePaged((shown, size) => loadMoments(worldId, shown, size), entryKey, [worldId]);
  const clippings = usePaged(
    (shown, size) => loadClippings(worldId, shown, size),
    (c) => c.id,
    [worldId],
  );
  const heads = [...(legends && !('error' in legends) ? legends : []), ...(moments.state && !('error' in moments.state) ? moments.state.items : [])];
  const actions: Actions = {
    ...handlers,
    clashes: useClashes(
      worldId,
      heads.map((e) => e.factNo),
    ),
  };
  return (
    <>
      <section className="shelf">
        <h3>Legends</h3>
        <Loading state={legends}>
          {(list: HallEntry[]) => <EntryList entries={list} actions={actions} empty="Nobody has gone Legendary. Yet." />}
        </Loading>
      </section>
      <section className="shelf">
        <h3>Infamous moments</h3>
        <Loading state={moments.state}>
          {(page: Page<HallEntry>) => (
            <>
              <EntryList entries={page.items} actions={actions} empty="Nothing infamous enough. Give it time." />
              <ShowMore page={page} more={moments.more} busy={moments.busy} />
            </>
          )}
        </Loading>
      </section>
      <section className="shelf">
        <h3>Clippings</h3>
        <Loading state={clippings.state}>
          {(page: Page<Clipping>) =>
            page.items.length === 0 ? (
              <p className="quiet">Nobody has cut anything out of the Herald yet. Every story has a "Clip it" button.</p>
            ) : (
              <>
                <ul className="hall-list">
                  {page.items.map((c) => (
                    <li key={c.id}>
                      <time>{when(c.at)}</time>
                      <span className="caption">{c.caption}</span>
                      <span className="quiet"> clipped by {c.clippedBy}</span>
                      <span className="hall-actions">
                        <button className="link" onClick={() => actions.onClipping(c)}>
                          See the Clipping
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
                <ShowMore page={page} more={clippings.more} busy={clippings.busy} />
              </>
            )
          }
        </Loading>
      </section>
    </>
  );
}

function ByCaptain({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const [captain, setCaptain] = useState(content.cast[0]!.id);
  const state = useLoad(() => loadCaptainStory(worldId, captain), [worldId, captain]);
  const loaded = state && !('error' in state) ? state : null;
  const actions: Actions = { ...handlers, clashes: useClashes(worldId, loaded ? [...new Set(loaded.map((s) => s.storyNo))] : []) };
  return (
    <>
      <label className="hall-pick">
        Captain{' '}
        <select value={captain} onChange={(e) => setCaptain(e.target.value)}>
          {content.cast.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <Loading state={state}>
        {(story: StoryEntry[]) =>
          story.length === 0 ? (
            <p className="quiet">Nothing has happened to him. Suspicious.</p>
          ) : (
            <ul className="hall-list">
              {story.map((s) => (
                <li key={s.factNo}>
                  <time>{when(s.at)}</time>
                  <span className={`shelf-tag ${s.kind}`}>{factKindLabel(s.kind)}</span>
                  <span className="caption">{s.text}</span>
                  {s.storyLine && s.storyLine !== s.text && <span className="quiet story-line">{s.storyLine}</span>}
                  <Buttons factNo={s.storyNo} actions={actions} />
                </li>
              ))}
            </ul>
          )
        }
      </Loading>
    </>
  );
}

function ByPlayer({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const players = useLoad(() => loadPlayers(worldId), [worldId]);
  const [picked, setPicked] = useState<string | null>(null);
  const list = players && !('error' in players) ? players.players : [];
  // A pick only counts if it's one of this world's Players.
  const mine = picked && list.some((p) => p.id === picked) ? picked : null;
  const playerId = mine ?? (players && !('error' in players) ? (players.me ?? list[0]?.id ?? null) : null);
  // One Player's sheet per request, always (no endpoint returns two).
  const sheet = useLoad(() => (playerId ? loadRapSheet(playerId) : Promise.resolve([])), [playerId]);
  const loaded = sheet && !('error' in sheet) ? sheet : null;
  const actions: Actions = { ...handlers, clashes: useClashes(worldId, loaded ? loaded.map((e) => e.factNo) : []) };
  return (
    <>
      <label className="hall-pick">
        Rap sheet of{' '}
        <select value={playerId ?? ''} onChange={(e) => setPicked(e.target.value)}>
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <Loading state={sheet}>{(entries: HallEntry[]) => <EntryList entries={entries} actions={actions} empty="A clean sheet. For now." />}</Loading>
    </>
  );
}

function Timeline({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const timeline = usePaged((shown, size) => loadTimeline(worldId, shown, size), entryKey, [worldId]);
  const loaded = timeline.state && !('error' in timeline.state) ? timeline.state.items : [];
  const actions: Actions = {
    ...handlers,
    clashes: useClashes(
      worldId,
      loaded.map((e) => e.factNo),
    ),
  };
  return (
    <Loading state={timeline.state}>
      {(page: Page<HallEntry>) => (
        <>
          <EntryList entries={page.items} actions={actions} empty="History has yet to happen." showShelf />
          <ShowMore page={page} more={timeline.more} busy={timeline.busy} />
        </>
      )}
    </Loading>
  );
}

function Trace({ steps, onClose }: { steps: TraceStep[] | { error: string } | null; onClose: () => void }) {
  return (
    <aside className="trace">
      <h3>How it came to this</h3>
      <Loading state={steps}>
        {(list: TraceStep[]) => (
          <ol>
            {list.map((s) => (
              <li key={s.factNo}>
                <time>{when(s.at)}</time> {s.text}
              </li>
            ))}
          </ol>
        )}
      </Loading>
      <button className="link" onClick={onClose}>
        Close
      </button>
    </aside>
  );
}

export function Hall({ worldId }: { worldId: string }) {
  const [view, setView] = useState<View>('shelves');
  const [playing, setPlaying] = useState<ClashCardData | null>(null);
  const [clipping, setClipping] = useState<Clipping | null>(null);
  const [trace, setTrace] = useState<{ factNo: number; steps: TraceStep[] | { error: string } | null } | null>(null);
  const me = useLoad(() => loadPlayers(worldId), [worldId]);
  const reader = me && !('error' in me) ? (me.players.find((p) => p.id === me.me)?.name ?? '') : '';

  const onWatch = async (factNo: number) => {
    // A replay: the stored dialogue (generated or fallback), never a model call.
    const data = await loadClashCard(worldId, factNo);
    if (data) setPlaying(data);
  };
  const onTrace = async (factNo: number) => {
    setTrace({ factNo, steps: null });
    const steps = await traceBack(worldId, factNo).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    setTrace((t) => (t?.factNo === factNo ? { factNo, steps } : t));
  };
  const onClipping = async (c: Clipping | string) => setClipping(typeof c === 'string' ? await loadClipping(c) : c);
  const handlers: Handlers = { onWatch: (n) => void onWatch(n), onTrace: (n) => void onTrace(n), onClipping: (c) => void onClipping(c) };

  return (
    <section className="hall">
      {playing && (
        <OnStage key={playing.clash.no} name="hall">
          <ClashCard data={playing} reader={reader} onDone={() => setPlaying(null)} />
        </OnStage>
      )}
      {clipping && <ClippingCard snapshot={clipping.snapshot} reader={reader} clippedBy={clipping.clippedBy} onClose={() => setClipping(null)} />}
      <h2>The Hall of Shame</h2>
      <nav className="tabs hall-views">
        {VIEWS.map((v) => (
          <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </nav>
      {trace && <Trace steps={trace.steps} onClose={() => setTrace(null)} />}
      {view === 'shelves' && <Shelves worldId={worldId} handlers={handlers} />}
      {view === 'captains' && <ByCaptain worldId={worldId} handlers={handlers} />}
      {view === 'players' && <ByPlayer worldId={worldId} handlers={handlers} />}
      {view === 'timeline' && <Timeline worldId={worldId} handlers={handlers} />}
    </section>
  );
}
