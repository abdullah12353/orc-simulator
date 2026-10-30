import { useEffect, useState, type ReactNode } from 'react';
import { content } from '@orc/content';
import { ClashCard } from './ClashCard.tsx';
import { clashHeads, loadClashCard, type ClashCardData } from './clash-card-data.ts';
import {
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

// The Hall of Shame (#40, D55): the best idiocy, kept forever, in time order and never ranked. Shelves
// (Legends, Infamous moments, and #41's Clippings), browse by Captain or by Player (the rap sheet), and a
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
const names = new Map(content.cast.map((c) => [c.id, c.name]));

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
        <li key={`${e.shelf}:${e.factNo}:${e.captainId ?? ''}`}>
          <time>{when(e.at)}</time>
          {showShelf && SHELF_LABEL[e.shelf] && <span className={`shelf-tag ${e.shelf}`}>{SHELF_LABEL[e.shelf]}</span>}
          {e.shelf === 'legend' && e.captainId && <strong className="legend-name">{names.get(e.captainId) ?? e.captainId} goes Legendary: </strong>}
          <span className="caption">{e.caption}</span>
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

function Shelves({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const state = useLoad(() => Promise.all([loadLegends(worldId), loadMoments(worldId)]), [worldId]);
  const loaded = state && !('error' in state) ? state : null;
  const a: Actions = { ...handlers, clashes: useClashes(worldId, loaded ? [...loaded[0], ...loaded[1]].map((e) => e.factNo) : []) };
  return (
    <Loading state={state}>
      {([legends, moments]: [HallEntry[], HallEntry[]]) => (
        <>
          <section className="shelf">
            <h3>Legends</h3>
            <EntryList entries={legends} actions={a} empty="Nobody has gone Legendary. Yet." />
          </section>
          <section className="shelf">
            <h3>Infamous moments</h3>
            <EntryList entries={moments} actions={a} empty="Nothing infamous enough. Give it time." />
          </section>
          {/* #41 Clippings: the Clippings shelf goes here (clippings, newest first). */}
        </>
      )}
    </Loading>
  );
}

function ByCaptain({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const [captain, setCaptain] = useState(content.cast[0]!.id);
  const state = useLoad(() => loadCaptainStory(worldId, captain), [worldId, captain]);
  const loaded = state && !('error' in state) ? state : null;
  const a: Actions = { ...handlers, clashes: useClashes(worldId, loaded ? [...new Set(loaded.map((s) => s.storyNo))] : []) };
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
                  <span className={`shelf-tag ${s.kind}`}>{s.kind.replace('_', ' ')}</span>
                  <span className="caption">{s.text}</span>
                  {s.storyLine && s.storyLine !== s.text && <span className="quiet story-line">{s.storyLine}</span>}
                  <Buttons factNo={s.storyNo} actions={a} />
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
  const playerId = picked ?? (players && !('error' in players) ? (players.me ?? list[0]?.id ?? null) : null);
  // One Player's sheet per request, always (no endpoint returns two).
  const sheet = useLoad(() => (playerId ? loadRapSheet(playerId) : Promise.resolve([])), [playerId]);
  const loaded = sheet && !('error' in sheet) ? sheet : null;
  const a: Actions = { ...handlers, clashes: useClashes(worldId, loaded ? loaded.map((e) => e.factNo) : []) };
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
      <Loading state={sheet}>{(entries: HallEntry[]) => <EntryList entries={entries} actions={a} empty="A clean sheet. For now." />}</Loading>
    </>
  );
}

function Timeline({ worldId, handlers }: { worldId: string; handlers: Handlers }) {
  const state = useLoad(() => loadTimeline(worldId), [worldId]);
  const loaded = state && !('error' in state) ? state : null;
  const a: Actions = { ...handlers, clashes: useClashes(worldId, loaded ? loaded.map((e) => e.factNo) : []) };
  return <Loading state={state}>{(entries: HallEntry[]) => <EntryList entries={entries} actions={a} empty="History has yet to happen." showShelf />}</Loading>;
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
  const handlers: Handlers = { onWatch: (n) => void onWatch(n), onTrace: (n) => void onTrace(n) };

  return (
    <section className="hall">
      {playing && <ClashCard key={playing.clash.no} data={playing} reader={reader} onDone={() => setPlaying(null)} />}
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
