// The shared pools every cast card draws from (Captain card and name generator, #6). The Event
// catalogue (#44) may rename or cut entries; every Trait and Fear must give events something to trigger on.

/** The six accent archetypes (tone bible §3). Muffled is a Humiliation overlay, not an archetype. */
export const ACCENTS = ['cockney', 'posh', 'west-country', 'scouse', 'glaswegian', 'indian-english'] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_LABELS: Record<Accent, string> = {
  cockney: 'Cockney',
  posh: 'Posh RP',
  'west-country': 'West Country',
  scouse: 'Scouse',
  glaswegian: 'Glaswegian',
  'indian-english': 'Indian English',
};

export const TRAITS = [
  'Glutton',
  'Vain',
  "Mummy's Boy",
  'Compulsive Liar',
  'Little Fortresser',
  'Coward',
  'Hothead',
  'Gullible',
  'Drunkard',
  'Snob',
  'Hoarder',
  'Superstitious',
  'Show-off',
  'Lazy',
  'Sore Loser',
  'Sleepwalker',
] as const;

export const FEARS = [
  'Water',
  'Heights',
  'The Dark',
  'Birds',
  'Doctors',
  'Soap',
  'Cats',
  'Being Laughed At',
  'Small Dogs',
  'His Mum',
] as const;

/** The five Claim kinds a Rumour can assert (Meddle verbs #7). */
export const CLAIMS = ['insult', 'fear', 'theft', 'mum', 'coup'] as const;
export type Claim = (typeof CLAIMS)[number];

/**
 * Death cause tags (#32): how a Captain died, which picks the Humiliation he Returns with. A Clash
 * defeat is `beaten`; accident outcomes name their own; a botched Dare (#35) is `botched`.
 */
export const CAUSE_TAGS = ['beaten', 'drowned', 'fell', 'botched'] as const;
export type CauseTag = (typeof CAUSE_TAGS)[number];

/** The founding Captain: always in the active 12, never the starting Warlord, never benched. */
export const KRUG = 'krug';

/** Casting rules (D57) shared by `castWorld` and the content check. */
export const CASTING = {
  /** The active 12 = 2 per accent archetype, Krúg counting as one of the cockneys. */
  activePerAccent: 2,
  /** "About 6" Grudges seeded from the old-history bank, each with its own tag. */
  seededGrudges: { min: 5, max: 7 },
  /** Exactly this many accusers (D59). */
  accusers: 6,
} as const;

/**
 * The roles a reaction can cast from its parent Fact, per parent kind (incidents offer their own Template's
 * roles). The sim's `parentRoles` fills exactly these, so this is the one list of them.
 */
export const PARENT_ROLES = {
  rumour: ['source', 'target', 'reached'],
  clash: ['a', 'b', 'winner', 'loser', 'saviour'],
  dare: ['target', 'victim'],
  return: ['returner'],
  stepped_in: ['newcomer', 'dead'],
  unmasked: ['captain'],
  crowned: ['warlord', 'previous'],
} as const;
export type ParentKind = keyof typeof PARENT_ROLES;
