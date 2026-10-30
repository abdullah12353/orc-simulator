import type { OutcomeDef, TemplateDef } from './types.ts';

// The v1 event catalogue (#44, D46): drafted for Mohammed's strike pass. Every line ends up in the Gutter
// Herald, so it is deadpan and clean (tone bible §1, §4): the orcs are the joke, never who they are.
// Every variant names every role, and reads the same whichever outcome was rolled (the outcome only
// changes the effects), so a deadly outcome must also read right with "{a} did not survive it." after it.
//
// Ambient incidents cast `a` (and usually `b`, who is mostly a witness or the cause). Reactions name
// their parent's roles. Base comedy weights run 3–6 here (the engine's Templates in bundle.ts run 4–9).

/**
 * How often an accident kills (tuned in #44 towards 1–3 deaths a day across the world, #9): a deadly
 * outcome against the harmless one. An accident fires about 7 times a day, so about 0.5 deaths a day
 * come from accidents; Clashes and botched Dares supply the rest.
 */
export const ACCIDENT = { harmless: 12, deadly: 1 } as const;

/** An accident's outcomes: the harmless one (Infamy for `a`), and the rare deadly one. */
function accident(harmless: string, infamy: number, deadly: string, tag: NonNullable<OutcomeDef['death']>['tag']): OutcomeDef[] {
  return [
    { key: harmless, weight: ACCIDENT.harmless, infamy: { a: infamy } },
    { key: deadly, weight: ACCIDENT.deadly, death: { role: 'a', tag } },
  ];
}

const pair = (trait?: string) => [{ name: 'a', ...(trait ? { trait } : {}) }, { name: 'b' }];

