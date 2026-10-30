// The content bundle's shapes (D46, data-model decision 6). Content ships as TS modules in the repo,
// is bundled into the Edge Functions and the PWA, and is referenced from the DB only by text slugs.
import type { Accent, Claim } from './pools.ts';

export type { Accent, Claim };

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

/**
 * One event = one data record (D46). Lines use `{role}` placeholders for Captain names, and `{slot}`
 * placeholders for text the sim fills in (a Rumour's `{claim}`).
 */
export interface TemplateDef {
  id: TemplateId;
  /** `rumour` Templates voice a landed Rumour, one per outcome (`rumour.works`, …). */
  kind: 'incident' | 'rumour';
  /** `ambient`: rolled on a tick. `meddle`: a Meddle landing. */
  trigger: 'ambient' | 'meddle';
  roles: RoleDef[];
  /** Non-Captain placeholders the sim fills in. */
  slots?: string[];
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
  /** The Herald's masthead gags (D51). Clean: the Herald never swears. */
  masthead: MastheadBank;
  /**
   * What a Rumour's subject is called in a line, after "his": one entry per Trait and per Fear
   * ("Glutton" → "appetite", "Water" → "fear of water").
   */
  subjects: Record<string, string>;
  /** Absurd subjects only a Garble can swap in, after "his" ("secret goose"). */
  absurdSubjects: Record<BankKey, string>;
  /** Three phrasings per Claim, as what the source supposedly did: "called his {subject} a disgrace". */
  claims: Record<Claim, ClaimDef>;
  /**
   * The Garble escalation ladder, bottom to top (insult → mum → betrayal → coup). A Garble moves a
   * Claim one step up; a Claim that isn't on the ladder enters at the bottom.
   */
  garbleLadder: Claim[];
  /** The Herald's templated Blame line (D53, §4.1). It mocks the Meddle, never the Player. */
  blame: BlameLineBank;
}

/**
 * Blame line templates. `{first}` is "<name> <began>" ("Mo planted a Rumour"); `{middle}` and `{last}`
 * are "<name>'s <noun>" ("Dazza's Dare"), the middle ones joined "A, B and C".
 */
export interface BlameLineBank {
  verbs: Record<'rumour' | 'dare', { began: string; noun: string }>;
  /** One Meddle: `{first}`. */
  one: string;
  /** Two Meddles: `{first}` and `{last}`. */
  two: string;
  /** Three or more: `{first}`, `{middle}` and `{last}`. */
  many: string;
}

export interface ClaimDef {
  /** How the Rumour composer names it. */
  label: string;
  /** 3 phrasings with a `{subject}` placeholder; the Rumour's line variant picks one. */
  phrasings: [string, string, string];
}

export interface MastheadBank {
  /** Orc weekdays, Sunday first (7). */
  days: string[];
  /** Orc months, January first (12). */
  months: string[];
  /** Cover-price gags ("Two teeth, or one good tooth"). */
  prices: string[];
  /** Weather reports. */
  weather: string[];
}

export interface Content {
  cast: CastCard[];
  templates: TemplateDef[];
  banks: Banks;
}
