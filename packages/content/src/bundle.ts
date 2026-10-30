import { banks } from './banks.ts';
import { cast } from './cast.ts';
import type { Content } from './types.ts';

// The content bundle: the full cast (#26), starter banks and one ambient incident (#24).
// The v1 catalogue arrives with #44.

export const content: Content = {
  cast,
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
  banks,
};
