// The voice test (#19): the six accusers (one per accent, the tone bible's calibration six) and the
// announcer. Each line renders to `voices/takes/<voice>-<line>.mp3`, and the main take is converted into
// the PWA's audio bank, replacing that placeholder. A `~2`/`~3` suffix is an alternative take: it's only
// rendered into takes/, for `npm run voices -- --pick <take>`. Every Captain also gets his catchphrase as
// `signature` (from the cast, so it stays in sync) and the two swap-audit lines.
// Lines are hand-written to the tone bible: accent through word choice only, jokes from the Traits.

/** The same two neutral lines in every Captain's voice, for the swap audit (research/voice-casting.md §7). */
export const SWAP_LINES = {
  'swap-1': "Oi! Who's had my pie? That was MY pie.",
  'swap-2': "Right. Nobody move. I've dropped my tusk.",
};

export const TEST_CAST: Record<string, Record<string, string>> = {
  krug: {
    shout: '[shouts] KROOOOOOG!',
    'shout~2': '[shouts] KRRRROOOOOG!',
    'shout~3': '[shouts] KROOG! KROOOOOOOOG!',
    taunt: "[laughs] Come 'ere then, you bucket-headed melt!",
    oi: '[shouts] OI! OI! Not in MY fortress!',
    triumph: '[shouts] Have that! Mum, did you see? MUM!',
    pain: "[groans] Ow! That's my good ear, that is!",
    scared: '[panicked] Is that water? Get it away from me!',
  },
  snarlbottom: {
    shout: '[shouts] LORD… SNAAARL-BOTTOM!',
    'shout~2': '[shouts] SNARLBOTTOOOOOM!',
    'shout~3': '[shouts] LORD SNARL-BOT-TOM!',
    taunt: '[laughs] Oh, how frightfully common of you.',
    oi: '[shouts] I say! You there! Peasant!',
    triumph: 'Frightfully sorry. Do send the invoice to Mummy.',
    pain: '[gasps] Not the face, you ghastly little turd!',
    scared: "[panicked] A pigeon? Nobody said there'd be pigeons!",
  },
  mudgut: {
    shout: '[shouts] OLD… MUUUD-GUT!',
    'shout~2': '[shouts] MUDGUUUUUT!',
    'shout~3': '[shouts] MUD-GUT! OLD MUDGUT!',
    taunt: '[laughs] Come on then, you soggy little pasty.',
    oi: "[shouts] OI! That's my dinner you're stood on!",
    triumph: '[laughs] He started it. I finished it. Then I ate him.',
    pain: "[groans] Ooh, that's gone right in my belly, that has.",
    scared: '[panicked] Is that soap? Keep that soap away from me, boy!',
  },
  skagrot: {
    shout: '[shouts] SKAAAG-ROT!',
    'shout~2': '[shouts] SKAGROOOOOT!',
    'shout~3': '[shouts] SKAG-ROT! SKAGROT!',
    taunt: "Go 'ed then, lad. Go 'ed. I'm not arsed.",
    oi: '[shouts] OI! Who are you looking at, lad?',
    triumph: '[shouts] Get in! Proper sound, that!',
    pain: '[groans] Stabbed meself in the arse. Still sound, that.',
    scared: '[panicked] Is that a bird? Lad. Lad, is that a BIRD?',
  },
  grizzock: {
    shout: '[shouts] GRIIIZ-OCK!',
    'shout~2': '[shouts] GRRRIZZOCK!',
    'shout~3': '[shouts] GRIZ-OCK! GRIZZOOOCK!',
    taunt: 'Come ahead then, ya absolute fanny!',
    oi: '[shouts] OI! Yous! Aye, YOUS!',
    triumph: "[shouts] Who's next? I'll take the wall as well!",
    pain: "[groans] Ma head's fine. It's ma pride that's deid.",
    scared: '[panicked] Naw. Naw. Is he a doctor? Get him away fae me!',
  },
  vorgash: {
    shout: '[shouts] VOOOR-GASH!',
    'shout~2': '[shouts] VORGAAAAASH!',
    'shout~3': '[shouts] VOR-GASH! THE VORGASH!',
    taunt: 'Shut your face, you mouldy-arsed turnip.',
    oi: '[shouts] OI! Mind the tusks! They are polished!',
    triumph: '[laughs] Look at these tusks. You cannot buy this quality.',
    pain: '[gasps] My tusk! Do you know how long I polish this?',
    scared: '[nervous] Why is everybody laughing? Stop laughing!',
  },
  // The Introduction opener, the Herald's lead story (D52), and the Epithets of the test cast's
  // Introductions (Vorgash starts as the Polished), plus two spares to hear the deadpan.
  announcer: {
    'stinger-intro': 'Introducing…',
    'stinger-lead': 'Extra. Extra.',
    'epithet-the-polished': '…the Polished.',
    'epithet-the-damp': '…the Damp.',
    'epithet-the-magnificent': '…the Magnificent.',
  },
};
