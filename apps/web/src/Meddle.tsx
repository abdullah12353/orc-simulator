import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CLAIMS, content, subjectText, type Claim } from '@orc/content';
import { DarePicker } from './DarePicker.tsx';
import { loadMeddle, meddleLabel, type MeddleData, type Subject } from './meddle-data.ts';
import { suggestRumour } from './first-open.ts';
import { reasonText } from './invite-link.ts';
import { supabase } from './supabase.ts';
import { isLoaded, useWorldLoad } from './world-load.ts';

// The Rumour composer (#28): pick who supposedly said it, who it's about, one of the 5 Claims and a
// subject from the target's own Traits, Fears or Trophies, plus optional words of your own. Submitting
// debits a Meddle at once (submit_intent), so the count is always honest. The Meddle stays secret
// until it lands; the tick refunds it if the sim rejects it.
// On a first open (#43, D58) the composer is guided: the picks come filled in (`suggestRumour`), and a
// Player's first Meddle is sent with `firstMeddle`, so it lands in 2–5 minutes (submit_intent only honours
// it once). The guided Rumour comes first; Dares are one tap away ("Set a Dare instead"), which ends the
// guided step, so they're never out of reach.

const POLL_MS = 15_000;
const MAX_FREE_TEXT = 200;

export function Meddle({
  worldId,
  guided = false,
  onSent,
  onSkipGuide,
}: {
  worldId: string;
  /** The first open's guided Rumour (#43). */
  guided?: boolean;
  /** The (guided) Rumour went off. */
  onSent?: () => void;
  /** The Player would rather set a Dare: ends the guided step. */
  onSkipGuide?: () => void;
}) {
  const { state: data, reload, patch } = useWorldLoad(worldId, loadMeddle, { pollMs: POLL_MS });
  // A first Meddle already sent (from another device, say) leaves nothing to guide.
  const sentBefore = isLoaded(data) && data.firstMeddleDone;
  useEffect(() => {
    if (guided && sentBefore) onSkipGuide?.();
  }, [guided, sentBefore]);

  if (data === null) return <p className="quiet">…</p>;
  if ('error' in data) return <p className="error">{data.error}</p>;
  const submitted = (left: number) => {
    patch((d) => ({ ...d, meddlesLeft: left, firstMeddleDone: true, pending: d.pending + 1 }));
    reload();
  };
  return (
    <>
      <RumourComposer
        worldId={worldId}
        data={data}
        guided={guided}
        onSubmitted={(left) => {
          submitted(left);
          onSent?.();
        }}
      />
      {guided ? (
        <p className="quiet">
          <button className="link" onClick={onSkipGuide}>
            Set a Dare instead
          </button>
        </p>
      ) : (
        <DarePicker worldId={worldId} data={data} onSubmitted={submitted} />
      )}
    </>
  );
}

