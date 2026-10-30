import { useEffect, useState } from 'react';
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

interface Edition {
  id: string;
  no: number;
  coversFrom: string;
  coversTo: string;
  masthead: { orcDate: string; price: string; weather: string };
  status: 'templated' | 'generated';
  stories: Story[];
}

interface Opened {
  edition: Edition;
  created: boolean;
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.functions.invoke<Opened>('open-edition', { body: { worldId } });
      if (cancelled) return;
      if (error || !data) return setOpened({ error: error?.message ?? 'The Herald did not arrive.' });
      setOpened(data);
      setShowing(data.edition.id);
      const past = await supabase
        .from('editions')
        .select('id, no, covers_from, covers_to, masthead, status, edition_stories (rank, story_no, slot, headline, standfirst, body, blame_line)')
        .eq('world_id', worldId)
        .order('no', { ascending: false })
        .limit(SHOWN_EDITIONS);
      if (!cancelled && past.data) setArchive((past.data as EditionRow[]).map(fromRow));
    })();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  if (opened === null) return <p className="quiet">The Herald is on its way…</p>;
  if ('error' in opened) return <p className="error">{opened.error}</p>;

  const latest = opened.edition;
  const edition = archive.find((e) => e.id === showing) ?? latest;
  const isLatest = edition.id === latest.id;

  return (
    <section className="herald">
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
      <EditionView edition={edition} />
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

function EditionView({ edition }: { edition: Edition }) {
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
          {lead.blameLine && <p className="blame">{lead.blameLine}</p>}
        </div>
      )}
      {headlines.length > 0 && (
        <ol className="headlines">
          {headlines.map((s) => (
            <li key={s.rank}>
              <h4>{s.headline}</h4>
              {s.body && <p>{s.body}</p>}
              {s.blameLine && <p className="blame">{s.blameLine}</p>}
            </li>
          ))}
        </ol>
      )}
      {gutter.length > 0 && (
        <details className="gutter">
          <summary>Also in the gutter ({gutter.length})</summary>
          <ul>
            {gutter.map((s) => (
              <li key={s.rank}>{s.headline}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
