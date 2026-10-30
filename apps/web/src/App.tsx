import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Captains } from './Captains.tsx';
import { Herald } from './Herald.tsx';
import { Meddle } from './Meddle.tsx';
import { supabase } from './supabase.ts';
import { clearPendingInvite, pendingInvite } from './invite-link.ts';
import { InvitePanel, JoinWorld } from './Invites.tsx';

// Tracer-bullet screens (#24): magic-link sign-in, create a world, and a bare list of the world's
// Fact lines, newest first. Live refresh over Realtime arrives with #31; until then we poll.
const POLL_MS = 10_000;

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [invite, setInvite] = useState<string | null>(pendingInvite);
  const [joined, setJoined] = useState<string | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main className="page">…</main>;
  if (!session) return <SignIn invite={invite} />;
  if (invite) {
    return (
      <JoinWorld
        token={invite}
        onDone={(worldId) => {
          clearPendingInvite();
          setInvite(null);
          setJoined(worldId ?? undefined);
        }}
      />
    );
  }
  return <Worlds key={joined} initial={joined} />;
}

function SignIn({ invite }: { invite: string | null }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Back to the invite after sign-in. If Auth doesn't allow that URL it falls back to the site
      // URL, and the remembered invite (localStorage) still opens the accept screen.
      options: { emailRedirectTo: invite ? `${window.location.origin}/join/${invite}` : window.location.origin },
    });
    setState(error ? { error: error.message } : 'sent');
  }

  return (
    <main className="page">
      <h1>ORC NONSENSE</h1>
      {invite && state !== 'sent' && <p>You've been invited to a fortress. Sign in with your email to join.</p>}
      {state === 'sent' ? (
        <p>Check your email for the magic link.</p>
      ) : (
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <button disabled={state === 'sending'}>Send me a magic link</button>
          {typeof state === 'object' && <p className="error">{state.error}</p>}
        </form>
      )}
    </main>
  );
}

interface WorldRow {
  id: string;
  name: string;
}

function Worlds({ initial }: { initial?: string }) {
  const [worlds, setWorlds] = useState<WorldRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(initial ?? null);

  async function load() {
    const { data } = await supabase.from('worlds').select('id, name').order('created_at');
    setWorlds(data ?? []);
    if (data && data.length > 0) setSelected((s) => s ?? data[0]!.id);
  }
  useEffect(() => {
    void load();
  }, []);

  if (worlds === null) return <main className="page">…</main>;
  return (
    <main className="page">
      <header className="bar">
        <h1>ORC NONSENSE</h1>
        <button className="link" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </header>
      {worlds.length > 1 && (
        <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
          {worlds.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}
      {selected && <InvitePanel key={selected} worldId={selected} />}
      {selected ? <WorldTabs worldId={selected} /> : <CreateWorld onCreated={(id) => void load().then(() => setSelected(id))} />}
    </main>
  );
}

function WorldTabs({ worldId }: { worldId: string }) {
  const [tab, setTab] = useState<'herald' | 'meddle' | 'captains' | 'facts'>('herald');
  return (
    <>
      <nav className="tabs">
        <button className={tab === 'herald' ? 'on' : ''} onClick={() => setTab('herald')}>
          The Herald
        </button>
        <button className={tab === 'meddle' ? 'on' : ''} onClick={() => setTab('meddle')}>
          Meddle
        </button>
        <button className={tab === 'captains' ? 'on' : ''} onClick={() => setTab('captains')}>
          Captains
        </button>
        <button className={tab === 'facts' ? 'on' : ''} onClick={() => setTab('facts')}>
          What happened
        </button>
      </nav>
      {tab === 'herald' && <Herald worldId={worldId} />}
      {tab === 'meddle' && <Meddle worldId={worldId} />}
      {tab === 'captains' && <Captains worldId={worldId} />}
      {tab === 'facts' && <FactLines worldId={worldId} />}
    </>
  );
}

function CreateWorld({ onCreated }: { onCreated: (worldId: string) => void }) {
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.functions.invoke<{ worldId: string }>('create-world', {
      body: { name, displayName },
    });
    setBusy(false);
    if (error || !data) return setError(error?.message ?? 'Could not create the world.');
    onCreated(data.worldId);
  }

  return (
    <form onSubmit={submit}>
      <h2>Found a fortress</h2>
      <label>
        World name
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Your name in the Herald
        <input required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <button disabled={busy}>Create world</button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

interface FactRow {
  no: number;
  at: string;
  line: string;
}

function FactLines({ worldId }: { worldId: string }) {
  const [facts, setFacts] = useState<FactRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from('facts')
        .select('no, at, line')
        .eq('world_id', worldId)
        .neq('line', '')
        .order('at', { ascending: false })
        .order('no', { ascending: false })
        .limit(200);
      if (!cancelled && data) setFacts(data);
    }
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [worldId]);

  if (facts.length === 0) return <p className="quiet">Nothing has happened yet. Give it a few ticks.</p>;
  return (
    <ol className="facts">
      {facts.map((f) => (
        <li key={f.no}>
          <time dateTime={f.at}>{new Date(f.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time>
          <span>{f.line}</span>
        </li>
      ))}
    </ol>
  );
}
