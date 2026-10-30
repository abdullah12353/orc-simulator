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
  /**
   * Reaction Templates: cast this role from the parent Fact's role of this name (a Clash offers `a`, `b`,
   * `winner`, `loser` and `saviour`; a Rumour `source`, `target` and `reached`; an incident its roles).
   */
  from?: string;
  /** Cast precondition: the Captain must have this Trait. */
  trait?: string;
}

/** What a reaction Template follows (D46 trigger `reaction`), and how likely it is to. */
export interface AfterDef {
  /** The parent Fact's kind: `incident`, `rumour` or `clash`. */
  kind: 'incident' | 'rumour' | 'clash';
  /** Only after these outcomes (an incident's outcome key, a Rumour's or a Clash's outcome). Omit for any. */
  outcomes?: string[];
  /** Chance it follows a matching parent, 0–1. Halved if the Template ran in the last 24 h. */
  chance: number;
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
  /**
   * `rumour` Templates voice a landed Rumour, one per outcome (`rumour.works`, …). `clash` Templates start
   * a Clash and voice its headline: their lines get the `{tag}` and `{result}` slots (see `ClashBanks`).
   */
  kind: 'incident' | 'rumour' | 'clash';
  /**
   * `ambient`: rolled on a tick. `meddle`: a Meddle landing. `grudge`: the Grudge Clash roll (one Template,
   * roles `a` and `b`). `reaction`: follows another Fact (see `after`), up to 3 deep in a tick.
   */
  trigger: 'ambient' | 'meddle' | 'grudge' | 'reaction';
  roles: RoleDef[];
  /** Reaction Templates only: what they follow. */
  after?: AfterDef;
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
  /** Trophies a Clash winner takes (D15: a tag, not an inventory). Text reads after "his": "nose ring". */
  trophies: Record<BankKey, TrophyDef>;
  /** Everything a Clash needs to be voiced without a model: headline results, fallback scripts, tags. */
  clash: ClashBanks;
}

export interface TrophyDef {
  /** Reads after "his": "nose ring". */
  text: string;
  /** What it mocks, for narration ("vanity", "his mum"). */
  mocks: string;
}

/** A Clash's outcome, from the side of `a` (the one who started it): won, defeated, or the loser fled. */
export type ClashOutcome = 'won' | 'defeated' | 'fled';
export type ClashSpeaker = 'winner' | 'loser' | 'saviour';

/**
 * A fallback Clash script (D26): 3 lines, or 4 when a wrong saviour crashes in, and the loser speaks last.
 * Text may use `{winner}`, `{loser}`, `{saviour}` and `{magnet}` (what drew the saviour). Grudge tags are
 * third-person ("still owes him a pie"), so they go in headlines, not mouths.
 */
export interface ClashScript {
  /** The outcomes it fits. */
  outcomes: ClashOutcome[];
  /** A wrong-saviour script (4 lines, one of them his) or a plain one (3 lines, none of them his). */
  saviour: boolean;
  lines: { speaker: ClashSpeaker; text: string }[];
}

export interface ClashBanks {
  /**
   * The `{result}` slot of a Clash headline: 3 phrasings per outcome (picked by the line variant), plus
   * one more sentence appended when a wrong saviour barged in. Uses `{winner}`, `{loser}`, `{saviour}`, `{magnet}`.
   */
  results: Record<ClashOutcome | 'saviour', [string, string, string]>;
  /** The `{tag}` slot when the pair has no Grudge tag to name. */
  noTag: string;
  /** About 10 fallback scripts, keyed by slug (the Clash Fact's `fallbackKey`). */
  scripts: Record<BankKey, ClashScript>;
  /** What draws a wrong saviour in, per Trait ("Glutton" → "pies"). A Captain with one is likelier to crash in. */
  magnets: Record<string, string>;
  /** Used for a saviour with no magnet Trait: he just heard the noise. */
  anyMagnet: string;
  /**
   * Grudge tags a Clash leaves on the loser (towards the winner) and on him towards a wrong saviour.
   * `trophy` uses `{trophy}`; `saviour` uses `{magnet}`.
   */
  tags: { beaten: string[]; fled: string[]; trophy: string; saviour: string };
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
