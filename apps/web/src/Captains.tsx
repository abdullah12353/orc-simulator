import { useEffect, useState } from 'react';
import { ACCENT_LABELS, content, type CastCard } from '@orc/content';
import { Portrait } from './Portrait.tsx';
import { supabase } from './supabase.ts';

// The Captain card screen (#26): every active Captain with portrait, name and Epithet, Traits, Fears,
// Power, lifetime Infamy and roster status, and which one is Warlord. Static card fields come from the
// content bundle; mutable state comes from the world's rows under RLS.

interface CaptainRow {
  id: string;
  roster: 'active' | 'reserve' | 'dead';
  power: number;
  infamy: number;
  traits: string[];
  epithet: string | null;
}

interface Loaded {
  captains: CaptainRow[];
  fears: Map<string, string[]>;
  warlordId: string | null;
}

const cards = new Map<string, CastCard>(content.cast.map((c) => [c.id, c]));
const ROSTER_LABEL = { active: 'Active', reserve: 'In reserve', dead: 'Dead (awaiting Return)' } as const;

export function displayName(name: string, epithet: string | null): string {
  const text = epithet ? content.banks.epithets[epithet]?.text : undefined;
  return text ? `${name} ${text}` : name;
}

export function Captains({ worldId }: { worldId: string }) {
  const [data, setData] = useState<Loaded | { error: string } | null>(null);
  const [showReserve, setShowReserve] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [captains, fears, world] = await Promise.all([
        supabase.from('captains').select('id, roster, power, infamy, traits, epithet').eq('world_id', worldId),
        supabase.from('captain_fears').select('captain_id, fear, since').eq('world_id', worldId).order('since'),
        supabase.from('worlds').select('warlord_id').eq('id', worldId).single(),
      ]);
      if (cancelled) return;
      const error = captains.error ?? fears.error ?? world.error;
      if (error) return setData({ error: error.message });
      const byCaptain = new Map<string, string[]>();
      for (const f of fears.data ?? []) byCaptain.set(f.captain_id, [...(byCaptain.get(f.captain_id) ?? []), f.fear]);
      setData({ captains: captains.data ?? [], fears: byCaptain, warlordId: world.data?.warlord_id ?? null });
    })();
    return () => {
      cancelled = true;
    };
  }, [worldId]);

  if (data === null) return <p className="quiet">…</p>;
  if ('error' in data) return <p className="error">{data.error}</p>;

  // The Warlord first, then by Power, then by name.
  const order = (a: CaptainRow, b: CaptainRow) =>
    Number(b.id === data.warlordId) - Number(a.id === data.warlordId) ||
    b.power - a.power ||
    (cards.get(a.id)?.name ?? a.id).localeCompare(cards.get(b.id)?.name ?? b.id);
  const active = data.captains.filter((c) => c.roster === 'active').sort(order);
  const others = data.captains.filter((c) => c.roster !== 'active').sort(order);
  const warlord = data.captains.find((c) => c.id === data.warlordId);

  return (
    <section>
      <h2>The active twelve</h2>
      {warlord && (
        <p className="quiet">
          Ruling the fortress: <strong>{displayName(cards.get(warlord.id)?.name ?? warlord.id, warlord.epithet)}</strong>
        </p>
      )}
      <ul className="captains">
        {active.map((c) => (
          <CaptainCard key={c.id} captain={c} fears={data.fears.get(c.id) ?? []} warlord={c.id === data.warlordId} />
        ))}
      </ul>
      {others.length > 0 && (
        <>
          <button className="link" onClick={() => setShowReserve((s) => !s)}>
            {showReserve ? 'Hide' : 'Show'} the other {others.length} (reserve and dead)
          </button>
          {showReserve && (
            <ul className="captains">
              {others.map((c) => (
                <CaptainCard key={c.id} captain={c} fears={data.fears.get(c.id) ?? []} warlord={false} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CaptainCard({ captain, fears, warlord }: { captain: CaptainRow; fears: string[]; warlord: boolean }) {
  const card = cards.get(captain.id);
  const name = card?.name ?? captain.id;
  return (
    <li className={`captain ${captain.roster}${warlord ? ' warlord' : ''}`}>
      <Portrait portraitKey={card?.portraitKey ?? captain.id} name={name} />
      <div>
        <h3>
          {displayName(name, captain.epithet)}
          {warlord && <span className="badge">Warlord</span>}
        </h3>
        {card && (
          <p className="quiet">
            {ACCENT_LABELS[card.accent]} · says it “{card.sayAs}” · “{card.catchphrase}”
          </p>
        )}
        <dl>
          <dt>Traits</dt>
          <dd>{captain.traits.join(', ')}</dd>
          <dt>Fears</dt>
          <dd>{fears.join(', ') || '—'}</dd>
          <dt>Power</dt>
          <dd>{captain.power}</dd>
          <dt>Infamy</dt>
          <dd>{captain.infamy}</dd>
          <dt>Status</dt>
          <dd>{warlord ? 'Warlord' : ROSTER_LABEL[captain.roster]}</dd>
        </dl>
      </div>
    </li>
  );
}
