// The content bundle's shapes (D46, data-model decision 6). Content ships as TS modules in the repo,
// is bundled into the Edge Functions and the PWA, and is referenced from the DB only by text slugs.

export type CaptainId = string;
export type TemplateId = string;
export type BankKey = string;

/** A Captain's static card. Mutable state (roster, Power drift, Infamy, marks) lives in the DB. */
export interface CastCard {
  id: CaptainId;
  name: string;
  /** Respelling for the voice actor / announcer. */
  sayAs: string;
  accent: string;
  /** Starting Power, 1–10. */
  power: number;
  traits: [string, string];
  /** Starting Fears (never replaced). */
  fears: string[];
  catchphrase: string;
  /** Two disguise aliases ("Krúg Bootleg"). */
  aliases: [string, string];
  portraitKey: string;
  /** One of the 6 Captains who can make Accusations. */
  accuser: boolean;
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

// Banks grow with later tickets (Dares, Trophies, Garble ladder, fallback Clash scripts, ...).
export type Banks = Record<string, never>;

export interface Content {
  cast: CastCard[];
  templates: TemplateDef[];
  banks: Banks;
}
