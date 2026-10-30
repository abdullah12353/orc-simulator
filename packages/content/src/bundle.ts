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
      // An accident (#32): now and then the moat keeps him.
      outcomes: [
        { key: 'splash', weight: 6 },
        { key: 'sank', weight: 1, death: { role: 'a', tag: 'drowned' } },
      ],
      lines: [
        '{a} fell into the moat while explaining to {b} how not to fall into the moat.',
        '{a} was fished out of the moat by {b}, who then charged him for the rope.',
        '{b} pushed {a} into the moat "to test the water". The water passed.',
      ],
      baseWeight: 4,
    },
    {
      id: 'accident.battlements',
      kind: 'incident',
      trigger: 'ambient',
      roles: [{ name: 'a' }],
      outcomes: [
        { key: 'wobble', weight: 5 },
        { key: 'fell', weight: 1, death: { role: 'a', tag: 'fell' } },
      ],
      lines: [
        '{a} leaned over the battlements to see how high they were. Very.',
        '{a} tried to walk the battlements blindfold for a bet. He lost the bet.',
        '{a} went up on the battlements to shout at a cloud.',
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
    // Clashes (#30). `{tag}` is the Grudge behind it, `{result}` the outcome sentence from `banks.clash.results`.
    {
      id: 'clash.grudge',
      kind: 'clash',
      trigger: 'grudge',
      roles: [{ name: 'a' }, { name: 'b' }],
      slots: ['tag', 'result'],
      outcomes: [
        { key: 'won', weight: 1 },
        { key: 'defeated', weight: 1 },
        { key: 'fled', weight: 1 },
      ],
      lines: [
        '{a} finally went for {b}, who {tag}. {result}',
        'A long-running Grudge boiled over when {a} remembered that {b} {tag}. {result}',
        '{a} squared up to {b} in the yard. The matter: {b} {tag}. {result}',
      ],
      baseWeight: 8,
    },
    // "A Hothead target goes straight to a Clash" (#7): a Rumour lands on a Hothead, who goes for the source.
    {
      id: 'clash.hothead',
      kind: 'clash',
      trigger: 'reaction',
      after: { kind: 'rumour', chance: 1 },
      roles: [
        { name: 'a', from: 'reached', trait: 'Hothead' },
        { name: 'b', from: 'source' },
      ],
      slots: ['tag', 'result'],
      outcomes: [
        { key: 'won', weight: 1 },
        { key: 'defeated', weight: 1 },
        { key: 'fled', weight: 1 },
      ],
      lines: [
        '{a} heard that {b} {tag}, and did not wait to hear the rest. {result}',
        '{a}, a Hothead, went straight for {b}, who {tag}, apparently. {result}',
        'Within minutes of hearing that {b} {tag}, {a} was rolling up his sleeves. {result}',
      ],
      baseWeight: 9,
    },
    // Reactions (#30), placeholders until the v1 catalogue (#44).
    {
      id: 'reaction.sulk',
      kind: 'incident',
      trigger: 'reaction',
      after: { kind: 'clash', outcomes: ['won', 'defeated'], chance: 0.25 },
      roles: [{ name: 'loser', from: 'loser' }, { name: 'winner', from: 'winner' }],
      outcomes: [{ key: 'sulk', weight: 1 }],
      lines: [
        '{loser} is sulking on the battlements and will not come down until {winner} apologises.',
        '{loser} has written a strongly worded letter to {winner}. It is mostly drawings.',
        '{loser} has told everyone that he let {winner} win. Nobody believes him, including {loser}.',
      ],
      baseWeight: 3,
    },
    {
      id: 'reaction.moat-blame',
      kind: 'incident',
      trigger: 'reaction',
      after: { kind: 'incident', outcomes: ['splash'], chance: 0.2 },
      roles: [{ name: 'a', from: 'a' }, { name: 'b', from: 'b' }],
      outcomes: [{ key: 'blame', weight: 1 }],
      lines: [
        '{a}, still damp, has formally blamed {b} for the moat.',
        '{a} has demanded {b} drain the moat. {b} has offered a cup.',
        '{a} is telling anyone who will listen that {b} moved the moat.',
      ],
      baseWeight: 3,
    },
    // The roster's story heads (#32): written by the sim, never rolled. Their Introductions come with #33.
    {
      id: 'roster.return',
      kind: 'return',
      trigger: 'roster',
      roles: [{ name: 'returner' }],
      slots: ['how'],
      outcomes: [{ key: 'returned', weight: 1 }],
      lines: [
        '{returner} is back from the dead, {how}.',
        'Nobody asked, but {returner} has Returned, {how}.',
        '{returner} has come back, {how}. He says death was "fine".',
      ],
      baseWeight: 8,
    },
    {
      id: 'roster.stepped-in',
      kind: 'stepped_in',
      trigger: 'roster',
      roles: [{ name: 'newcomer' }, { name: 'dead' }],
      outcomes: [{ key: 'stepped_in', weight: 1 }],
      lines: [
        'With {dead} dead, {newcomer} has been called up from the reserve. He has brought his own chair.',
        '{newcomer} steps in for the late {dead}, and has already moved into his tent.',
        '{dead} is dead, so {newcomer} is back in the twelve. He says it was always meant to be.',
      ],
      baseWeight: 4,
    },
    {
      id: 'roster.unmasked',
      kind: 'unmasked',
      trigger: 'roster',
      roles: [{ name: 'captain' }],
      slots: ['alias'],
      outcomes: [{ key: 'unmasked', weight: 1 }],
      lines: [
        '{alias} has been unmasked. It was {captain} all along.',
        'The orc calling himself {alias} turns out to be {captain}. Everyone is very surprised except everyone.',
        '{captain} has been exposed: there is no such orc as {alias}.',
      ],
      baseWeight: 7,
    },
  ],
  banks,
};
