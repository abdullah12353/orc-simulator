import { useEffect, useState } from 'react';
import { nameClip } from './audio.ts';
import { BlameLine } from './BlameLine.tsx';
import { ClashCard } from './ClashCard.tsx';
import { clashHeads, loadClashCard, type ClashCardData } from './clash-card-data.ts';
import { supabase } from './supabase.ts';

// The Gutter Herald (#27): opening it calls open-edition, which returns my new "Since You Left" edition
// or, if none is due, my last one plus a Stop press. Older editions (the last 7) are read directly
// under RLS (owner-only). Shapes mirror packages/server/src/herald.ts.

type Slot = 'lead' | 'headline' | 'gutter';

interface Story {
  rank: number;
  storyNo: number;
  slot: Slot;
  headline: string;
  standfirst: string | null;
  body: string | null;
  blameLine: string | null;
}

/** The edition's one Accusation (#39): a pull quote over its story's true Blame line. */
interface Accusation {
  factNo: number;
  storyNo: number;
  accuser: string;
  line: string;
  clipKey: string;
}

interface Edition {
  id: string;
  no: number;
  coversFrom: string;
  coversTo: string;
  masthead: { orcDate: string; price: string; weather: string };
  status: 'templated' | 'generated';
  stories: Story[];
  /** Only the edition open-edition returned carries it; back issues read under RLS don't. */
  accusation?: Accusation | null;
}

interface Opened {
  edition: Edition;
  created: boolean;
  /** My display name: highlighted wherever a Blame line names me. */
  reader: string;
  stopPress: { storyNo: number; at: string; line: string }[];
}

interface EditionRow {
  id: string;
  no: number;
  covers_from: string;
  covers_to: string;
  masthead: Edition['masthead'];
  status: Edition['status'];
  edition_stories: {
    rank: number;
    story_no: number;
    slot: Slot;
    headline: string;
    standfirst: string | null;
    body: string | null;
    blame_line: string | null;
  }[];
}

const SHOWN_EDITIONS = 7;
/** A lead Clash auto-plays once per edition on this device (D52); after that it's the Watch button. */
const playedKey = (editionId: string) => `orc:lead-played:${editionId}`;

function fromRow(r: EditionRow): Edition {
  return {
    id: r.id,
    no: r.no,
    coversFrom: r.covers_from,
    coversTo: r.covers_to,
    masthead: r.masthead,
    status: r.status,
    stories: [...r.edition_stories]
      .sort((a, b) => a.rank - b.rank)
      .map((s) => ({
        rank: s.rank,
        storyNo: s.story_no,
        slot: s.slot,
        headline: s.headline,
        standfirst: s.standfirst,
        body: s.body,
        blameLine: s.blame_line,
      })),
  };
}