// ---- One per Trait (16): `a` has the Trait. ----
const traits: TemplateDef[] = [
  {
    id: 'trait.glutton',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Glutton'),
    outcomes: [
      { key: 'stuffed', weight: 5, infamy: { a: 3 } },
      { key: 'wedged', weight: 2, infamy: { a: 6 } },
    ],
    lines: [
      '{a} ate the feast an hour before the feast. {b}, who cooked it, has gone for a long walk.',
      '{a} was found wedged in the pantry door with a ham under each arm. {b} has been asked to push and is refusing on principle.',
      "{a} challenged {b} to a pie-eating contest, then ate {b}'s pies as well. He has declared himself the winner of both.",
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.vain',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Vain'),
    outcomes: [
      { key: 'preened', weight: 4, infamy: { a: 2 } },
      { key: 'crushed', weight: 1, infamy: { a: 5 } },
    ],
    lines: [
      '{a} asked {b} whether he looked magnificent. {b} said "fine". {a} has not left his tent since.',
      '{a} commissioned a portrait of himself from {b}. {b} cannot paint, and has delivered a potato with tusks.',
      '{a} spent the morning polishing his tusks in a puddle. {b} stepped in it. Words were exchanged.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.mummys-boy',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair("Mummy's Boy"),
    outcomes: [{ key: 'mothered', weight: 1, infamy: { a: 3 } }],
    lines: [
      '{a} read a letter from his mum aloud in the mess hall. It mentioned his rash. {b} has told everyone who missed it.',
      'A parcel of clean pants arrived at the gate for {a}, from his mum. {b} signed for it and opened it in the yard.',
      '{a} told {b} that his mum could beat anyone in the fortress. {b} agreed far too quickly.',
    ],
    baseWeight: 5,
  },
  {
    id: 'trait.liar',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Compulsive Liar'),
    outcomes: [{ key: 'fibbed', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} told {b} he once killed a dragon with a spoon. By lunchtime it was two dragons and a fork.',
      "{a} has assured {b} he is the Warlord's cousin. The Warlord has no cousins. {a} says that is what they want you to think.",
      '{a} insists {b} owes him three teeth. {b} has never met him. {a} has produced a receipt, written in gravy.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.little-fortresser',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Little Fortresser'),
    outcomes: [
      { key: 'ranted', weight: 3, infamy: { a: 2 } },
      { key: 'locked-out', weight: 1, infamy: { a: 4 } },
    ],
    lines: [
      'A sign reading "FORTRESS FULL" has gone up at the gate. {a} put it there. {b} has been stuck outside since breakfast.',
      '{a} complained to {b} that the new latrine "is not how we used to do latrines". The latrine is a hole. It has always been a hole.',
      '{a} has launched a campaign to take back control of the courtyard from the pigeons. {b} is its only member, and was not asked.',
    ],
    baseWeight: 5,
  },
  {
    id: 'trait.coward',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Coward'),
    outcomes: [{ key: 'hid', weight: 1, infamy: { a: 3 } }],
    lines: [
      '{a} hid in a barrel when {b} sneezed. He is still in the barrel. He calls it "a tactical barrel".',
      "{a} surrendered to {b} halfway through an argument about soup. {b} has accepted, and now owns {a}'s boots.",
      '{a} ran away from his own shadow, and then from {b}, who was chasing him to explain about the shadow.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.hothead',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Hothead'),
    outcomes: [
      { key: 'raged', weight: 4, infamy: { a: 2 } },
      { key: 'concussed', weight: 1, infamy: { a: 5 } },
    ],
    lines: [
      '{a} headbutted a door because {b} said it was "a bit stiff". The door won.',
      '{a} lost his temper with {b} over the last chair, then broke the chair. Neither of them has a chair now.',
      '{a} challenged a wall to a fight after {b} leaned on it. The wall did not turn up. {a} is claiming the win.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.gullible',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Gullible'),
    outcomes: [{ key: 'conned', weight: 1, infamy: { a: 3 } }],
    lines: [
      '{b} sold {a} a magic bean. It was a pebble. {a} has planted it and waters it twice a day.',
      "{a} paid {b} three teeth for a map to the Warlord's secret treasure. The map is of the latrines. {a} has started digging.",
      '{b} told {a} that "gullible" is not a real word. {a} has gone to the library to check. The fortress has no library.',
    ],
    baseWeight: 5,
  },
  {
    // An accident: he gets up somewhere high on the way home.
    id: 'trait.drunkard',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Drunkard'),
    outcomes: accident('hungover', 3, 'fell-off', 'fell'),
    lines: [
      "{a} came home from the tavern by way of the keep roof, singing the fortress anthem at {b}'s window.",
      "{a} woke up on top of the gatehouse wearing {b}'s trousers. Nobody knows how he got up there. {b} would like the trousers back.",
      '{a} bet {b} he could walk the top of the castle wall after nine pints. He made it as far as pint seven.',
    ],
    baseWeight: 5,
  },
  {
    id: 'trait.snob',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Snob'),
    outcomes: [{ key: 'sneered', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} refused to share a table with {b} because {b} "eats like a peasant". {b} eats like an orc. So does {a}.',
      '{a} has asked {b} to address him as "your lordship". {b} has started calling him "your lardship".',
      '{a} held his nose all through supper because {b} was sitting downwind. {b} had just had a bath. {a} has not.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.hoarder',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Hoarder'),
    outcomes: [
      { key: 'hoarded', weight: 4, infamy: { a: 2 } },
      { key: 'buried', weight: 1, infamy: { a: 5 } },
    ],
    lines: [
      "{a} has been found with {b}'s spoon, {b}'s other spoon, and a door nobody can account for.",
      '{a} refused to lend {b} a bucket. He has four hundred buckets. He says they are "for later".',
      "{a}'s tent collapsed under the weight of his collection, with {b} inside it looking for his boots.",
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.superstitious',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Superstitious'),
    outcomes: [{ key: 'omen', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} refused to fight {b} because it was a Thudsday. {b} pointed out that it was Moanday. {a} still refused.',
      "{a} threw salt over his shoulder for luck. It went in {b}'s eyes. He did it again, for more luck.",
      '{a} says a crow told him {b} is cursed. He has been following {b} around with a lucky turnip ever since.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.show-off',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Show-off'),
    outcomes: [
      { key: 'flexed', weight: 4, infamy: { a: 3 } },
      { key: 'nicked', weight: 1, infamy: { a: 6 } },
    ],
    lines: [
      '{a} juggled three axes to impress {b}. He still has all his thumbs, and is counting them out loud to be sure.',
      '{a} did a hundred press-ups in the yard and asked {b} to count. {b} counted to eleven and went for lunch.',
      '{a} beat {b} at arm-wrestling in front of a crowd and has not stopped flexing since. {b} was holding a sandwich in the other hand.',
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.lazy',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Lazy'),
    outcomes: [{ key: 'napped', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} was found asleep on guard duty. When {b} woke him, he asked for five more minutes and a blanket.',
      '{a} has paid {b} a shiny pebble to do his chores. {b} has paid a goat to do them. Nobody has told the goat.',
      '{a} missed lunch because it was "too far away". It was in the next room. {b} ate it for him.',
    ],
    baseWeight: 3,
  },
  {
    id: 'trait.sore-loser',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Sore Loser'),
    outcomes: [{ key: 'sulked', weight: 1, infamy: { a: 3 } }],
    lines: [
      '{a} lost to {b} at knucklebones and has demanded a recount. Of the knuckles.',
      '{a} flipped the table when {b} won at cards. It was a stone table. It flipped back.',
      "{a} lost a staring contest to {b} and has lodged a formal complaint about {b}'s eyes.",
    ],
    baseWeight: 4,
  },
  {
    id: 'trait.sleepwalker',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair('Sleepwalker'),
    outcomes: [{ key: 'wandered', weight: 1, infamy: { a: 2 } }],
    lines: [
      "{a} sleepwalked into {b}'s tent, ate {b}'s supper and tucked {b} in. Neither of them will discuss it.",
      '{a} was found asleep on the battlements, saluting. {b} saluted back, just in case.',
      '{a} sleepwalked into the armoury and came out in full plate. {b} has spent the morning trying to get him out of it.',
    ],
    baseWeight: 4,
  },
];

// ---- One per Fear (10, tagged), most of them accidents, plus the other accidents. ----
// Fears can't be a cast precondition yet (the sim checks Traits only), so these cast anyone and the line
// never claims he has the Fear: the event plays on it, and reads just as well on a fearless orc.
const fearsAndAccidents: TemplateDef[] = [
  {
    id: 'fear.water',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Water', 'Puddles'],
    roles: pair(),
    outcomes: [{ key: 'splashed', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} refused to cross a puddle and has been standing at the edge of it since breakfast. {b} is selling tickets.',
      '{b} flicked water at {a} by the well. {a} has declared it an act of war, and gone to lie down until the war starts.',
      '{a} was caught in a shower and ran screaming into the armoury. {b} says it was "barely a drizzle".',
    ],
    baseWeight: 4,
  },
  {
    id: 'accident.cellar',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['The Dark'],
    roles: pair(),
    outcomes: accident('spooked', 3, 'fell', 'fell'),
    lines: [
      '{b} took the only candle out of the cellar while {a} was still in it. {a} found the stairs the quick way.',
      '{a} went down to the cellar for a barrel and came up screaming that {b} was a ghost. {b} was holding the candle.',
      '{a} was sent to the cellar for pickles, and {b} blew his candle out for a laugh. The pickles turned up first.',
    ],
    baseWeight: 4,
  },
  {
    id: 'accident.goose',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Birds'],
    roles: pair(),
    outcomes: accident('pecked', 4, 'savaged', 'mauled'),
    lines: [
      '{a} was attacked by the gatehouse goose while {b} watched and offered tips.',
      "{a} tried to shoo a pigeon off {b}'s pie. Forty more pigeons came to help it.",
      '{a} and {b} were chased round the yard by a goose. Only {b} admits it was a goose. {a} says it was a bear.',
    ],
    baseWeight: 5,
  },
  {
    id: 'accident.surgeon',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Doctors'],
    roles: pair(),
    outcomes: accident('treated', 3, 'cured', 'poisoned'),
    lines: [
      '{b} took {a} to the fortress surgeon about a splinter. The surgeon prescribed leeches, a hymn and a "tonic".',
      '{a} let the surgeon "have a quick look" while {b} held him down. The surgeon looked for an hour.',
      '{a} swallowed a cure-all that {b} bought off a travelling quack. It cured nothing, and then some.',
    ],
    baseWeight: 4,
  },
  {
    id: 'fear.soap',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Soap'],
    roles: pair(),
    outcomes: [{ key: 'washed', weight: 1, infamy: { a: 3 } }],
    lines: [
      "{b} hid a bar of soap in {a}'s boot. {a} has burnt the boot, and the soap, and very nearly {b}.",
      '{a} was accidentally washed when {b} fell into the laundry tub on top of him. He has been rolling in mud to recover.',
      '{a} smelt soap on {b} and fainted. He has asked for {b} to be moved downwind, for good.',
    ],
    baseWeight: 4,
  },
  {
    id: 'accident.cat',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Cats'],
    roles: pair(),
    outcomes: accident('scratched', 3, 'mauled', 'mauled'),
    lines: [
      "{a} trod on the quartermaster's cat. The cat has not let it go. Neither has {b}, who saw everything.",
      '{a} lost a staring contest with the kitchen cat, and then the fight that followed. {b} held his coat.',
      "{b} put the cat in {a}'s helmet for a laugh. {a} put the helmet on.",
    ],
    baseWeight: 5,
  },
  {
    id: 'fear.laughed-at',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Being Laughed At'],
    roles: pair(),
    // `mocked` can send a Hothead straight for {b} (clash.mocked).
    outcomes: [{ key: 'mocked', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{b} laughed at a joke. {a} assumed it was about him. It was not, but it is now.',
      '{a} tripped in the yard and caught {b} smirking. {b} says it was wind. {a} is taking it to the Warlord.',
      '{a} gave the troops a rousing speech. {b} laughed in the middle of it. {a} has started the speech again from the top, twice.',
    ],
    baseWeight: 4,
  },
  {
    id: 'accident.small-dog',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Small Dogs'],
    roles: pair(),
    outcomes: accident('yapped', 3, 'fell', 'fell'),
    lines: [
      "{a} was chased up a tree by the cook's small dog. {b} has gone to fetch a ladder by the longest route he knows.",
      '{a} climbed onto the well to escape a small dog. {b} has pointed out that the small dog is a slipper.',
      '{a} fled across the rooftops from a terrier while {b} shouted encouragement to the terrier.',
    ],
    baseWeight: 5,
  },
  {
    id: 'fear.his-mum',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['His Mum'],
    roles: pair(),
    outcomes: [{ key: 'mum-sighted', weight: 1, infamy: { a: 3 } }],
    lines: [
      "Word is that {a}'s mum is visiting. {a} is hiding in {b}'s tent and has asked {b} to say he is away at war.",
      "A letter from {a}'s mum has arrived for {b}, asking him to keep an eye on her boy. {b} is taking the job very seriously.",
      "{b} did an impression of {a}'s mum. {a} stood up straight, tucked his shirt in and apologised before he could stop himself.",
    ],
    baseWeight: 5,
  },
  {
    id: 'accident.stairs',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Stairs', 'Heights'],
    roles: pair(),
    outcomes: accident('tumbled', 3, 'fell', 'fell'),
    lines: [
      '{a} fell down all of the tower stairs while telling {b} to mind the stairs.',
      '{a} raced {b} down the tower stairs and won, by not using most of them.',
      '{a} tried to slide down the banister to impress {b}. There is no banister.',
    ],
    baseWeight: 4,
  },
  {
    id: 'accident.kitchen',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Glutton'],
    roles: pair(),
    outcomes: accident('singed', 4, 'burnt', 'burnt'),
    lines: [
      '{a} tried to cook {b} a birthday pie and set fire to the kitchen, the pie and his own eyebrows.',
      '{a} and {b} tried to roast a whole boar indoors. The boar is fine.',
      '{a} lit the great hall fire with lamp oil while {b} asked "is that a good idea". It was not.',
    ],
    baseWeight: 5,
  },
  {
    id: 'accident.portcullis',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [
      { key: 'scraped', weight: ACCIDENT.harmless, infamy: { a: 3, b: 2 } },
      { key: 'squashed', weight: ACCIDENT.deadly, death: { role: 'a', tag: 'squashed' }, infamy: { b: 5 } },
    ],
    lines: [
      '{a} was standing under the portcullis when {b} leaned on the lever to tie his boot.',
      '{b} asked {a} to "hold the gate a sec". It was the portcullis.',
      '{a} raced the portcullis down for a bet with {b}. The portcullis is unbeaten.',
    ],
    baseWeight: 5,
  },
  {
    id: 'accident.mushroom',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Gullible'],
    roles: pair(),
    outcomes: accident('queasy', 3, 'poisoned', 'poisoned'),
    lines: [
      '{a} ate a mushroom from behind the latrines because {b} said it was "basically a pie".',
      "{b} bet {a} he wouldn't eat the green cheese. He would. He ate the blue bit too.",
      '{a} drank from the bottle with the skull on it because {b} said it was "pirate rum".',
    ],
    baseWeight: 4,
  },
];

// ---- Aimed at the Warlord (6). The sim can't cast the Warlord yet, so these are about him, off-stage. ----
const warlord: TemplateDef[] = [
  {
    id: 'warlord.throne',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'caught', weight: 1, infamy: { a: 4 } }],
    lines: [
      '{a} was caught sitting on the throne "to warm it up for the Warlord". {b} told on him for a pie.',
      "{a} has been trying on the Warlord's crown in the latrines. {b} heard him practising the speech.",
      '{a} and {b} were found arguing over who gets the throne "when it\'s free". It was not free. The Warlord was sitting on it.',
    ],
    baseWeight: 6,
  },
  {
    id: 'warlord.speech',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'misspoke', weight: 1, infamy: { a: 3 } }],
    lines: [
      "{a} has been writing the Warlord's speeches. {b} read one out at muster. It was a shopping list.",
      '{a} told {b} the Warlord\'s new decree is "exit means exit". Nobody knows which exit. Three orcs have left.',
      '{a} has been doing impressions of the Warlord. {b} says they are very good. The Warlord was standing behind {b}.',
    ],
    baseWeight: 5,
  },
  {
    id: 'warlord.plot',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'plotted', weight: 1, infamy: { a: 4, b: 4 } }],
    lines: [
      '{a} and {b} have been plotting to overthrow the Warlord. Their plan is to ask him nicely.',
      '{a} has drawn up a plan to seize the throne. {b} has drawn a moustache on it.',
      '{a} and {b} met in secret to plot a coup, forgot which of them was in charge, and had a fight instead.',
    ],
    baseWeight: 6,
  },
  {
    // An accident: the job is what it says.
    id: 'warlord.taster',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: accident('tasted', 3, 'poisoned', 'poisoned'),
    lines: [
      "{a} has been made the Warlord's food taster. {b} has been \"seasoning\" the soup to keep him sharp.",
      "{a} tasted the Warlord's supper and pronounced it safe. {b} says it was the dog's.",
      "{b} swapped the Warlord's cup with {a}'s for a joke. {a} drank it to be polite.",
    ],
    baseWeight: 6,
  },
  {
    id: 'warlord.portrait',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'defaced', weight: 1, infamy: { a: 3 } }],
    lines: [
      "Someone drew a moustache on the Warlord's portrait. {a} has blamed {b}. {b} does not own a pen. {a} has ink on his tusks.",
      "{a} was asked to paint the Warlord's portrait and painted himself instead. {b} says it is an improvement.",
      "{a} hung the Warlord's portrait upside down in the great hall. {b} says it was always upside down.",
    ],
    baseWeight: 5,
  },
  {
    id: 'warlord.decree',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'decreed', weight: 1, infamy: { a: 3 } }],
    lines: [
      'The Warlord has banned {a} from the kitchens after an incident with {b} and a trifle. {a} is appealing.',
      '{a} is on latrine duty for a week after {b} reported him for snoring through a council of war.',
      'By order of the Warlord, {a} must stay ten paces from {b} at all times. They share a tent.',
    ],
    baseWeight: 5,
  },
];

