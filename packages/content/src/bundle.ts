import { banks } from './banks.ts';
import { cast } from './cast.ts';
import type { Content } from './types.ts';

// The content bundle: the full cast (#26), starter banks, one ambient incident (#24) and the Rumour
// Templates (#28).
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
    // A landed Rumour (#28), one Template per outcome. `{claim}` is the Claim phrasing, rendered.
    {
      id: 'rumour.works',
      kind: 'rumour',
      trigger: 'meddle',
      roles: [{ name: 'source' }, { name: 'target' }, { name: 'reached' }],
      slots: ['claim'],
      outcomes: [{ key: 'works', weight: 1 }],
      lines: [
        'Word reached {target} that {source} {claim}. {target} has taken it personally.',
        '{target} has heard that {source} {claim}, and believed every word.',
        '{target} is no longer speaking to {source}. A rumour says {source} {claim}.',
      ],
      baseWeight: 5,
    },
    {
      id: 'rumour.wrong-orc',
      kind: 'rumour',
      trigger: 'meddle',
      roles: [{ name: 'source' }, { name: 'target' }, { name: 'reached' }],
      slots: ['claim'],
      outcomes: [{ key: 'wrong_orc', weight: 1 }],
      lines: [
        'A rumour that {source} {claim} was meant for {target}. It reached {reached}, who has taken it personally anyway.',
        '{reached} has heard that {source} {claim}. The rumour was about {target}. Nobody has told {reached}.',
        'A rumour aimed at {target} went astray and found {reached}, who now believes {source} {claim}.',
      ],
      baseWeight: 6,
    },
    {
      id: 'rumour.garbled',
      kind: 'rumour',
      trigger: 'meddle',
      roles: [{ name: 'source' }, { name: 'target' }, { name: 'reached' }],
      slots: ['claim'],
      outcomes: [{ key: 'garbled', weight: 1 }],
      lines: [
        'By the time it reached {target}, a small rumour had grown: {source} {claim}. Nobody can say how.',
        '{target} has been told that {source} {claim}. This is not what the rumour said when it set off.',
        'A rumour about {target} passed through four orcs and a goat. It arrived as: {source} {claim}.',
      ],
      baseWeight: 7,
    },
  ],
  banks,
};
