import { useEffect, useState } from 'react';
import { accusationsFrom, type Accusation, type AccusationFactRow, type NameRenderRow } from './accusation.ts';
import { nameClip, sting } from './audio.ts';
import { BlameLine } from './BlameLine.tsx';
import { ClashCard } from './ClashCard.tsx';
import { ClippingCard } from './ClippingCard.tsx';
import { clipStory, type ClippingSnapshot } from './clipping-data.ts';
import { clashHeads, loadClashCard, type ClashCardData } from './clash-card-data.ts';
import { IntroductionCard } from './IntroductionCard.tsx';
import { introductionHeads, loadIntroduction, type IntroductionCardData } from './introduction-data.ts';
import { legendaryDeeds } from './legendary.ts';
import { HintLine } from './HintLine.tsx';
import { OnStage } from './OnStage.tsx';
import { YourStableSection } from './Stable.tsx';
import type { YourStable } from './stable-lines.ts';
import { supabase } from './supabase.ts';

// The Gutter Herald (#27): opening it calls open-edition, which returns my new "Since You Left" edition
// or, if none is due, my last one plus a Stop press. Older editions (the last 7) are read directly
// under RLS (owner-only). Shapes mirror packages/server/src/herald.ts. When open-edition answers before
// the model has written the edition's words (#38), it says `generating`, and the page rereads the edition
// until it turns `generated`, then swaps the new headlines, standfirsts and bodies in.

type Slot = 'lead' | 'headline' | 'gutter';

/** Stories that play as a set piece: a Clash card, or a Captain's Introduction (#33). */
type SetPiece = 'clash' | 'introduction';
type Playing = { kind: 'clash'; data: ClashCardData } | { kind: 'introduction'; data: IntroductionCardData };

async function setPieceHeads(worldId: string, storyNos: number[]): Promise<Map<number, SetPiece>> {
  const [clashes, intros] = await Promise.all([clashHeads(worldId, storyNos), introductionHeads(worldId, storyNos)]);
  return new Map<number, SetPiece>([...[...clashes].map((no) => [no, 'clash'] as const), ...[...intros].map((no) => [no, 'introduction'] as const)]);
}

async function loadSetPiece(worldId: string, kind: SetPiece, story: { storyNo: number; blameLine: string | null }): Promise<Playing | null> {
  if (kind === 'clash') {
    const data = await loadClashCard(worldId, story.storyNo, story.blameLine);
    return data && { kind, data };
  }
  const data = await loadIntroduction(worldId, story.storyNo);
  return data && { kind, data };
}

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
  /** The edition's one Accusation (#39): from open-edition, or joined up for a back issue read under RLS. */
  accusation?: Accusation | null;
  /** My private "Your Stable" (#36), frozen when the edition was printed (null before #36). */
  stable: YourStable | null;
}

interface Opened {
  edition: Edition;
  created: boolean;
  /** My display name: highlighted wherever a Blame line names me. */
  reader: string;
  stopPress: { storyNo: number; at: string; line: string }[];
  /** The Herald's words are still being written; reread the edition shortly. */
  generating?: boolean;
}

