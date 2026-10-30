import { useEffect, useState } from 'react';
import { ClashCard } from './ClashCard.tsx';
import { clashHeads, loadClashCard, type ClashCardData } from './clash-card-data.ts';
import { loadPlayers } from './hall-data.ts';
import { IntroductionCard } from './IntroductionCard.tsx';
import { OnStage } from './OnStage.tsx';
import { introductionHeads, loadIntroduction, type IntroductionCardData } from './introduction-data.ts';
import { supabase } from './supabase.ts';

// The story a push opened (#42): `/?world=<id>&story=<head no>`. Its lines in order (the head, then what
// followed in the same story), plus its Clash or Introduction card when it has one, which plays at once:
// that's what the push was about. Not checked by hand on a phone.

interface Loaded {
  lines: { no: number; at: string; line: string }[];
  reader: string;
  clash: ClashCardData | null;
  intro: IntroductionCardData | null;
}

async function loadStory(worldId: string, storyNo: number): Promise<Loaded> {
  const [{ data, error }, { players, me }, clashes, intros] = await Promise.all([
    supabase.from('facts').select('no, at, line').eq('world_id', worldId).eq('story_no', storyNo).neq('line', '').order('no'),
    loadPlayers(worldId),
    clashHeads(worldId, [storyNo]),
    introductionHeads(worldId, [storyNo]),
  ]);
  if (error) throw new Error(error.message);
  const [clash, intro] = await Promise.all([
    clashes.has(storyNo) ? loadClashCard(worldId, storyNo) : null,
    intros.has(storyNo) ? loadIntroduction(worldId, storyNo) : null,
  ]);
  return { lines: data ?? [], reader: players.find((p) => p.id === me)?.name ?? '', clash, intro };
}

export function StoryView({ worldId, storyNo, onClose }: { worldId: string; storyNo: number; onClose: () => void }) {
  const [story, setStory] = useState<Loaded | { error: string } | null>(null);
  const [playing, setPlaying] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStory(null);
    void loadStory(worldId, storyNo)
      .then((s) => !cancelled && setStory(s))
      .catch((e: unknown) => !cancelled && setStory({ error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [worldId, storyNo, attempt]);

  if (story === null) return <p className="quiet">…</p>;
  if ('error' in story) {
    return (
      <p className="error" role="alert">
        Couldn't open that story: {story.error}{' '}
        <button className="link" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>{' '}
        <button className="link" onClick={onClose}>
          Back to the fortress
        </button>
      </p>
    );
  }
  if (playing && story.clash) {
    return (
      <OnStage name="story">
        <ClashCard data={story.clash} reader={story.reader} onDone={() => setPlaying(false)} />
      </OnStage>
    );
  }
  if (playing && story.intro) {
    return (
      <OnStage name="story">
        <IntroductionCard data={story.intro} onDone={() => setPlaying(false)} />
      </OnStage>
    );
  }
  return (
    <section className="story-view">
      {story.lines.length === 0 ? (
        <p className="quiet">That story isn't in this fortress's records.</p>
      ) : (
        <ol className="facts">
          {story.lines.map((f) => (
            <li key={f.no}>
              <time dateTime={f.at}>{new Date(f.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
              <span>{f.line}</span>
            </li>
          ))}
        </ol>
      )}
      <p>
        {(story.clash || story.intro) && (
          <button className="link" onClick={() => setPlaying(true)}>
            {story.clash ? 'Watch the Clash again' : 'Watch the Introduction again'}
          </button>
        )}{' '}
        <button onClick={onClose}>Back to the fortress</button>
      </p>
    </section>
  );
}