export function Herald({ worldId }: { worldId: string }) {
  const [opened, setOpened] = useState<Opened | { error: string } | null>(null);
  const [archive, setArchive] = useState<Edition[]>([]);
  const [showing, setShowing] = useState<string | null>(null);
  const [clashes, setClashes] = useState<Set<number>>(new Set());
  const [playing, setPlaying] = useState<ClashCardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke<Opened>('open-edition', { body: { worldId } });
      if (cancelled) return;
      if (error || !data) return setOpened({ error: error?.message ?? 'The Herald did not arrive.' });
      setOpened(data);
      setShowing(data.edition.id);
      void autoPlayLead(data.edition);
      const past = await supabase
        .from('editions')
        .select('id, no, covers_from, covers_to, masthead, status, edition_stories (rank, story_no, slot, headline, standfirst, body, blame_line)')
        .eq('world_id', worldId)
        .order('no', { ascending: false })
        .limit(SHOWN_EDITIONS);
      if (!cancelled && past.data) {
        const editions = (past.data as EditionRow[]).map(fromRow);
        setArchive(editions);
        const heads = await clashHeads(worldId, [...new Set(editions.flatMap((e) => e.stories.map((st) => st.storyNo)))]);
        if (!cancelled) setClashes((known) => new Set([...known, ...heads]));
      }
    })();

    /** The lead set piece: a Clash lead plays as its card, full screen, the first time this edition is opened. */
    async function autoPlayLead(edition: Edition) {
      const lead = edition.stories.find((st) => st.slot === 'lead');
      if (!lead) return;
      const heads = await clashHeads(worldId, edition.stories.map((st) => st.storyNo));
      if (cancelled) return;
      setClashes((known) => new Set([...known, ...heads]));
      if (!heads.has(lead.storyNo) || localStorage.getItem(playedKey(edition.id))) return;
      const card = await loadClashCard(worldId, lead.storyNo, lead.blameLine);
      if (cancelled || !card) return;
      localStorage.setItem(playedKey(edition.id), '1');
      setPlaying(card);
    }
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  if (opened === null) return <p className="quiet">The Herald is on its way…</p>;
  if ('error' in opened) return <p className="error">{opened.error}</p>;

  const latest = opened.edition;
  const shown = archive.find((e) => e.id === showing) ?? latest;
  const edition = shown.id === latest.id ? { ...shown, accusation: latest.accusation } : shown;
  const isLatest = edition.id === latest.id;
  const watch = async (story: Story) => {
    const card = await loadClashCard(worldId, story.storyNo, story.blameLine);
    if (card) setPlaying(card);
  };

  return (
    <section className="herald">
      {playing && <ClashCard key={playing.clash.no} data={playing} reader={opened.reader} onDone={() => setPlaying(null)} />}
      {isLatest && opened.stopPress.length > 0 && (
        <aside className="stop-press">
          <h3>Stop press</h3>
          <ul>
            {opened.stopPress.map((s) => (
              <li key={s.storyNo}>{s.line}</li>
            ))}
          </ul>
        </aside>
      )}
      <EditionView edition={edition} reader={opened.reader} clashes={clashes} onWatch={watch} />
      {archive.length > 1 && (
        <nav className="editions" aria-label="Your last editions">
          <span className="quiet">Back issues:</span>
          {archive.map((e) => (
            <button key={e.id} className={e.id === edition.id ? 'on' : ''} onClick={() => setShowing(e.id)}>
              No. {e.no}
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function EditionView({
  edition,
  reader,
  clashes,
  onWatch,
}: {
  edition: Edition;
  reader: string;
  clashes: Set<number>;
  onWatch: (story: Story) => void;
}) {
  const watch = (s: Story) =>
    clashes.has(s.storyNo) && (
      <button className="watch" onClick={() => onWatch(s)}>
        Watch the Clash
      </button>
    );
  // At most one Accusation per edition (D53), printed above its story's true Blame line.
  const accused = (s: Story) =>
    edition.accusation?.storyNo === s.storyNo && <AccusationQuote accusation={edition.accusation} />;
  const lead = edition.stories.find((s) => s.slot === 'lead');
  const headlines = edition.stories.filter((s) => s.slot === 'headline');
  const gutter = edition.stories.filter((s) => s.slot === 'gutter');
  return (
    <article className="edition">
      <header className="masthead">
        <h2>The Gutter Herald</h2>
        <p className="strap">
          <span>{edition.masthead.orcDate}</span>
          <span>No. {edition.no}</span>
          <span>Price: {edition.masthead.price}</span>
        </p>
        <p className="weather">Weather: {edition.masthead.weather}</p>
        <p className="quiet">
          Since you left: {when(edition.coversFrom)} to {when(edition.coversTo)}
        </p>
      </header>
      {!lead && <p className="quiet">A quiet spell. Nothing happened that the Herald could print.</p>}
      {lead && (
        <div className="lead">
          <h3>{lead.headline}</h3>
          {lead.standfirst && <p className="standfirst">{lead.standfirst}</p>}
          {lead.body && <p>{lead.body}</p>}
          {accused(lead)}
          {lead.blameLine && <BlameLine line={lead.blameLine} reader={reader} />}
          {watch(lead)}
        </div>
      )}
      {headlines.length > 0 && (
        <ol className="headlines">
          {headlines.map((s) => (
            <li key={s.rank}>
              <h4>{s.headline}</h4>
              {s.body && <p>{s.body}</p>}
              {accused(s)}
              {s.blameLine && <BlameLine line={s.blameLine} reader={reader} />}
              {watch(s)}
            </li>
          ))}
        </ol>
      )}
      {gutter.length > 0 && (
        <details className="gutter">
          <summary>Also in the gutter ({gutter.length})</summary>
          <ul>
            {gutter.map((s) => (
              <li key={s.rank}>
                {s.headline}
                {accused(s)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

/**
 * The Accusation pull quote: the accuser's words, with the Player's mangled name in them, and his
 * prerecorded clip of that name. It plays once when the quote first shows (if the browser allows sound
 * yet) and again on tap. Flavour only: the Blame line under it is the truth.
 */
function AccusationQuote({ accusation }: { accusation: Accusation }) {
  useEffect(() => {
    void nameClip(accusation.clipKey);
  }, [accusation.factNo, accusation.clipKey]);
  return (
    <blockquote className="accusation">
      <p>{accusation.line}</p>
      <button className="play-name" onClick={() => void nameClip(accusation.clipKey)} aria-label="Hear the accusation">
        Hear it
      </button>
    </blockquote>
  );
}