interface EditionRow {
  id: string;
  no: number;
  covers_from: string;
  covers_to: string;
  masthead: Edition['masthead'];
  status: Edition['status'];
  stable: YourStable | null;
  accusation_fact: number | null;
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
const EDITION_COLUMNS =
  'id, no, covers_from, covers_to, masthead, status, stable, accusation_fact, edition_stories (rank, story_no, slot, headline, standfirst, body, blame_line)';
/** Rereads while the words are being written: the job gives up on the model after about 20 s. */
const PICKUP = { everyMs: 3_000, tries: 12 } as const;
/** A lead Clash auto-plays once per edition on this device (D52); after that it's the Watch button. */
const playedKey = (editionId: string) => `orc:lead-played:${editionId}`;
/** A Legendary deed leading the edition gets its fanfare (D52), once per edition on this device. */
const fanfareKey = (editionId: string) => `orc:fanfare:${editionId}`;

/**
 * The Accusations of editions read under RLS (#39): their `accusation_fact`s, shown by the same rule the
 * Herald printed them by (`accusationsFrom`). Keyed by Fact number.
 */
async function loadAccusations(worldId: string, rows: EditionRow[]): Promise<Map<number, Accusation>> {
  const nos = [...new Set(rows.flatMap((r) => (r.accusation_fact === null ? [] : [Number(r.accusation_fact)])))];
  if (nos.length === 0) return new Map();
  const { data: facts } = await supabase
    .from('facts')
    .select('no, story_no, line, payload')
    .eq('world_id', worldId)
    .eq('kind', 'accusation')
    .in('no', nos);
  const found = (facts ?? []) as AccusationFactRow[];
  const accused = [...new Set(found.flatMap((f) => (f.payload.accused ? [f.payload.accused] : [])))];
  if (accused.length === 0) return new Map();
  const [renders, players] = await Promise.all([
    supabase.from('name_renders').select('player_id, accuser_id, clip_key').in('player_id', accused),
    supabase.from('players').select('id, removed_at').eq('world_id', worldId).in('id', accused),
  ]);
  return accusationsFrom(found, (renders.data ?? []) as NameRenderRow[], (players.data ?? []) as { id: string; removed_at: string | null }[]);
}

function fromRow(r: EditionRow, accusations: Map<number, Accusation> = new Map()): Edition {
  return {
    id: r.id,
    no: r.no,
    coversFrom: r.covers_from,
    coversTo: r.covers_to,
    masthead: r.masthead,
    status: r.status,
    stable: r.stable,
    accusation: r.accusation_fact === null ? null : (accusations.get(Number(r.accusation_fact)) ?? null),
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
  const [pieces, setPieces] = useState<Map<number, SetPiece>>(new Map());
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [deeds, setDeeds] = useState<Set<number>>(new Set());
  const [clipped, setClipped] = useState<ClippingSnapshot | { error: string } | null>(null);
  const learn = (heads: Map<number, SetPiece>) => setPieces((known) => new Map([...known, ...heads]));
  const learnDeeds = (found: Set<number>) => setDeeds((known) => new Set([...known, ...found]));

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
        .select(EDITION_COLUMNS)
        .eq('world_id', worldId)
        .order('no', { ascending: false })
        .limit(SHOWN_EDITIONS);
      if (!cancelled && past.data) {
        const rows = past.data as EditionRow[];
        const accusations = await loadAccusations(worldId, rows);
        if (cancelled) return;
        const editions = rows.map((r) => fromRow(r, accusations));
        setArchive(editions);
        const nos = [...new Set(editions.flatMap((e) => e.stories.map((st) => st.storyNo)))];
        const [heads, found] = await Promise.all([setPieceHeads(worldId, nos), legendaryDeeds(worldId, nos)]);
        if (!cancelled) {
          learn(heads);
          learnDeeds(found);
        }
      }
    })();

