import type { Content } from './types.ts';

// Minimal tracer-bullet bundle (#24): Krúg plus a few placeholder Captains and one ambient incident.
// The full cast arrives with #26 and the v1 catalogue with #44.

export const content: Content = {
  cast: [
    {
      id: 'krug',
      name: 'Krúg',
      sayAs: 'KROOG',
      accent: 'cockney',
      power: 3,
      traits: ["Mummy's Boy", 'Little Fortresser'],
      fears: ['Water'],
      catchphrase: 'Exit means exit.',
      aliases: ['Krúg Bootleg', 'Definitely Not Krúg'],
      portraitKey: 'krug',
      accuser: true,
    },
    {
      id: 'grishnack',
      name: 'Grishnack',
      sayAs: 'GRISH-nack',
      accent: 'scouse',
      power: 6,
      traits: ['Glutton', 'Show-off'],
      fears: ['Mice'],
      catchphrase: 'Pies first, questions never.',
      aliases: ['Grish Nobody', 'Sir Not-Grishnack'],
      portraitKey: 'grishnack',
      accuser: false,
    },
    {
      id: 'snarlbottom',
      name: 'Lord Snarlbottom',
      sayAs: 'lord SNARL-bottom',
      accent: 'posh',
      power: 7,
      traits: ['Snob', 'Sore Loser'],
      fears: ['Peasants'],
      catchphrase: 'One does not queue.',
      aliases: ['Lord Snarlbottom-Smythe', 'Mister Bottom'],
      portraitKey: 'snarlbottom',
      accuser: true,
    },
    {
      id: 'mugwort',
      name: 'Mugwort',
      sayAs: 'MUG-wort',
      accent: 'west-country',
      power: 4,
      traits: ['Gambler', 'Coward'],
      fears: ['Heights'],
      catchphrase: 'Odds are, I was never here.',
      aliases: ['Mugwort the Elsewhere', 'Wortmug'],
      portraitKey: 'mugwort',
      accuser: false,
    },
  ],
  templates: [
    {
      id: 'ambient.moat-dip',
      kind: 'incident',
      trigger: 'ambient',
      roles: [{ name: 'a' }, { name: 'b' }],
      outcomes: [{ key: 'splash', weight: 1 }],
      lines: [
        '{a} fell into the moat while explaining to {b} how not to fall into the moat.',
        '{a} was fished out of the moat by {b}, who then charged him for the rope.',
        '{b} pushed {a} into the moat "to test the water". The water passed.',
      ],
      baseWeight: 4,
    },
  ],
  banks: {},
};
