import type { Banks } from './types.ts';

// Starter banks for casting (#26). The v1 catalogue (#44) grows them and Mohammed strikes them.

export const banks: Banks = {
  // Tags for the ~6 Grudges seeded at casting: old history from before day zero (D57).
  oldHistory: [
    'still owes him a pie',
    'sat in his chair at the feast',
    "laughed at his mum's cooking",
    'borrowed his helmet and gave back a bucket',
    'told everyone he cried at a goose',
    'won his boots in a bet and wears them on his hands',
    'ate the last pickled egg',
    'named a rat after him',
    'sneezed on his breakfast',
    'pushed him in the moat at a wedding',
    'drew a moustache on his portrait',
    'never gave back his favourite spoon',
    'told the Warlord he snores',
    "sold him a dragon's egg (a potato)",
    "kicked his dog (it was the Warlord's cat)",
  ],
  // The prerecorded announcer Epithets. Keys are slugs; `text` follows the Captain's name.
  epithets: {
    'the-damp': { text: 'the Damp', sayAs: 'the DAMP' },
    'the-polished': { text: 'the Polished', sayAs: 'the POL-isht' },
    'the-magnificent': { text: 'the Magnificent', sayAs: 'the mag-NIF-i-sent' },
    'the-lukewarm': { text: 'the Lukewarm', sayAs: 'the LUKE-warm' },
    'the-sleepy': { text: 'the Sleepy', sayAs: 'the SLEE-pee' },
    'the-unwashed': { text: 'the Unwashed', sayAs: 'the un-WOSHT' },
    'the-concussed': { text: 'the Concussed', sayAs: 'the con-KUST' },
    'the-pie-bothered': { text: 'the Pie-Bothered', sayAs: 'the PIE-both-erd' },
    'the-twice-stabbed': { text: 'the Twice-Stabbed', sayAs: 'the TWICE-stabd' },
    'the-lost': { text: 'the Lost', sayAs: 'the LOST' },
    'the-barely-awake': { text: 'the Barely Awake', sayAs: 'the BAIR-lee a-WAKE' },
    'the-bucket': { text: 'the Bucket', sayAs: 'the BUCK-it' },
    'the-goosed': { text: 'the Goosed', sayAs: 'the GOOST' },
    'the-flattened': { text: 'the Flattened', sayAs: 'the FLAT-und' },
    'the-soggy': { text: 'the Soggy', sayAs: 'the SOG-ee' },
  },
  // The Gutter Herald's masthead (#27). Clean and deadpan: the Herald never swears.
  masthead: {
    days: ['Sulkday', 'Moanday', 'Tusksday', 'Grudgesday', 'Thudsday', 'Frightday', 'Splatterday'],
    months: [
      'Grimuary',
      'Fibruary',
      'Marsh',
      'Aprill',
      'Mayhem',
      'Junk',
      'Julie',
      'Rotgust',
      'Septembrrr',
      'Octobrawl',
      'Novemburp',
      'Dismember',
    ],
    prices: [
      'Two teeth, or one good tooth',
      'A shiny pebble (no swaps)',
      'Free to anyone who can read',
      'One rat, alive, no questions asked',
      'Half a pie (the good half)',
      'Price went up. Ask why and it goes up again',
      'One boot. Either foot',
      'A favour, to be called in at a bad moment',
    ],
    weather: [
      'Damp, with a chance of moat',
      'Overcast over the fortress; under it, also overcast',
      'Fog so thick a Captain walked into himself',
      'Bright spells, mostly from things on fire',
      'Wind from the latrines, freshening',
      'Light drizzle of arrows in the east',
      'Close and muggy. Someone has opened a crate of eggs',
      'Crows heavy. Visibility poor, morale poorer',
    ],
  },
  // Rumours (#28). A subject reads after "his": "laughed at his appetite in front of the latrine queue".
  subjects: {
    Glutton: 'appetite',
    Vain: 'vanity',
    "Mummy's Boy": 'devotion to his mum',
    'Compulsive Liar': 'lying',
    'Little Fortresser': 'views on outsiders',
    Coward: 'cowardice',
    Hothead: 'temper',
    Gullible: 'gullibility',
    Drunkard: 'drinking',
    Snob: 'snobbery',
    Hoarder: 'hoard of junk',
    Superstitious: 'lucky charms',
    'Show-off': 'showing off',
    Lazy: 'laziness',
    'Sore Loser': 'sulking',
    Sleepwalker: 'sleepwalking',
    Water: 'fear of water',
    Heights: 'fear of heights',
    'The Dark': 'fear of the dark',
    Birds: 'fear of birds',
    Doctors: 'fear of doctors',
    Soap: 'fear of soap',
    Cats: 'fear of cats',
    'Being Laughed At': 'fear of being laughed at',
    'Small Dogs': 'fear of small dogs',
    'His Mum': 'fear of his mum',
    // Fears only a Humiliation adds (#32).
    Puddles: 'fear of puddles',
    Stairs: 'fear of stairs',
  },
  // Only Garbles swap these in. The v1 catalogue (#44) grows the bank to about 20.
  absurdSubjects: {
    'secret-goose': 'secret goose',
    'pet-turnip': 'pet turnip',
    'tiny-hats': 'collection of tiny hats',
    'imaginary-dragon': 'imaginary dragon',
    'pie-engagement': 'engagement to a pie',
    'ballet-lessons': 'ballet lessons',
    'gravel-poetry': 'poetry about gravel',
    'spoon-shrine': 'shrine to a spoon',
    'turnip-head': 'second head (a turnip on a stick)',
    'false-beard': 'false beard',
    'knitting-circle': 'knitting circle',
    'rat-council': 'seat on the rat council',
  },
  // What the source supposedly did. Clean: these end up in Herald lines and Grudge tags.
  claims: {
    insult: {
      label: 'An insult',
      phrasings: [
        'called his {subject} a disgrace to the fortress',
        'laughed at his {subject} in front of the latrine queue',
        'said his {subject} smells worse than the moat',
      ],
    },
    fear: {
      label: 'A Fear exposed',
      phrasings: [
        'told the whole mess hall about his {subject}',
        'drew a picture of his {subject} on the latrine wall',
        'said his {subject} is why he sleeps with a candle',
      ],
    },
    theft: {
      label: 'A theft',
      phrasings: [
        "said he nicked the Warlord's spoon to feed his {subject}",
        'said he sold the feast money to pay for his {subject}',
        "said he pinched the Warlord's boots and blamed his {subject}",
      ],
    },
    mum: {
      label: 'A mum claim',
      phrasings: [
        'said his mum is the real reason for his {subject}',
        'said even his mum is embarrassed by his {subject}',
        'said his mum writes to the Herald about his {subject}',
      ],
    },
    coup: {
      label: 'A coup plot',
      phrasings: [
        'said he is plotting to seize the throne with his {subject}',
        "said he has promised the Warlord's chair to his {subject}",
        'said he holds secret meetings about the throne, chaired by his {subject}',
      ],
    },
  },
  // insult → mum → betrayal (a theft) → coup. A Fear exposed enters at the bottom.
  garbleLadder: ['insult', 'mum', 'theft', 'coup'],
  // Deadpan and clean: the joke is the Meddle and where it led, never the Player.
  blame: {
    verbs: {
      rumour: { began: 'planted a Rumour', noun: 'Rumour' },
      dare: { began: 'set a Dare', noun: 'Dare' },
    },
    one: 'It all began when {first}.',
    two: 'It all began when {first}, and {last} finished the job.',
    many: 'It all began when {first}, {middle} kept it going, and {last} finished the job.',
  },
  // Trophies (#30). A starter set; the v1 catalogue (#44) grows it to about 25.
  trophies: {
    'nose-ring': { text: 'nose ring', mocks: 'vanity' },
    'lucky-spoon': { text: 'lucky spoon', mocks: 'superstition' },
    'best-helmet': { text: 'best helmet (a bucket)', mocks: 'vanity' },
    'left-boot': { text: 'left boot', mocks: 'cowardice' },
    'mums-letter': { text: 'letter from his mum', mocks: 'his mum' },
    'pie-tin': { text: 'emergency pie tin', mocks: 'appetite' },
    'tusk-polish': { text: 'tusk polish', mocks: 'vanity' },
    'drinking-horn': { text: 'drinking horn', mocks: 'drinking' },
    'night-light': { text: 'night light', mocks: 'fear of the dark' },
    medal: { text: 'medal (self-awarded)', mocks: 'showing off' },
    teddy: { text: 'battle teddy', mocks: 'cowardice' },
    'skull-hat': { text: 'skull hat', mocks: 'vanity' },
  },
  // Clashes (#30): fallback dialogue (D26) and the Herald's templated Clash headlines. Scripts are orc
  // banter (sweary is fine); results and tags end up in Herald lines, so they stay clean.
  clash: {
    results: {
      won: [
        '{winner} won, and has not stopped mentioning it.',
        '{loser} lost, loudly, and has asked for a rematch in writing.',
        '{winner} came out on top. {loser} came out of the moat.',
      ],
      defeated: [
        '{loser} started it. {winner} finished it.',
        'It went badly for {loser}, who started it and now regrets several things.',
        '{winner} won. Nobody, least of all {loser}, saw that coming.',
      ],
      fled: [
        '{loser} ran off before it began and is hiding in the latrines.',
        '{loser} remembered an urgent appointment elsewhere. {winner} claims the win.',
        '{loser} fled at speed, leaving one boot and his dignity behind.',
      ],
      saviour: [
        'Then {saviour} barged in after the {magnet} and made everything worse.',
        '{saviour} arrived to help, distracted by the {magnet}. It did not help.',
        'Help came, in the form of {saviour}, who was mostly after the {magnet}.',
      ],
    },
    noTag: 'something neither of them can remember',
    scripts: {
      'won-pint': {
        outcomes: ['won', 'defeated'],
        saviour: false,
        lines: [
          { speaker: 'winner', text: "Don't think I forgot what you did, you lumpy sod." },
          { speaker: 'loser', text: 'That was ages ago! Let it go, you sad bastard.' },
          { speaker: 'loser', text: 'Right. Fine. Ow. Someone get me a pint and a doctor. Pint first.' },
        ],
      },
      'won-mum': {
        outcomes: ['won', 'defeated'],
        saviour: false,
        lines: [
          { speaker: 'winner', text: "Come 'ere then. This one's been a long time coming." },
          { speaker: 'loser', text: 'You hit like my mum. And she hits HARD, so watch it.' },
          { speaker: 'loser', text: "I'm telling my mum. She'll sort you out, you see if she don't." },
        ],
      },
      'won-moat': {
        outcomes: ['won'],
        saviour: false,
        lines: [
          { speaker: 'winner', text: 'I have waited a long time for this, you absolute turnip.' },
          { speaker: 'loser', text: "Waited? You've been asleep in the latrine since Tuesday." },
          { speaker: 'loser', text: "Not the moat. NOT THE MOAT! ...It's only up to me knees. Still." },
        ],
      },
      'defeated-upset': {
        outcomes: ['defeated'],
        saviour: false,
        lines: [
          { speaker: 'loser', text: 'Today you pay for what you did, you crusty little bellend.' },
          { speaker: 'winner', text: 'Me? I was eating a sandwich. I am STILL eating a sandwich.' },
          { speaker: 'loser', text: 'Beaten by a sandwich-eater. Nobody tell the Herald. Nobody.' },
        ],
      },
      'fled-latrine': {
        outcomes: ['fled'],
        saviour: false,
        lines: [
          { speaker: 'winner', text: 'Oi! Stand still so I can hit you.' },
          { speaker: 'loser', text: "Can't stop, got a thing. A very important thing. Over there." },
          { speaker: 'loser', text: "I'm not running, I'm advancing backwards! Tactically! Fast!" },
        ],
      },
      'fled-boot': {
        outcomes: ['fled'],
        saviour: false,
        lines: [
          { speaker: 'winner', text: 'Right, you. Outside. Now.' },
          { speaker: 'loser', text: 'Outside? In this weather? Have you seen the weather, you mad sod?' },
          { speaker: 'loser', text: 'Keep the boot! It was never my favourite boot! Bye!' },
        ],
      },
      'saviour-pies': {
        outcomes: ['won', 'defeated', 'fled'],
        saviour: true,
        lines: [
          { speaker: 'winner', text: "I've had it up to here with you." },
          { speaker: 'loser', text: "Up to where? You're four foot tall, you shit." },
          { speaker: 'saviour', text: "OI! Mind the {magnet}! Out of the way, I'm saving someone!" },
          { speaker: 'loser', text: 'Saving WHO? You knocked me flat, you great useless lump!' },
        ],
      },
      'saviour-crowd': {
        outcomes: ['won', 'defeated', 'fled'],
        saviour: true,
        lines: [
          { speaker: 'loser', text: "Come on then! I'll take you, and your mum, and your mum's mum." },
          { speaker: 'winner', text: 'Leave my nan out of this, you mouldy-arsed turnip.' },
          { speaker: 'saviour', text: "DON'T PANIC, I'M HERE! ...Is that the {magnet}? Hold on." },
          { speaker: 'loser', text: 'He stood on my head. He stood on my head for the {magnet}.' },
        ],
      },
      'saviour-help': {
        outcomes: ['won', 'defeated'],
        saviour: true,
        lines: [
          { speaker: 'winner', text: 'This ends today, {loser}.' },
          { speaker: 'loser', text: "It ends when I say it ends, and I haven't said, so there." },
          { speaker: 'saviour', text: "I'll help! Which one of you is the good one? Never mind!" },
          { speaker: 'loser', text: 'Why is everyone hitting ME? Help is not supposed to hit you!' },
        ],
      },
    },
    magnets: {
      Glutton: 'pies',
      'Show-off': 'crowd',
      Drunkard: 'free ale',
      Hoarder: 'loose change',
      Superstitious: 'lucky horseshoe',
      Sleepwalker: 'comfy hay bale',
      Vain: 'big mirror',
      Gullible: 'shouting',
    },
    anyMagnet: 'noise',
    tags: {
      beaten: ['gave him a hiding in front of everyone', 'beat him in a Clash and sang about it', 'knocked him into the moat'],
      fled: ['chased him round the latrines', 'made him run off without a boot'],
      trophy: 'took his {trophy}',
      saviour: 'barged into his Clash after the {magnet}',
    },
  },
  // Humiliations (#32, D41): one per Return, fitting how he died. Placeholders until the v1 catalogue (#44).
  // Overlay slots (#18): 2 tusks, 3 lost bits, 4 moustache, 5 face wraps, 6 head bandage, 7 wig, 8 bucket.
  humiliations: {
    'bandage.head': { cat: 'bandage', label: 'Head bandage', text: 'with his head wrapped in grey bandages', causes: ['beaten', 'fell'], overlay: { slot: 6 } },
    'bandage.mouth': {
      cat: 'bandage', label: 'Mouth bandage (muffled)',
      text: 'with his mouth bandaged shut, which nobody minds',
      causes: ['beaten', 'drowned'],
      overlay: { slot: 5, pinned: true },
      muffled: true,
    },
    'bandage.eyepatch': { cat: 'bandage', label: 'Eyepatch, wrong eye', text: 'wearing an eyepatch over the wrong eye', causes: ['beaten', 'fell'], overlay: { slot: 5 } },
    'bandage.mummy': { cat: 'bandage', label: 'Bandaged head to toe', text: 'wrapped head to toe like a badly posted parcel', causes: ['drowned', 'fell'], overlay: { slot: 6 } },
    'lost.tusk': { cat: 'lost_bit', label: 'Missing tusk', text: 'missing a tusk', causes: ['beaten', 'fell'], overlay: { slot: 2, outsideLimit: true } },
    'lost.ear': { cat: 'lost_bit', label: 'Missing ear', text: 'one ear lighter than when he left', causes: ['beaten'], overlay: { slot: 3 } },
    'lost.peg-leg': { cat: 'lost_bit', label: 'Peg leg', text: 'on a peg leg he insists is the original', causes: ['fell', 'drowned'], overlay: { slot: 3 } },
    'lost.hook': { cat: 'lost_bit', label: 'Hook hand', text: 'with a hook where his hand used to be. He keeps waving', causes: ['beaten', 'drowned'], overlay: { slot: 3 } },
    'disguise.bucket': {
      cat: 'disguise', label: 'Bucket disguise',
      text: 'wearing a bucket and calling himself {alias}',
      causes: ['beaten', 'drowned', 'fell'],
      overlay: { slot: 8, pinned: true },
    },
    'disguise.moustache': {
      cat: 'disguise', label: 'Stick-on moustache',
      text: 'in a stick-on moustache, insisting he is {alias}',
      causes: ['beaten', 'fell'],
      overlay: { slot: 4, pinned: true },
    },
    'disguise.wig': { cat: 'disguise', label: 'Wig', text: 'in a wig, answering only to {alias}', causes: ['drowned'], overlay: { slot: 7, pinned: true } },
    'epithet.the-damp': { cat: 'epithet', label: 'Renamed: the Damp', text: 'and is to be known as {name} {epithet}', causes: ['drowned'], epithet: 'the-damp' },
    'epithet.the-soggy': { cat: 'epithet', label: 'Renamed: the Soggy', text: 'and has been renamed {name} {epithet}', causes: ['drowned'], epithet: 'the-soggy' },
    'epithet.the-concussed': { cat: 'epithet', label: 'Renamed: the Concussed', text: 'and is now {name} {epithet}', causes: ['fell'], epithet: 'the-concussed' },
    'epithet.the-flattened': { cat: 'epithet', label: 'Renamed: the Flattened', text: 'and must be called {name} {epithet}', causes: ['fell', 'beaten'], epithet: 'the-flattened' },
    'epithet.the-twice-stabbed': {
      cat: 'epithet', label: 'Renamed: the Twice-Stabbed',
      text: 'and is now, officially, {name} {epithet}',
      causes: ['beaten'],
      epithet: 'the-twice-stabbed',
    },
    'fear.puddles': { cat: 'fear', label: 'New Fear: puddles', text: 'and now screams at puddles', causes: ['drowned'], fear: 'Puddles' },
    'fear.water': { cat: 'fear', label: 'New Fear: water', text: 'with a brand new fear of water', causes: ['drowned'], fear: 'Water' },
    'fear.stairs': { cat: 'fear', label: 'New Fear: stairs', text: 'and now refuses to go near stairs', causes: ['fell'], fear: 'Stairs' },
    'fear.heights': { cat: 'fear', label: 'New Fear: heights', text: 'and now gets dizzy on a doorstep', causes: ['fell'], fear: 'Heights' },
    'fear.laughed-at': { cat: 'fear', label: 'New Fear: being laughed at', text: 'and now flinches whenever anyone laughs', causes: ['beaten'], fear: 'Being Laughed At' },
    'fear.doctors': { cat: 'fear', label: 'New Fear: doctors', text: 'with a new fear of doctors, having met several', causes: ['beaten', 'fell'], fear: 'Doctors' },
  },
  death: {
    died: ['{captain} did not survive it.', '{captain} is dead. For now.', 'It was the end of {captain}, for the time being.'],
    averted: {
      grace: [
        '{captain} should have died, but had only just come back and refused on principle.',
        'It would have killed {captain}, but he is still under warranty from his last death.',
        '{captain} died briefly, then remembered he had only just Returned, and stopped.',
      ],
      daily_cap: [
        '{captain} would have died, but the fortress had run out of funerals for the day.',
        'It should have killed {captain}. The undertaker had already gone home.',
        '{captain} was turned away at the gates of death: they were full today.',
      ],
    },
    benched: [
      '{captain} has been sent to the reserve to make room.',
      '{captain} has been sacked to make room, and is taking it badly.',
      '{captain} has been moved to the reserve. His chair has already been sat in.',
    ],
  },
  // The throne and Legendary (#34). Sentences appended to the story they happen in; each names {captain}.
  throne: {
    fell: {
      death: [
        'The Warlord is dead, so {captain} is no longer the Warlord.',
        'The throne is empty: {captain} has died in office.',
        '{captain} has left the throne the hard way.',
      ],
      clash_loss: [
        '{captain} has lost the throne along with the fight.',
        'Having lost, {captain} is no longer Warlord. Nobody can find his crown.',
        'The fortress no longer takes orders from {captain}.',
      ],
      botched_dare: [
        '{captain} botched it so badly he is no longer Warlord.',
        'The throne has been taken off {captain} for his own safety.',
        '{captain} has been stripped of the throne. He is still holding the armrest.',
      ],
    },
    legendary: [
      'It is the stupidest thing anyone can remember: {captain} is now Legendary.',
      'Historians agree: {captain} has become Legendary.',
      'With this, {captain} enters legend. The fortress is not proud.',
    ],
    emptyThrone: 'an empty chair',
  },
  // Accusations (D20, #39): hand-written, spoken by the accuser over his prerecorded clip of the Player's
  // mangled name. They blame the Player's meddling, never the Player as a person (tone bible §2).
  accusations: [
    "It was {name}. I know it was {name}. I can smell a meddler from here.",
    "I ain't saying it was {name}. But it was {name}.",
    "Don't look at me, look at {name}. It's always bloody {name}.",
    "This has got {name}'s fingerprints all over it. Mark my words.",
    "Somebody's been meddling, and that somebody is called {name}. Probably.",
    "{name}! I'll have {name} for this, see if I don't.",
  ],
};
