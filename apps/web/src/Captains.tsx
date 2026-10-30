import { useEffect, useState } from 'react';
import { ACCENT_LABELS, content, type CastCard } from '@orc/content';
import { Portrait } from './Portrait.tsx';
import { faceAt, type FaceHistory } from './portrait-data.ts';
import { supabase } from './supabase.ts';

// The Captain card screen (#26): every active Captain with portrait, name and Epithet, Traits, Fears,
// Power, Infamy this week and lifetime (#34), the Legendary stamp, roster status (dead ones with their Return time, #32), the Trophies he holds
// (#30), his current Humiliations and disguise alias (#32; on his portrait through the compositor, #33),
// and which one is Warlord. Static card fields come from the
// content bundle; mutable state comes from the world's rows under RLS.

interface CaptainRow {
  id: string;
  roster: 'active' | 'reserve' | 'dead';
  power: number;
  infamy: number;
  traits: string[];
  epithet: string | null;
  alias_idx: 0 | 1 | null;
  returns_at: string | null;
  legendary_fact: number | null;
}

interface Loaded {
  captains: CaptainRow[];
  fears: Map<string, string[]>;
  /** Trophy texts per holder, newest first. */
  trophies: Map<string, string[]>;
  /** Current Humiliation labels per Captain, newest first. */
  humiliations: Map<string, string[]>;
  /** What is on each face now, for the portrait compositor. */
  faces: Map<string, FaceHistory>;
  /** Infamy gained in the last 7 days (what succession and benching go by). */
  week: Map<string, number>;
  warlordId: string | null;
}

const cards = new Map<string, CastCard>(content.cast.map((c) => [c.id, c]));
/** A card shows up to 3 Trophies (#15). */
const SHOWN_TROPHIES = 3;
const ROSTER_LABEL = { active: 'Active', reserve: 'In reserve', dead: 'Dead (awaiting Return)' } as const;

/** "Dead, back around Thu 14:30" for the dead; otherwise the roster label. */
function statusText(c: CaptainRow): string {
  if (c.roster !== 'dead' || !c.returns_at) return ROSTER_LABEL[c.roster];
  const at = new Date(c.returns_at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  return `Dead, back around ${at}`;
}

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
      const [captains, fears, world, trophies, humiliations, week] = await Promise.all([
        supabase.from('captains').select('id, roster, power, infamy, traits, epithet, alias_idx, returns_at, legendary_fact').eq('world_id', worldId),
        supabase.from('captain_fears').select('captain_id, fear, since').eq('world_id', worldId).order('since'),
        supabase.from('worlds').select('warlord_id').eq('id', worldId).single(),
        supabase.from('trophies').select('kind, holder_id').eq('world_id', worldId).order('acquired_at', { ascending: false }).order('no', { ascending: false }),
        supabase
          .from('humiliations')
          .select('captain_id, kind, no, gained_fact')
          .eq('world_id', worldId)
          .is('ended_at', null)
          .order('no', { ascending: false }),
        supabase.from('infamy_7d').select('captain_id, infamy').eq('world_id', worldId),
      ]);
      if (cancelled) return;
      const error = captains.error ?? fears.error ?? world.error ?? trophies.error ?? humiliations.error ?? week.error;
      if (error) return setData({ error: error.message });
      const byCaptain = new Map<string, string[]>();
      for (const f of fears.data ?? []) byCaptain.set(f.captain_id, [...(byCaptain.get(f.captain_id) ?? []), f.fear]);
      const held = new Map<string, string[]>();
      for (const t of trophies.data ?? []) {
        const text = content.banks.trophies[t.kind]?.text ?? t.kind;
        held.set(t.holder_id, [...(held.get(t.holder_id) ?? []), text]);
      }
      const marks = new Map<string, string[]>();
      const faces = new Map<string, FaceHistory>(
        (captains.data ?? []).map((c) => [c.id, { rows: [], legendaryFact: c.legendary_fact === null ? null : Number(c.legendary_fact) }]),
      );
      for (const h of humiliations.data ?? []) {
        const label = content.banks.humiliations[h.kind]?.label ?? h.kind;
        marks.set(h.captain_id, [...(marks.get(h.captain_id) ?? []), label]);
        faces.get(h.captain_id)?.rows.push({ kind: h.kind, no: Number(h.no), gainedFact: Number(h.gained_fact), endedFact: null });
      }
      setData({
        captains: captains.data ?? [],
        fears: byCaptain,
        trophies: held,
        humiliations: marks,
        faces,
        week: new Map((week.data ?? []).map((w: { captain_id: string; infamy: number }) => [w.captain_id, w.infamy])),
        warlordId: world.data?.warlord_id ?? null,
      });
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
          <CaptainCard
            key={c.id}
            captain={c}
            fears={data.fears.get(c.id) ?? []}
            trophies={data.trophies.get(c.id) ?? []}
            humiliations={data.humiliations.get(c.id) ?? []}
            face={data.faces.get(c.id)}
            week={data.week.get(c.id) ?? 0}
            warlord={c.id === data.warlordId}
          />
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
                <CaptainCard
                  key={c.id}
                  captain={c}
                  fears={data.fears.get(c.id) ?? []}
                  trophies={data.trophies.get(c.id) ?? []}
                  humiliations={data.humiliations.get(c.id) ?? []}
                  face={data.faces.get(c.id)}
                  week={data.week.get(c.id) ?? 0}
                  warlord={false}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function CaptainCard({
  captain,
  fears,
  trophies,
  humiliations,
  face,
  week,
  warlord,
}: {
  captain: CaptainRow;
  fears: string[];
  trophies: string[];
  humiliations: string[];
  face: FaceHistory | undefined;
  week: number;
  warlord: boolean;
}) {
  const card = cards.get(captain.id);
  const name = card?.name ?? captain.id;
  // A disguised Captain goes by his alias until he's Unmasked.
  const alias = captain.alias_idx !== null ? card?.aliases[captain.alias_idx] : undefined;
  return (
    <li className={`captain ${captain.roster}${warlord ? ' warlord' : ''}`}>
      <Portrait face={faceAt(captain.id, face)} name={alias ?? name} />
      <div>
        <h3>
          {alias ?? displayName(name, captain.epithet)}
          {warlord && <span className="badge">Warlord</span>}
          {captain.legendary_fact !== null && <span className="badge legendary">Legendary</span>}
        </h3>
        {alias && <p className="quiet">(really {displayName(name, captain.epithet)}, in disguise)</p>}
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
          <dd>
            {week} this week · {captain.infamy} lifetime
          </dd>
          <dt>Status</dt>
          <dd>{warlord ? 'Warlord' : statusText(captain)}</dd>
          <dt>Humiliations</dt>
          <dd>
            {humiliations.length === 0 ? (
              '—'
            ) : (
              <ul className="trophies">
                {humiliations.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Trophies</dt>
          <dd>
            {trophies.length === 0 ? (
              '—'
            ) : (
              <ul className="trophies">
                {trophies.slice(0, SHOWN_TROPHIES).map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
                {trophies.length > SHOWN_TROPHIES && <li>+{trophies.length - SHOWN_TROPHIES} more</li>}
              </ul>
            )}
          </dd>
        </dl>
      </div>
    </li>
  );
}
