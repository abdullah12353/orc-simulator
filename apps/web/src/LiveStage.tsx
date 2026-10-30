// The live stage (#31): mounted for the open world whatever tab is showing. On each live nudge it
// refetches the Facts of the ticks it hasn't seen and plays the new Clashes and notable events one at a
// time, queued so they never overlap.
import { useEffect, useRef, useState } from 'react';
import { ClashCard } from './ClashCard.tsx';
import { loadClashCard, loadClashDialogue, type ClashCardData } from './clash-card-data.ts';
import { useDialogue, useLive } from './live.ts';
import { enqueue, liveItems, type LiveFact, type LiveItem } from './live-queue.ts';
import { supabase } from './supabase.ts';

/** How long a notice holds: long enough to read, never so long it drags. */
const noticeMs = (line: string) => Math.max(4000, Math.min(8000, 2000 + 45 * line.length));

export function LiveStage({ worldId }: { worldId: string }) {
  const [queue, setQueue] = useState<LiveItem[]>([]);
  const [reader, setReader] = useState('');
  /** The newest tick whose Facts we've taken. Null until we know where the world was when we opened. */
  const cursor = useRef<number | null>(null);
  /** Fetches run one after another, so two nudges never queue the same Facts twice. */
  const chain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    cursor.current = null;
    setQueue([]);
    chain.current = (async () => {
      // Start from now: what happened before we opened is the Herald's job, not the live stage's.
      const { data } = await supabase.from('worlds').select('tick_seq').eq('id', worldId).maybeSingle();
      if (!cancelled && data) cursor.current = Number(data.tick_seq);
      const { data: auth } = await supabase.auth.getUser();
      const { data: me } = await supabase
        .from('players')
        .select('display_name')
        .eq('world_id', worldId)
        .eq('user_id', auth.user?.id ?? '')
        .maybeSingle();
      if (!cancelled && me) setReader(me.display_name as string);
    })();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  useLive(worldId, (tickSeq) => {
    chain.current = chain.current.then(async () => {
      const from = cursor.current;
      if (from === null || (tickSeq !== null && tickSeq <= from)) return;
      const { data } = await supabase
        .from('facts')
        .select('no, story_no, tick_seq, kind, tier, line')
        .eq('world_id', worldId)
        .gt('tick_seq', from)
        .order('no');
      const facts = ((data ?? []) as LiveFact[]).map((f) => ({ ...f, no: Number(f.no), story_no: Number(f.story_no), tick_seq: Number(f.tick_seq) }));
      if (facts.length === 0 || cursor.current !== from) return;
      cursor.current = Math.max(from, ...facts.map((f) => f.tick_seq));
      setQueue((q) => enqueue(q, liveItems(facts)));
    });
  });

  const playing = queue[0];
  const next = () => setQueue((q) => q.slice(1));
  if (!playing) return null;
  if (playing.kind === 'clash') return <LiveClash key={playing.no} worldId={worldId} no={playing.no} reader={reader} onDone={next} />;
  return <LiveNotice key={playing.no} line={playing.line} onDone={next} />;
}

function LiveClash({ worldId, no, reader, onDone }: { worldId: string; no: number; reader: string; onDone: () => void }) {
  const [data, setData] = useState<ClashCardData | null>(null);
  /** The generated lines were announced (possibly before the card itself loaded). */
  const landed = useRef(false);

  // A live Clash starts on its fallback script; when narration lands, the generated lines swap in and
  // the card plays them from the next beat on (ClashCard reads `data.lines` per beat).
  const swapIn = async () => {
    const dialogue = await loadClashDialogue(worldId, no);
    if (dialogue?.source === 'generated') setData((d) => (d ? { ...d, ...dialogue } : d));
  };
  useDialogue(worldId, (factNo) => {
    if (factNo !== no) return;
    landed.current = true;
    void swapIn();
  });

  useEffect(() => {
    let cancelled = false;
    landed.current = false;
    void loadClashCard(worldId, no).then((card) => {
      if (cancelled) return;
      if (!card) return onDone(); // not readable (yet): skip rather than stall the queue
      setData(card);
      if (landed.current && card.source === 'fallback') void swapIn();
    });
    return () => {
      cancelled = true;
    };
  }, [worldId, no]);
  return data ? <ClashCard data={data} reader={reader} onDone={onDone} /> : null;
}

function LiveNotice({ line, onDone }: { line: string; onDone: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, noticeMs(line));
    return () => window.clearTimeout(timer);
  }, [line]);
  return (
    <aside className="live-notice" role="status" onClick={onDone}>
      <span className="live-tag">Live</span>
      <span>{line}</span>
    </aside>
  );
}
