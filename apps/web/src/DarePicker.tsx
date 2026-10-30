import { useState, type FormEvent } from 'react';
import { content, dareOffers, playsOnFear, SURPRISE, subjectText } from '@orc/content';
import { displayName } from './Captains.tsx';
import { reasonText } from './invite-link.ts';
import { supabase } from './supabase.ts';

// The Dare picker (#35): pick a Captain, then one of 3 Dares offered for him (a Stunt and a Prank among
// them) or "surprise". A Prank also names its victim. "Show me others" offers the next 3. A Dare that plays
// on one of his Fears says so. Submitting debits a Meddle at once; the tick refunds a Dare the sim rejects.

const names = new Map(content.cast.map((c) => [c.id, c.name]));

export interface DarePickerData {
  meddlesLeft: number;
  captains: { id: string; roster: 'active' | 'reserve' | 'dead'; traits: string[]; epithet: string | null }[];
  fears: Map<string, string[]>;
  warlordId: string | null;
}

export function DarePicker({
  worldId,
  data,
  onSubmitted,
}: {
  worldId: string;
  data: DarePickerData;
  onSubmitted: (meddlesLeft: number) => void;
}) {
  const active = data.captains.filter((c) => c.roster !== 'reserve');
  const [target, setTarget] = useState('');
  const [round, setRound] = useState(0);
  const [dareKey, setDareKey] = useState('');
  const [victim, setVictim] = useState('');
  // One id per draft: a retry after a network blip resubmits the same id and can't double-debit.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<'idle' | 'sending' | { sent: string } | { error: string }>('idle');

  const targetRow = active.find((c) => c.id === target);
  const fears = targetRow ? (data.fears.get(targetRow.id) ?? []) : [];
  const offers = targetRow ? dareOffers(content, targetRow, round) : [];
  const chosen = dareKey && dareKey !== SURPRISE ? content.banks.dares[dareKey] : undefined;
  const isPrank = chosen?.kind === 'prank';
  const label = (id: string) => {
    const row = active.find((c) => c.id === id);
    return displayName(names.get(id) ?? id, row?.epithet ?? null) + (id === data.warlordId ? ' (Warlord)' : '') + (row?.roster === 'dead' ? ' (dead)' : '');
  };
  const fearNote = (key: string) => {
    const fear = fears.find((f) => content.banks.dares[key]!.tags.includes(f));
    return fear ? ` · plays on his ${subjectText(content, { from: 'fear', key: fear })}` : '';
  };
  const preview = (() => {
    if (!targetRow || !dareKey) return null;
    if (dareKey === SURPRISE) return `Dare ${label(target)} to… something. You'll find out with everyone else.`;
    if (!chosen || (isPrank && !victim)) return null;
    return `Dare ${label(target)} to ${chosen.text.replace('{victim}', names.get(victim) ?? victim)}.`;
  })();
  const ready = Boolean(targetRow && dareKey && (!isPrank || (victim && victim !== target))) && data.meddlesLeft > 0;

  function pickTarget(id: string) {
    setTarget(id);
    setRound(0);
    setDareKey('');
    if (victim === id) setVictim('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setState('sending');
    const { data: rows, error } = await supabase.rpc('submit_intent', {
      id: draftId,
      world_id: worldId,
      kind: 'dare',
      payload: { target, dareKey, ...(isPrank ? { victim } : {}) },
    });
    if (error) return setState({ error: reasonText(error) });
    const left = (rows as { meddles_left: number }[])[0]?.meddles_left ?? data.meddlesLeft - 1;
    setState({ sent: `Dared. ${label(target)} will hear about it in a while. Nobody knows it was you, yet.` });
    setDraftId(crypto.randomUUID());
    setDareKey('');
    onSubmitted(left);
  }

  return (
    <section>
      <h2>Set a Dare</h2>
      <form onSubmit={submit} className="composer">
        <label>
          Who you're daring
          <select value={target} onChange={(e) => pickTarget(e.target.value)} required>
            <option value="">Pick a Captain</option>
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {label(c.id)}
              </option>
            ))}
          </select>
        </label>
        {targetRow && (
          <fieldset className="dares">
            <legend>The Dare</legend>
            {offers.map((key) => {
              const def = content.banks.dares[key]!;
              return (
                <label key={key}>
                  <input type="radio" name="dare" value={key} checked={dareKey === key} onChange={() => setDareKey(key)} />
                  {def.label} <span className="quiet">({def.kind === 'prank' ? 'Prank' : 'Stunt'}{playsOnFear(def, fears) ? fearNote(key) : ''})</span>
                </label>
              );
            })}
            <label>
              <input type="radio" name="dare" value={SURPRISE} checked={dareKey === SURPRISE} onChange={() => setDareKey(SURPRISE)} />
              Surprise me
            </label>
            <button
              type="button"
              onClick={() => {
                setRound(round + 1);
                if (dareKey !== SURPRISE) setDareKey('');
              }}
            >
              Show me others
            </button>
          </fieldset>
        )}
        {isPrank && (
          <label>
            Who gets pranked
            <select value={victim} onChange={(e) => setVictim(e.target.value)} required>
              <option value="">Pick a victim</option>
              {active
                .filter((c) => c.id !== target)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {label(c.id)}
                  </option>
                ))}
            </select>
          </label>
        )}
        {preview && <p className="preview">“{preview}”</p>}
        <button disabled={!ready || state === 'sending'}>
          {data.meddlesLeft > 0 ? 'Dare him (1 Meddle)' : 'No Meddles left today'}
        </button>
        {typeof state === 'object' && 'sent' in state && <p className="quiet">{state.sent}</p>}
        {typeof state === 'object' && 'error' in state && <p className="error">{state.error}</p>}
      </form>
    </section>
  );
}