    /**
     * The lead set piece (D52): a Clash lead plays as its card, a Return or step-in lead as his
     * Introduction (#33), full screen, the first time this edition is opened.
     */
    async function autoPlayLead(edition: Edition) {
      const lead = edition.stories.find((st) => st.slot === 'lead');
      if (!lead) return;
      const nos = edition.stories.map((st) => st.storyNo);
      const [heads, found] = await Promise.all([setPieceHeads(worldId, nos), legendaryDeeds(worldId, nos)]);
      if (cancelled) return;
      learn(heads);
      learnDeeds(found);
      // A Legendary deed always leads, with a fanfare (D52), before its set piece if it has one.
      if (found.has(lead.storyNo) && !localStorage.getItem(fanfareKey(edition.id))) {
        localStorage.setItem(fanfareKey(edition.id), '1');
        void sting('fanfare');
      }
      const kind = heads.get(lead.storyNo);
      if (!kind || localStorage.getItem(playedKey(edition.id))) return;
      const piece = await loadSetPiece(worldId, kind, lead);
      if (cancelled || !piece) return;
      localStorage.setItem(playedKey(edition.id), '1');
      setPlaying(piece);
    }
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  // #38: pick up the generated words when they land (or stop waiting once the job must be over).
  const writing = opened && !('error' in opened) && opened.generating ? opened.edition.id : null;
  useEffect(() => {
    if (!writing) return;
    let tries = 0;
    let busy = false;
    const stop = (fresh: Edition | null) => {
      clearInterval(timer);
      setOpened((o) =>
        o && !('error' in o) && o.edition.id === writing
          ? { ...o, generating: false, edition: fresh ? { ...fresh, accusation: o.edition.accusation } : o.edition }
          : o,
      );
      if (fresh) setArchive((list) => list.map((e) => (e.id === writing ? { ...fresh, accusation: e.accusation } : e)));
    };
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      tries += 1;
      const { data } = await supabase.from('editions').select(EDITION_COLUMNS).eq('id', writing).maybeSingle();
      busy = false;
      const row = data as EditionRow | null;
      if (row?.status === 'generated') stop(fromRow(row));
      else if (tries >= PICKUP.tries) stop(null);
    }, PICKUP.everyMs);
    return () => clearInterval(timer);
  }, [writing]);

  if (opened === null) return <p className="quiet">The Herald is on its way…</p>;
  if ('error' in opened) return <p className="error">{opened.error}</p>;

  const latest = opened.edition;
  const shown = archive.find((e) => e.id === showing) ?? latest;
  // The latest edition as open-edition gave it (with its Accusation, and the generated words once picked up).
  const edition = shown.id === latest.id ? latest : shown;
  const isLatest = edition.id === latest.id;
  const watch = async (story: Story) => {
    const kind = pieces.get(story.storyNo);
    const piece = kind && (await loadSetPiece(worldId, kind, story));
    if (piece) setPlaying(piece);
  };
  // #41: cut any story into a Clipping (frozen server-side), then show it with its Share button.
  const clip = async (story: Story) => {
    try {
      setClipped((await clipStory(worldId, edition.id, story.storyNo)).snapshot);
    } catch (e) {
      setClipped({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section className="herald">
      {/* One set piece on screen at a time: the lead waits for a live card that's playing (#31). */}
      {playing?.kind === 'clash' && (
        <OnStage key={`clash:${playing.data.clash.no}`} name="herald">
          <ClashCard data={playing.data} reader={opened.reader} onDone={() => setPlaying(null)} />
        </OnStage>
      )}
      {playing?.kind === 'introduction' && (
        <OnStage key={`intro:${playing.data.no}`} name="herald">
          <IntroductionCard data={playing.data} onDone={() => setPlaying(null)} />
        </OnStage>
      )}
      {clipped && !('error' in clipped) && <ClippingCard snapshot={clipped} reader={opened.reader} onClose={() => setClipped(null)} />}
      {clipped && 'error' in clipped && (
        <p className="error" role="alert">
          Couldn't clip that: {clipped.error}{' '}
          <button className="link" onClick={() => setClipped(null)}>
            Dismiss
          </button>
        </p>
      )}
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
      {isLatest && opened.generating && <p className="quiet">The subs are still at it. Fresh ink shortly.</p>}
      <EditionView edition={edition} reader={opened.reader} pieces={pieces} deeds={deeds} onWatch={watch} onClip={(s) => void clip(s)} />
      {edition.stable && <HintLine worldId={worldId} hint="stable" />}
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

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

function EditionView({
  edition,
  reader,
  pieces,
  deeds,
  onWatch,
  onClip,
}: {
  edition: Edition;
  reader: string;
  pieces: Map<number, SetPiece>;
  /** Stories that are Legendary deeds (#34). */
  deeds: Set<number>;
  onWatch: (story: Story) => void;
  /** Cuts the story into a Clipping (#41). */
  onClip: (story: Story) => void;
}) {
  const watch = (s: Story) => {
    const kind = pieces.get(s.storyNo);
    return (
      kind && (
        <button className="watch" onClick={() => onWatch(s)}>
          {kind === 'clash' ? 'Watch the Clash' : 'Watch the Introduction'}
        </button>
      )
    );
  };
  const clipButton = (s: Story) => (
    <button className="clip link" onClick={() => onClip(s)} aria-label={`Clip "${s.headline}"`}>
      Clip it
    </button>
  );
  // At most one Accusation per edition (D53), printed above its story's true Blame line.
  const accused = (s: Story) => edition.accusation?.storyNo === s.storyNo && <AccusationQuote accusation={edition.accusation} />;
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
        <div className={`lead${deeds.has(lead.storyNo) ? ' legendary' : ''}`}>
          {deeds.has(lead.storyNo) && <p className="kicker">A Legendary deed</p>}
          <h3>{lead.headline}</h3>
          {lead.standfirst && <p className="standfirst">{lead.standfirst}</p>}
          {lead.body && <p>{lead.body}</p>}
          {accused(lead)}
          {lead.blameLine && <BlameLine line={lead.blameLine} reader={reader} />}
          {watch(lead)}
          {clipButton(lead)}
        </div>
      )}
      {headlines.length > 0 && (
        <ol className="headlines">
          {headlines.map((s) => (
            <li key={s.rank}>
              <h4>{s.headline}</h4>
              {s.standfirst && <p className="standfirst">{s.standfirst}</p>}
              {s.body && <p>{s.body}</p>}
              {accused(s)}
              {s.blameLine && <BlameLine line={s.blameLine} reader={reader} />}
              {watch(s)}
              {clipButton(s)}
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
                {s.blameLine && <BlameLine line={s.blameLine} reader={reader} />}
                {clipButton(s)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {edition.stable && <YourStableSection stable={edition.stable} />}
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