function RumourComposer({
  worldId,
  data,
  guided,
  onSubmitted,
}: {
  worldId: string;
  data: MeddleData;
  guided: boolean;
  onSubmitted: (meddlesLeft: number) => void;
}) {
  const active = data.captains.filter((c) => c.roster !== 'reserve');
  const [suggested] = useState(() => (guided ? suggestRumour(data.captains, data.warlordId) : null));
  const [source, setSource] = useState(suggested?.source ?? '');
  const [target, setTarget] = useState(suggested?.target ?? '');
  const [claim, setClaim] = useState<Claim>(suggested?.claim ?? 'insult');
  const [subjectKey, setSubjectKey] = useState(suggested ? `${suggested.subject.from}:${suggested.subject.key}` : '');
  const [freeText, setFreeText] = useState('');
  // One id per draft: a retry after a network blip resubmits the same id and can't double-debit.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<'idle' | 'sending' | { sent: string } | { error: string }>('idle');

  const targetRow = active.find((c) => c.id === target);
  // US34: drawn from the target's Traits, Fears or Trophies.
  const subjects: Subject[] = useMemo(
    () =>
      targetRow
        ? [
            ...targetRow.traits.map((key) => ({ from: 'trait' as const, key })),
            ...(data.fears.get(targetRow.id) ?? []).map((key) => ({ from: 'fear' as const, key })),
            ...[...new Set(data.trophies.get(targetRow.id) ?? [])].map((key) => ({ from: 'trophy' as const, key })),
          ]
        : [],
    [targetRow, data.fears, data.trophies],
  );
  const subject = subjects.find((s) => `${s.from}:${s.key}` === subjectKey) ?? subjects[0];
  const label = meddleLabel(data);
  const preview =
    source && target && subject
      ? `${label(source)} ${content.banks.claims[claim].phrasings[0].replace('{subject}', subjectText(content, subject))}.`
      : null;
  const ready = Boolean(source && target && source !== target && subject) && data.meddlesLeft > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !subject) return;
    setState('sending');
    const text = freeText.trim();
    const { data: rows, error } = await supabase.rpc('submit_intent', {
      id: draftId,
      world_id: worldId,
      kind: 'rumour',
      payload: { source, target, claim, subject, firstMeddle: !data.firstMeddleDone, ...(text ? { freeText: text } : {}) },
    });
    if (error) return setState({ error: reasonText(error) });
    const left = (rows as { meddles_left: number }[])[0]?.meddles_left ?? data.meddlesLeft - 1;
    const when = data.firstMeddleDone ? 'in a while' : 'in a few minutes';
    setState({ sent: `Planted. It will reach ${label(target)} ${when}. Nobody knows it was you, yet.` });
    setDraftId(crypto.randomUUID());
    setFreeText('');
    onSubmitted(left);
  }

  return (
    <section>
      <h2>{guided ? 'Plant your first Rumour' : 'Plant a Rumour'}</h2>
      {guided && <p className="hint">We've picked a juicy one for you. Change anything you like, then plant it.</p>}
      <p className="meddles-left">
        <strong>{data.meddlesLeft}</strong> {data.meddlesLeft === 1 ? 'Meddle' : 'Meddles'} left
        {data.pending > 0 && <span className="quiet"> · {data.pending} on the way</span>}
      </p>
      <form onSubmit={submit} className="composer">
        <label>
          Who supposedly said it
          <select value={source} onChange={(e) => setSource(e.target.value)} required>
            <option value="">Pick a Captain</option>
            {active.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id === target}>
                {label(c.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Who it's about
          <select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              setSubjectKey('');
            }}
            required
          >
            <option value="">Pick a Captain</option>
            {active.map((c) => (
              <option key={c.id} value={c.id} disabled={c.id === source}>
                {label(c.id)}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="claims">
          <legend>The Claim</legend>
          {CLAIMS.map((c) => (
            <label key={c}>
              <input type="radio" name="claim" value={c} checked={claim === c} onChange={() => setClaim(c)} />
              {content.banks.claims[c].label}
            </label>
          ))}
        </fieldset>
        <label>
          About his…
          <select value={subject ? `${subject.from}:${subject.key}` : ''} onChange={(e) => setSubjectKey(e.target.value)} disabled={!targetRow}>
            {subjects.map((s) => (
              <option key={`${s.from}:${s.key}`} value={`${s.from}:${s.key}`}>
                {subjectText(content, s)} ({s.from === 'trait' ? `Trait: ${s.key}` : s.from === 'fear' ? `Fear: ${s.key}` : 'Trophy'})
              </option>
            ))}
          </select>
        </label>
        <label>
          In your own words (optional)
          <input maxLength={MAX_FREE_TEXT} value={freeText} onChange={(e) => setFreeText(e.target.value)} placeholder="his helmet is a bucket" />
        </label>
        {preview && <p className="preview">“{preview}”</p>}
        <button disabled={!ready || state === 'sending'}>{data.meddlesLeft > 0 ? 'Plant it (1 Meddle)' : 'No Meddles left today'}</button>
        {typeof state === 'object' && 'sent' in state && <p className="quiet">{state.sent}</p>}
        {typeof state === 'object' && 'error' in state && <p className="error">{state.error}</p>}
      </form>
    </section>
  );
}