// ---- General (6): falling out, making up, drink, theft, queues, and Susan. ----
const general: TemplateDef[] = [
  {
    id: 'general.making-up',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'made-up', weight: 1 }],
    lines: [
      '{a} and {b} have made up over a pint. It lasted until the second pint.',
      '{a} has written {b} an apology. It says "sorry you were wrong". {b} has accepted it.',
      '{a} and {b} have hugged it out in the yard. Several ribs are being looked at.',
    ],
    baseWeight: 3,
  },
  {
    id: 'general.tavern',
    kind: 'incident',
    trigger: 'ambient',
    tags: ['Drunkard'],
    roles: pair(),
    outcomes: [{ key: 'barred', weight: 1, infamy: { a: 3, b: 3 } }],
    lines: [
      '{a} and {b} went to the tavern for "a quick one". The tavern has asked them not to come back.',
      '{a} and {b} argued all night about whether the moat is a lake. It was settled with a fight. It is now a lake.',
      '{a} bought {b} a drink. {b} bought {a} a drink. Nobody has seen either of them since Tusksday.',
    ],
    baseWeight: 4,
  },
  {
    id: 'general.boots',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'nicked', weight: 1, infamy: { a: 2 } }],
    lines: [
      "{a} stole {b}'s boots. {b} stole them back. They are now wearing one each and are not speaking.",
      "{a} has been caught selling {b}'s helmet back to {b}.",
      "{b}'s lucky spoon has gone missing. {a} is eating soup with it in plain sight.",
    ],
    baseWeight: 4,
  },
  {
    id: 'general.queue',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'queued', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} pushed in front of {b} in the latrine queue. {b} has been queuing in protest ever since.',
      '{a} and {b} have started two rival queues for the one latrine. Neither queue is moving.',
      '{a} told {b} that in the old days you queued for the latrine properly. {b} pointed out that in the old days there was no latrine.',
    ],
    baseWeight: 4,
  },
  {
    id: 'general.susan',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'excused', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} told {b} he would be home for tea. He has not been home for tea in nine years. Susan is not having it.',
      '{a} has asked {b} to cover for him with Susan. {b} has no idea who Susan is. Nobody does.',
      '{a} says he will fix the tent flap "this weekend". {b} says Susan has heard that one before.',
    ],
    baseWeight: 4,
  },
  {
    id: 'general.old-days',
    kind: 'incident',
    trigger: 'ambient',
    roles: pair(),
    outcomes: [{ key: 'ranted', weight: 1, infamy: { a: 2 } }],
    lines: [
      '{a} told {b} that back in his day orcs were proper orcs. {b} asked when his day was. {a} said Tusksday.',
      '{a} told {b} the fortress "was better before", and could not say before what.',
      '{a} has started telling {b} that "you can\'t say anything these days". He says it all day, every day.',
    ],
    baseWeight: 4,
  },
];

