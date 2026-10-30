import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from './supabase.ts';
import { inviteLink, MAX_PLAYERS, reasonText, statusText, type InviteStatus } from './invite-link.ts';

interface InviteInfo {
  status: InviteStatus;
  world_id: string | null;
  world_name: string | null;
  player_count: number | null;
}

/** The accept screen for `/join/<token>`: shows the world, then asks for the name used in Blame lines. */
export function JoinWorld({ token, onDone }: { token: string; onDone: (worldId: string | null) => void }) {
  const [info, setInfo] = useState<InviteInfo | { error: string } | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.rpc('invite_info', { token }).then(({ data, error }) => {
      const row = (data as InviteInfo[] | null)?.[0];
      setInfo(error || !row ? { error: reasonText(error) } : row);
    });
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info || 'error' in info) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc('join_world', { token, display_name: displayName });
    setBusy(false);
    if (!error || error.message === 'already_joined') return onDone(info.world_id);
    setError(reasonText(error));
    // The world may have filled up, or the link been revoked, since the screen loaded.
    if (['world_full', 'invite_revoked', 'invite_expired'].includes(error.message)) {
      setInfo({ ...info, status: error.message === 'world_full' ? 'full' : error.message === 'invite_revoked' ? 'revoked' : 'expired' });
    }
  }

  if (info === null) return <main className="page">…</main>;
  return (
    <main className="page">
      <h1>ORC NONSENSE</h1>
      {'error' in info ? (
        <Refused text={info.error} onDone={() => onDone(null)} />
      ) : info.status === 'member' ? (
        <>
          <p>You're already a Player in {info.world_name}.</p>
          <button onClick={() => onDone(info.world_id)}>Open it</button>
        </>
      ) : info.status !== 'ok' ? (
        <Refused text={statusText(info.status)} onDone={() => onDone(null)} />
      ) : (
        <form onSubmit={submit}>
          <h2>Join {info.world_name}</h2>
          <p className="quiet">
            {info.player_count} of {MAX_PLAYERS} Players so far.
          </p>
          <label>
            Your name in the Herald (it's who gets the Blame)
            <input required maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <button disabled={busy}>Join the world</button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </main>
  );
}

function Refused({ text, onDone }: { text: string; onDone: () => void }) {
  return (
    <>
      <p className="error">{text}</p>
      <button className="link" onClick={onDone}>
        Back to my worlds
      </button>
    </>
  );
}

interface InviteRow {
  token: string;
  expires_at: string;
}

/** Invite friends: any Player can create, copy and revoke the world's invite links. */
export function InvitePanel({ worldId }: { worldId: string }) {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [players, setPlayers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    const [inv, pl] = await Promise.all([
      supabase
        .from('invites')
        .select('token, expires_at')
        .eq('world_id', worldId)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }),
      supabase.from('players').select('display_name').eq('world_id', worldId).is('removed_at', null).order('joined_at'),
    ]);
    setInvites(inv.data ?? []);
    setPlayers((pl.data ?? []).map((p) => p.display_name as string));
  }
  useEffect(() => {
    void load();
  }, [worldId]);

  async function create() {
    setError(null);
    const { error } = await supabase.rpc('create_invite', { world_id: worldId });
    if (error) return setError(reasonText(error));
    await load();
  }

  async function revoke(token: string) {
    if (!window.confirm('Revoke this link? Anyone holding it can no longer join.')) return;
    setError(null);
    const { error } = await supabase.rpc('revoke_invite', { token });
    if (error) return setError(reasonText(error));
    await load();
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(token);
    } catch {
      setError('Copy failed: select the link and copy it by hand.');
    }
  }

  const full = players.length >= MAX_PLAYERS;
  return (
    <details className="invites">
      <summary>
        Players ({players.length}/{MAX_PLAYERS}) and invites
      </summary>
      <p>{players.join(', ')}</p>
      {full ? (
        <p className="quiet">The world is full: 8 Players is the most it holds.</p>
      ) : (
        <button onClick={() => void create()}>New invite link</button>
      )}
      <ul>
        {invites.map((i) => (
          <li key={i.token}>
            <input readOnly value={inviteLink(i.token)} onFocus={(e) => e.target.select()} />
            <span className="quiet">
              Works until {new Date(i.expires_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
            <button onClick={() => void copy(i.token)}>{copied === i.token ? 'Copied' : 'Copy'}</button>
            <button className="link" onClick={() => void revoke(i.token)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </details>
  );
}
