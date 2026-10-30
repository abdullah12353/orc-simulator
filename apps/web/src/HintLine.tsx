// A one-line hint (#43), shown the first time the Player meets Dares, Backing or their Stable, never again.
import { HINTS, type Hint } from './first-open.ts';
import { useHint } from './first-open-data.ts';

export function HintLine({ worldId, hint }: { worldId: string; hint: Hint }) {
  const show = useHint(worldId, hint);
  return show ? <p className="hint">{HINTS[hint]}</p> : null;
}
