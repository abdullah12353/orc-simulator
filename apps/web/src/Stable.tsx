import { useEffect, useState, type FormEvent } from 'react';
import { content } from '@orc/content';
import { displayName } from './Captains.tsx';
import { HintLine } from './HintLine.tsx';
import { reasonText } from './invite-link.ts';
import { goldLine, type GoldChange, type YourStable } from './stable-lines.ts';
import { supabase } from './supabase.ts';

// The Stable (#36): my Stakes (held while the Captain is dead), my gold and my ledger, all owner-only,
// plus who backs whom across the world (public, never how much). Backing debits gold at once through
// submit_intent; the next tick makes the Stake. A withdrawal pays half back at the next tick.
// Also `YourStableSection`, the Herald's frozen private section.

const names = new Map(content.cast.map((c) => [c.id, c.name]));
const nameOf = (id: string) => names.get(id) ?? id;
const POLL_MS = 15_000;
const LEDGER_LINES = 30;

interface CaptainRow {
  id: string;
  roster: 'active' | 'reserve' | 'dead';
  epithet: string | null;
}

interface Loaded {
  me: string;
  gold: number;
  captains: CaptainRow[];
  stakes: { captainId: string; amount: number }[];
  /** Backing still waiting for the next tick: back (amount) or withdraw. */
  queued: { kind: 'back' | 'withdraw'; captainId: string; amount?: number }[];
  ledger: (GoldChange & { id: number; at: string })[];
  /** Who backs whom, world-wide (no amounts): Captain → Players' names. */
  backers: Map<string, string[]>;
}

