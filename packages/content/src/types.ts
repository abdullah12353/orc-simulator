// The content bundle's shapes (D46, data-model decision 6). Content ships as TS modules in the repo,
// is bundled into the Edge Functions and the PWA, and is referenced from the DB only by text slugs.
import type { Accent } from './pools.ts';

export type { Accent };

export type CaptainId = string;
export type TemplateId = string;
export type BankKey = string;

/** A Captain's static card. Mutable state (roster, Power drift, Infamy, marks) lives in the DB. */
export interface CastCard {
  id: CaptainId;
  name: string;
  /** Respelling for the voice actor / announcer. */
  sayAs: string;
  accent: Accent;
  /** Starting Power, 1–10. */
  power: number;
  /** Exactly 2, distinct, from TRAITS. */
  traits: [string, string];
  /** The one starting Fear, from FEARS (never replaced). */
  fears: string[];
  catchphrase: string;
  /** Two disguise aliases ("Krúg Bootleg"). */
  aliases: [string, string];
  /** Key into the portrait art; placeholder art until the portrait pipeline ships (#33). */
  portraitKey: string;
  /** One of the 6 Captains who can make Accusations. */
  accuser: boolean;
  /** Starting Epithet (a key into `banks.epithets`); about a third of the cast starts with one. */
  epithet?: BankKey;
}

export interface RoleDef {
  /** Placeholder name used in lines, e.g. `a` for `{a}`. */
  name: string;
  /** Pins the role to one Captain; otherwise any eligible Captain may be cast. */
  captain?: CaptainId;
}

export interface OutcomeDef {
  key: string;
  /** Relative weight in the outcome table (> 0). */
  weight: number;
}

/** One event = one data record (D46). Lines use `{role}` placeholders for Captain names. */
export interface TemplateDef {
  id: TemplateId;
  kind: 'incident';
  trigger: 'ambient';
  roles: RoleDef[];
  outcomes: OutcomeDef[];
  lines: [string, string, string];
  baseWeight: number;
}

/** An Epithet from the prerecorded announcer bank ("the Damp"). */
export interface EpithetDef {
  text: string;
  sayAs: string;
}

// Banks grow with later tickets (Dares, Trophies, Garble ladder, fallback Clash scripts, ...).
export interface Banks {
  /** Grudge tags for the Grudges seeded at casting ("still owes him a pie"). */
  oldHistory: string[];
  epithets: Record<BankKey, EpithetDef>;
}

export interface Content {
  cast: CastCard[];
  templates: TemplateDef[];
  banks: Banks;
}
