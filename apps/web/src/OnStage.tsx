// The React side of the one stage (stage.ts, #31): a full-screen card renders only on its turn, so the
// Herald's lead, live cards, Hall replays and a pushed story never play over each other. The card's own
// player starts when it mounts, so a card waiting its turn loses none of its beats.
import { useEffect, useId, useSyncExternalStore, type ReactNode } from 'react';
import { stage } from './stage.ts';

const subscribe = (onChange: () => void) => stage.subscribe(onChange);

export function OnStage({ name, children }: { name: string; children: ReactNode }) {
  const id = `${name}:${useId()}`;
  useEffect(() => {
    stage.request(id);
    return () => stage.release(id);
  }, [id]);
  const turn = useSyncExternalStore(subscribe, () => stage.current() === id);
  return turn ? <>{children}</> : null;
}