export function Stable({ worldId }: { worldId: string }) {
  const [data, setData] = useState<Loaded | { error: string } | null>(null);

  async function load() {
    const { data: me } = await supabase.rpc('my_player', { w: worldId });
    const [priv, captains, stakes, queued, ledger, backers, players] = await Promise.all([
      supabase.from('player_private').select('gold').eq('player_id', me).single(),
      supabase.from('captains').select('id, roster, epithet').eq('world_id', worldId),
      supabase.from('stakes').select('captain_id, amount').eq('player_id', me),
      supabase.from('intents').select('kind, payload').eq('player_id', me).eq('status', 'queued').in('kind', ['back', 'withdraw']),
      supabase
        .from('gold_ledger')
        .select('id, at, delta, lost, reason, captain_id, fact_no')
        .eq('player_id', me)
        .order('id', { ascending: false })
        .limit(LEDGER_LINES),
      supabase.from('backers').select('player_id, captain_id').eq('world_id', worldId),
      supabase.from('players').select('id, display_name').eq('world_id', worldId),
    ]);
    const error = priv.error ?? captains.error ?? stakes.error ?? queued.error ?? ledger.error ?? backers.error ?? players.error;
    if (error) return setData({ error: error.message });

    const factNos = [...new Set((ledger.data ?? []).flatMap((l) => (l.fact_no === null ? [] : [l.fact_no])))];
    const lines = new Map<number, string>();
    if (factNos.length > 0) {
      const { data: facts } = await supabase.from('facts').select('no, line').eq('world_id', worldId).in('no', factNos);
      for (const f of facts ?? []) lines.set(f.no, f.line);
    }
    const playerName = new Map((players.data ?? []).map((p) => [p.id, p.display_name as string]));
    const byCaptain = new Map<string, string[]>();
    for (const b of backers.data ?? []) {
      byCaptain.set(b.captain_id, [...(byCaptain.get(b.captain_id) ?? []), b.player_id === me ? 'you' : (playerName.get(b.player_id) ?? 'someone')]);
    }
    setData({
      me,
      gold: priv.data?.gold ?? 0,
      captains: (captains.data ?? []).sort((a, b) => nameOf(a.id).localeCompare(nameOf(b.id))),
      stakes: (stakes.data ?? []).map((s) => ({ captainId: s.captain_id, amount: s.amount })),
      queued: (queued.data ?? []).map((q) => ({ kind: q.kind, captainId: q.payload.captainId, amount: q.payload.amount })),
      ledger: (ledger.data ?? []).map((l) => ({
        id: l.id,
        at: l.at,
        delta: l.delta,
        lost: l.lost,
        reason: l.reason,
        captainId: l.captain_id,
        line: l.fact_no === null ? null : (lines.get(l.fact_no) ?? null),
      })),
      backers: byCaptain,
    });
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [worldId]);

  if (data === null) return <p className="quiet">…</p>;
  if ('error' in data) return <p className="error">{data.error}</p>;

  const captain = (id: string) => data.captains.find((c) => c.id === id);
  const label = (id: string) => displayName(nameOf(id), captain(id)?.epithet ?? null);
  return (
    <section className="stable">
      <h2>Your Stable</h2>
      <HintLine worldId={worldId} hint="stable" />
      <p className="gold">
        <strong>{data.gold}</strong> gold <span className="quiet">(banks up to 30; 10 more at midnight)</span>
      </p>
      <HintLine worldId={worldId} hint="backing" />
      <BackForm worldId={worldId} data={data} label={label} onDone={() => void load()} />

      <h3>Your Stakes</h3>
      {data.stakes.length === 0 && data.queued.length === 0 && <p className="quiet">You back nobody. Yet.</p>}
      <ul className="stakes">
        {data.stakes.map((s) => (
          <StakeRow
            key={s.captainId}
            worldId={worldId}
            label={label(s.captainId)}
            captainId={s.captainId}
            amount={s.amount}
            held={captain(s.captainId)?.roster === 'dead'}
            withdrawing={data.queued.some((q) => q.kind === 'withdraw' && q.captainId === s.captainId)}
            onDone={() => void load()}
          />
        ))}
        {data.queued
          .filter((q) => q.kind === 'back')
          .map((q, i) => (
            <li key={`q${i}`} className="quiet">
              {q.amount} gold on {label(q.captainId)}: lands at the next tick
            </li>
          ))}
      </ul>

      <h3>Gold</h3>
      {data.ledger.length === 0 ? (
        <p className="quiet">No gold has moved yet.</p>
      ) : (
        <ul className="ledger">
          {data.ledger.map((l) => (
            <li key={l.id} className={l.delta < 0 ? 'debit' : 'credit'}>
              {goldLine(l, label)}
            </li>
          ))}
        </ul>
      )}

      <h3>Who backs whom</h3>
      {data.backers.size === 0 ? (
        <p className="quiet">Nobody backs anybody.</p>
      ) : (
        <ul className="backers">
          {[...data.backers]
            .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b)))
            .map(([id, who]) => (
              <li key={id}>
                {label(id)}: backed by {who.join(', ')}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function BackForm({ worldId, data, label, onDone }: { worldId: string; data: Loaded; label: (id: string) => string; onDone: () => void }) {
  const [captainId, setCaptainId] = useState('');
  const [amount, setAmount] = useState(5);
  // One id per draft: a retry after a network blip resubmits the same id and can't double-debit.
  const [draftId, setDraftId] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<'idle' | 'sending' | { sent: string } | { error: string }>('idle');
  const pickable = data.captains.filter((c) => c.roster !== 'reserve');
  const ready = Boolean(captainId) && Number.isInteger(amount) && amount >= 1 && amount <= data.gold;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setState('sending');
    const { error } = await supabase.rpc('submit_intent', { id: draftId, world_id: worldId, kind: 'back', payload: { captainId, amount } });
    if (error) return setState({ error: reasonText(error) });
    setState({ sent: `${amount} gold on ${label(captainId)}. Everyone will know you back him; nobody will know how much.` });
    setDraftId(crypto.randomUUID());
    onDone();
  }

  return (
    <form onSubmit={submit} className="back-form">
      <label>
        Back a Captain
        <select value={captainId} onChange={(e) => setCaptainId(e.target.value)} required>
          <option value="">Pick a Captain</option>
          {pickable.map((c) => (
            <option key={c.id} value={c.id}>
              {label(c.id)}
              {c.roster === 'dead' ? ' (dead: held till he returns)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Gold
        <input type="number" min={1} max={Math.max(1, data.gold)} step={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
      </label>
      <button disabled={!ready || state === 'sending'}>{data.gold > 0 ? 'Back him' : 'No gold left'}</button>
      <p className="quiet">Each win pays 10% of your Stake, each point of Infamy 1%. Idiots pay best.</p>
      {typeof state === 'object' && 'sent' in state && <p className="quiet">{state.sent}</p>}
      {typeof state === 'object' && 'error' in state && <p className="error">{state.error}</p>}
    </form>
  );
}

function StakeRow(props: {
  worldId: string;
  captainId: string;
  label: string;
  amount: number;
  held: boolean;
  withdrawing: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  async function withdraw() {
    if (!window.confirm(`Pull your ${props.amount} gold off ${props.label}? You get half back (${Math.floor(props.amount / 2)}).`)) return;
    const { error } = await supabase.rpc('submit_intent', {
      id: crypto.randomUUID(),
      world_id: props.worldId,
      kind: 'withdraw',
      payload: { captainId: props.captainId },
    });
    if (error) return setError(reasonText(error));
    props.onDone();
  }
  return (
    <li>
      {props.label}: <strong>{props.amount}</strong> gold
      {props.held && <span className="quiet"> · held (he's dead; it resumes when he returns)</span>}
      {props.withdrawing ? (
        <span className="quiet"> · withdrawing at the next tick</span>
      ) : (
        <button className="link" onClick={() => void withdraw()}>
          Withdraw (half back)
        </button>
      )}
      {error && <span className="error"> {error}</span>}
    </li>
  );
}

/** The Herald's private "Your Stable", exactly as it was frozen into the edition. */
export function YourStableSection({ stable }: { stable: YourStable }) {
  return (
    <aside className="your-stable">
      <h3>Your Stable</h3>
      <p>
        <strong>{stable.gold}</strong> gold · <strong>{stable.meddles}</strong> {stable.meddles === 1 ? 'Meddle' : 'Meddles'} left
        {stable.pendingMeddles > 0 && <span className="quiet"> · {stable.pendingMeddles} on the way</span>}
      </p>
      {stable.goldChanges.length > 0 && (
        <ul className="ledger">
          {stable.goldChanges.map((g, i) => (
            <li key={i} className={g.delta < 0 ? 'debit' : 'credit'}>
              {goldLine(g, nameOf)}
            </li>
          ))}
        </ul>
      )}
      {stable.stakes.length > 0 && (
        <p>
          Backing:{' '}
          {stable.stakes.map((s, i) => (
            <span key={s.captainId}>
              {i > 0 && ', '}
              {nameOf(s.captainId)} ({s.amount}
              {s.held ? ', held' : ''})
            </span>
          ))}
        </p>
      )}
      {stable.meddlesLanded.length > 0 && (
        <>
          <p>Your Meddles that landed:</p>
          <ul>
            {stable.meddlesLanded.map((m) => (
              <li key={m.meddleId}>{m.line}</li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