// ---- Reactions: what happens next. One fires per story head at most (first match, slug order). ----
const reactions: TemplateDef[] = [
  // After a landed Rumour (5).
  {
    id: 'reaction.rumour-denial',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'rumour', outcomes: ['works'], chance: 0.25 },
    roles: [{ name: 'source', from: 'source' }, { name: 'target', from: 'target' }],
    outcomes: [{ key: 'denied', weight: 1, infamy: { source: 2 } }],
    lines: [
      '{source} has denied everything to {target}, at length, in a song he wrote for the purpose.',
      '{source} swears he never said it. {target} says that is exactly what someone who said it would say.',
      '{source} has put up a notice saying he did not say it. {target} has drawn on the notice.',
    ],
    baseWeight: 4,
  },
  {
    id: 'reaction.rumour-astray',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'rumour', outcomes: ['wrong_orc'], chance: 0.3 },
    roles: [{ name: 'reached', from: 'reached' }, { name: 'target', from: 'target' }],
    outcomes: [{ key: 'muddled', weight: 1, infamy: { reached: 2 } }],
    lines: [
      '{reached} has confronted {target} about a rumour that was about {target}. Both are now angry, and neither knows why.',
      '{reached} has asked {target} to stop spreading things. {target} had not spread anything. He has started.',
      '{reached} keeps telling {target} what he heard. {target} keeps saying "that was meant for me". It has not helped.',
    ],
    baseWeight: 5,
  },
  {
    id: 'reaction.rumour-grows',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'rumour', outcomes: ['garbled'], chance: 0.3 },
    roles: [{ name: 'target', from: 'target' }, { name: 'source', from: 'source' }],
    outcomes: [{ key: 'embellished', weight: 1, infamy: { target: 2 } }],
    lines: [
      '{target} has added his own bit to the rumour about {source}, and now believes that too.',
      'The rumour about {source} keeps growing. {target} was heard adding a goat to it.',
      '{target} has asked {source} to explain himself. {source} cannot, because none of it happened.',
    ],
    baseWeight: 5,
  },
  {
    id: 'reaction.rumour-gullible',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'rumour', outcomes: ['works', 'garbled'], chance: 0.4 },
    roles: [{ name: 'target', from: 'target', trait: 'Gullible' }, { name: 'source', from: 'source' }],
    outcomes: [{ key: 'repeated', weight: 1, infamy: { target: 2 } }],
    lines: [
      '{target} believed every word, and has started repeating the rumour about {source} to {source}.',
      "{target} has written the rumour down so he does not forget it, and pinned it to {source}'s door.",
      '{target} believed it so completely that he has apologised to {source} for it.',
    ],
    baseWeight: 4,
  },
  {
    id: 'reaction.rumour-mum',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'rumour', outcomes: ['works', 'garbled'], chance: 0.4 },
    roles: [{ name: 'target', from: 'target', trait: "Mummy's Boy" }, { name: 'source', from: 'source' }],
    outcomes: [{ key: 'told-mum', weight: 1, infamy: { target: 3 } }],
    lines: [
      '{target} has written to his mum about what {source} said. She is said to be "coming up".',
      '{target} has told his mum on {source}. A strongly worded parcel is on its way.',
      '{target} sent word to his mum about {source} by pigeon. The pigeon has come back with a reply for {source}, and it is not polite.',
    ],
    baseWeight: 5,
  },
  // After a Clash (6, with reaction.sulk in bundle.ts).
  {
    id: 'reaction.clash-gloat',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'clash', outcomes: ['won', 'defeated'], chance: 0.4 },
    roles: [{ name: 'winner', from: 'winner', trait: 'Show-off' }, { name: 'loser', from: 'loser' }],
    outcomes: [{ key: 'gloated', weight: 1, infamy: { winner: 3 } }],
    lines: [
      '{winner} has had a medal made for beating {loser}. He made it himself, out of a pie tin.',
      '{winner} has re-enacted his win over {loser} four times in the yard, playing both parts.',
      '{winner} has written a song about beating {loser}. It has eleven verses, and every one rhymes with his own name.',
    ],
    baseWeight: 4,
  },
  {
    id: 'reaction.clash-mum',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'clash', outcomes: ['won', 'defeated'], chance: 0.4 },
    roles: [{ name: 'loser', from: 'loser', trait: "Mummy's Boy" }, { name: 'winner', from: 'winner' }],
    outcomes: [{ key: 'sent-for-mum', weight: 1, infamy: { loser: 3 } }],
    lines: [
      '{loser} has written to his mum about {winner}. She has written back to {winner}, and it is not a nice letter.',
      '{loser} is telling everyone his mum could have {winner}. Nobody has disagreed.',
      '{loser} has sent for his mum. {winner} has started sleeping with a chair against the door.',
    ],
    baseWeight: 5,
  },
  {
    id: 'reaction.fled-boot',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'clash', outcomes: ['fled'], chance: 0.4 },
    roles: [{ name: 'winner', from: 'winner' }, { name: 'loser', from: 'loser' }],
    outcomes: [{ key: 'mocked-fled', weight: 1, infamy: { loser: 2 } }],
    lines: [
      "{winner} has hung {loser}'s boot over the gate as a warning to other boots.",
      '{loser} says he did not run from {winner}, he "went for help". He came back with a sandwich.',
      "{winner} has been making chicken noises outside {loser}'s tent all evening.",
    ],
    baseWeight: 4,
  },
  {
    id: 'reaction.handshake',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'clash', outcomes: ['won', 'defeated'], chance: 0.1 },
    roles: [{ name: 'winner', from: 'winner' }, { name: 'loser', from: 'loser' }],
    outcomes: [{ key: 'shook', weight: 1 }],
    lines: [
      '{winner} and {loser} have shaken hands and made up. {loser} has counted his fingers twice since.',
      "{winner} has helped {loser} up, dusted him off and taken his lunch. They're calling it even.",
      '{loser} has bought {winner} a pint "for a good clean fight". The pint has been checked for poison twice.',
    ],
    baseWeight: 3,
  },
  {
    id: 'reaction.saviour-claims',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'clash', chance: 0.5 },
    roles: [{ name: 'saviour', from: 'saviour' }, { name: 'loser', from: 'loser' }],
    outcomes: [{ key: 'claimed', weight: 1, infamy: { saviour: 2 } }],
    lines: [
      '{saviour} is telling everyone he saved {loser}. {loser} is telling everyone else what actually happened.',
      '{saviour} has asked {loser} for a thank-you note. {loser} has sent one. It is a brick.',
      '{saviour} has put himself forward for a medal for rescuing {loser}. {loser} is still lying where he left him.',
    ],
    baseWeight: 5,
  },
  // After a Dare (2).
  {
    id: 'reaction.dare-copycat',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'dare', outcomes: ['pulled_off'], chance: 0.3 },
    roles: [{ name: 'copycat', trait: 'Show-off' }, { name: 'target', from: 'target' }],
    outcomes: [
      { key: 'copied', weight: 6, infamy: { copycat: 4 } },
      { key: 'copied-fatally', weight: 1, death: { role: 'copycat', tag: 'botched' } },
    ],
    lines: [
      '{copycat} saw {target} do it and tried it himself, to show it was easy. It was not easy.',
      'Not to be outdone by {target}, {copycat} tried the same thing twice as fast, and half as well.',
      '{copycat} says he could have done what {target} did "in his sleep". He tried it awake. That did not go well either.',
    ],
    baseWeight: 5,
  },
  {
    id: 'reaction.dare-heckled',
    kind: 'incident',
    trigger: 'reaction',
    after: { kind: 'dare', outcomes: ['refused'], chance: 0.35 },
    roles: [{ name: 'heckler' }, { name: 'target', from: 'target' }],
    outcomes: [{ key: 'heckled', weight: 1, infamy: { target: 2 } }],
    lines: [
      '{heckler} has been clucking at {target} all afternoon.',
      '{heckler} offered to do what {target} would not, "for a pie". He has not done it, but he has had the pie.',
      '{heckler} has told the mess hall that {target} said no. {target} says he said "not today", which is different.',
    ],
    baseWeight: 4,
  },
  // Clashes a reaction can force (2). Their `{tag}` is the Grudge the starter holds, if any; `{result}` the outcome.
  {
    id: 'clash.mocked',
    kind: 'clash',
    trigger: 'reaction',
    after: { kind: 'incident', outcomes: ['mocked', 'conned'], chance: 0.5 },
    roles: [
      { name: 'a', from: 'a', trait: 'Hothead' },
      { name: 'b', from: 'b' },
    ],
    slots: ['tag', 'result'],
    outcomes: [
      { key: 'won', weight: 1 },
      { key: 'defeated', weight: 1 },
      { key: 'fled', weight: 1 },
    ],
    lines: [
      '{a} decided {b} was making a fool of him, and went for him. {result}',
      '{a}, a Hothead, did not find it funny, and made sure {b} did not either. {result}',
      '{a} answered {b} the only way he knows. {result}',
    ],
    baseWeight: 7,
  },
  {
    id: 'clash.rematch',
    kind: 'clash',
    trigger: 'reaction',
    after: { kind: 'clash', outcomes: ['won', 'defeated'], chance: 0.25 },
    roles: [
      { name: 'a', from: 'loser', trait: 'Sore Loser' },
      { name: 'b', from: 'winner' },
    ],
    slots: ['tag', 'result'],
    outcomes: [
      { key: 'won', weight: 1 },
      { key: 'defeated', weight: 1 },
      { key: 'fled', weight: 1 },
    ],
    lines: [
      '{a} demanded a rematch with {b}, who {tag}. {result}',
      'Still smarting, {a} went straight back for {b}, who {tag}. {result}',
      '{a} said the first one did not count, and went for {b} again. {result}',
    ],
    baseWeight: 7,
  },
];

/** The v1 catalogue's Templates, on top of the engine's own in bundle.ts. */
export const catalogue: TemplateDef[] = [...traits, ...fearsAndAccidents, ...warlord, ...general, ...reactions];
