import { banks } from './banks.ts';
import { cast } from './cast.ts';
import type { Content } from './types.ts';

// The content bundle: the full cast (#26), starter banks, one ambient incident (#24) and the Rumour
// Templates (#28), Clashes (#30), the roster (#32, #34) and Dares (#35).
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
        { key: 'splash', weight: 6, infamy: { a: 3 } },
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
        { key: 'wobble', weight: 5, infamy: { a: 2 } },
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
    // A landed Dare (#35), one Template per kind and outcome. `{dare}` is the Dare's text, rendered.
    {
      id: 'dare.stunt.botched',
      kind: 'dare',
      trigger: 'meddle',
      roles: [{ name: 'target' }],
      slots: ['dare'],
      outcomes: [{ key: 'botched', weight: 1 }],
      lines: [
        '{target} was dared to {dare}. It went about as well as anyone hoped.',
        'Someone dared {target} to {dare}. He tried. The fortress will be talking about it for weeks.',
        '{target} accepted a Dare to {dare}, and made a mess of it in front of everyone.',
      ],
      baseWeight: 7,
    },
    {
      id: 'dare.stunt.pulled-off',
      kind: 'dare',
      trigger: 'meddle',
      roles: [{ name: 'target' }],
      slots: ['dare'],
      outcomes: [{ key: 'pulled_off', weight: 1 }],
      lines: [
        '{target} was dared to {dare}, and somehow did it. He has not stopped mentioning it.',
        'Against all advice and most of physics, {target} managed to {dare}.',
        '{target} took a Dare to {dare} and pulled it off. Nobody is more surprised than {target}.',
      ],
      baseWeight: 4,
    },
    {
      id: 'dare.stunt.refused',
      kind: 'dare',
      trigger: 'meddle',
      roles: [{ name: 'target' }],
      slots: ['dare'],
      outcomes: [{ key: 'refused', weight: 1 }],
      lines: [
        '{target} was dared to {dare}. He said he had a cold.',
        '{target} has refused a Dare to {dare}, citing "reasons".',
        'Dared to {dare}, {target} went for a lie-down instead. The fortress has noticed.',
      ],
      baseWeight: 5,
    },
    {
      id: 'dare.prank.botched',
      kind: 'dare',
      trigger: 'meddle',
      roles: [{ name: 'target' }, { name: 'victim' }],
      slots: ['dare'],
      outcomes: [{ key: 'botched', weight: 1 }],
      lines: [
        '{target} was dared to {dare}. It went wrong, mostly for {target}, though {victim} is not pleased either.',
        'A Dare to {dare} ended with {target} in a heap and {victim} asking who put him up to it.',
        '{target} tried to {dare}. {victim} caught him at it, and the prank turned on its author.',
      ],
      baseWeight: 7,
    },
    {
      id: 'dare.prank.pulled-off',
      kind: 'dare',
      trigger: 'meddle',
      roles: [{ name: 'target' }, { name: 'victim' }],
      slots: ['dare'],
      outcomes: [{ key: 'pulled_off', weight: 1 }],
      lines: [
        'Somebody dared {target} to {dare}, and he did. {victim} has not seen the funny side.',
        '{target} managed to {dare}. {victim} is now plotting.',
        'On a Dare, {target} went and did it: he managed to {dare}. {victim} is furious.',
      ],
      baseWeight: 6,
    },
    {
      id: 'dare.prank.refused',
      kind: 'dare',
      trigger: 'meddle',
      roles: [{ name: 'target' }, { name: 'victim' }],
      slots: ['dare'],
      outcomes: [{ key: 'refused', weight: 1 }],
      lines: [
        '{target} was dared to {dare}, but lost his nerve. {victim} never knew how close it came.',
        'Dared to {dare}, {target} said he was "above that sort of thing". He is not.',
        '{target} refused a Dare to {dare}. {victim} remains unpranked, for now.',
      ],
      baseWeight: 4,
    },
    // A pranked Hothead goes straight for whoever did it (#35, like `clash.hothead` after a Rumour).
    {
      id: 'clash.pranked',
      kind: 'clash',
      trigger: 'reaction',
      after: { kind: 'dare', outcomes: ['pulled_off', 'botched'], chance: 1 },
      roles: [
        { name: 'a', from: 'victim', trait: 'Hothead' },
        { name: 'b', from: 'target' },
      ],
      slots: ['tag', 'result'],
      outcomes: [
        { key: 'won', weight: 1 },
        { key: 'defeated', weight: 1 },
        { key: 'fled', weight: 1 },
      ],
      lines: [
        '{a} found out that {b} {tag}, and went straight for him. {result}',
        '{a}, a Hothead, did not take kindly to the news that {b} {tag}. {result}',
        'Within the hour {a} had found {b}, who {tag}. {result}',
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
      outcomes: [{ key: 'sulk', weight: 1, infamy: { loser: 2 } }],
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
      outcomes: [{ key: 'blame', weight: 1, infamy: { a: 1 } }],
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
    // Succession (#34): the most infamous orc of the week takes the throne. `{previous}` is who he took it from.
    {
      id: 'roster.crowned',
      kind: 'crowned',
      trigger: 'roster',
      roles: [{ name: 'warlord' }],
      slots: ['previous'],
      outcomes: [{ key: 'crowned', weight: 1 }],
      lines: [
        '{warlord} is the new Warlord, taking the throne from {previous} on the strength of being the stupidest orc this week.',
        'Nobody voted, but {warlord} has been crowned Warlord in place of {previous}. His first act: a nap.',
        'Succession by Infamy has made {warlord} Warlord after {previous}. Experts are not surprised, only sad.',
      ],
      baseWeight: 9,
    },
  ],
  banks,
};
