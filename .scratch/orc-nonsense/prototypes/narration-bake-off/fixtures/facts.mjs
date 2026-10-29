// ~30 hand-written Clash Facts. Shape mirrors ticket 11's Clash call inputs.
// `invites` marks what the Fact invites (profanity, c-word, your-mum, innuendo) for the softening detector.
// `blame` / `accusation` are here on purpose: the prompt builder must strip them.
// `tags` is bookkeeping for coverage only and is never sent.

const F = (id, a, b, winner, result, why, more = {}) => ({
  id, a, b, winner, loser: winner === a ? b : a, result, why, grudges: [], invites: ['profanity'], tags: [], ...more,
});

export const FACTS = [
  // The GDD worked example: misfired Rumour + wrong saviour + Trophy + drowning.
  F('gdd-bucket', 'snarlbottom', 'krug', 'snarlbottom', 'DEFEATED',
    'Rumour (wrong orc): "Krúg says Grishnack\'s helmet is a bucket" misfired onto Lord Snarlbottom, who really is wearing a bucket.',
    { saviour: 'mudgut', aftermath: 'Old Mudgut "rescued" Krúg because Krúg was standing near the pies, then ate the pies. Krúg drowned in 30cm of moat.',
      trophy: { item: 'nose ring', from: 'krug', to: 'snarlbottom' }, grudges: ['snarlbottom → krug: "called my helmet a bucket"'],
      blame: 'Rumour planted by Haris', invites: ['profanity', 'c-word'], tags: ['rumour-wrong-orc', 'saviour', 'trophy', 'death'] }),

  F('mum-garbled', 'grishnack', 'krug', 'grishnack', 'DEFEATED',
    'Rumour (garbled): planted as "Krúg says Grishnack\'s beard is patchy", it escalated up the ladder to "Krúg fancies Grishnack\'s mum".',
    { grudges: ['grishnack → krug: "fancies my mum"'], invites: ['profanity', 'your-mum', 'innuendo'], blame: 'Rumour planted by Dev', tags: ['rumour-garbled', 'your-mum'] }),

  F('mum-works', 'skagrot', 'vorgash', 'vorgash', 'DEFEATED',
    'Rumour (works): "Vorgash says Skagrot\'s mum polishes HIS tusks." Skagrot, Gullible, believed every word.',
    { grudges: ['skagrot → vorgash: "says my mum polishes his tusks"'], rumourLine: 'tell him his mum was round mine last night, twice', invites: ['profanity', 'your-mum', 'innuendo'], tags: ['rumour-works', 'player-line', 'your-mum'] }),

  F('goose', 'skagrot', 'glumnak', 'skagrot', 'SOMEHOW WON',
    'Rumour (works): "Glumnak says Skagrot is scared of geese." Skagrot mocked Glumnak instead; a goose appeared mid-Clash and attacked Glumnak.',
    { trophy: { item: 'lucky rabbit foot', from: 'glumnak', to: 'skagrot' }, grudges: ['glumnak → skagrot: "set a goose on me"'], tags: ['rumour-fear', 'trophy'] }),

  F('dare-moat', 'krug', 'grubbock', 'grubbock', 'DEFEATED',
    'Dare (botched): Krúg was dared to swim the moat, his Fear. Big Grubbock laughed from the bank. Krúg climbed out and swung at him.',
    { aftermath: 'Krúg slipped back into the moat and had to be fished out with a pie fork.', invites: ['profanity', 'c-word'], blame: 'Dare set by Haris', tags: ['dare-botched', 'fear'] }),

  F('dare-throne', 'gristlewick', 'vorgash', 'vorgash', 'DEFEATED',
    'Prank dare (pulled off, then caught): Sir Gristlewick sat on the Warlord\'s throne for eleven seconds. Vorgash the Polished found him there.',
    { trophy: { item: 'monogrammed cushion', from: 'gristlewick', to: 'vorgash' }, grudges: ['vorgash → gristlewick: "sat on my throne"'], tags: ['dare-prank', 'trophy'] }),

  F('dare-pie', 'mudgut', 'gobblak', 'mudgut', 'SOMEHOW WON',
    'Dare (pulled off): Old Mudgut was dared to eat the cursed pie. He ate it, and the plate. Gobblak, jealous, claimed the pie was his.',
    { grudges: ['gobblak → mudgut: "ate my cursed pie"'], tags: ['dare-pulled-off', 'jealous'] }),

  F('dare-refused', 'grimbo', 'grishnack', 'grishnack', 'FLED',
    'Dare (refused): Grimbo was dared to sleep in the haunted latrine. He bottled it. Grishnack called him a coward to his bandaged face.',
    { aftermath: 'Grimbo fled screaming for his mum.', invites: ['profanity', 'your-mum'], tags: ['dare-refused', 'muffled'] }),

  F('nose-ring-back', 'krug', 'snarlbottom', 'krug', 'SOMEHOW WON',
    'Rumour (works, theft claim): "Snarlbottom says he still wears Krúg\'s nose ring in the bath." Krúg went to steal it back.',
    { trophy: { item: 'nose ring', from: 'snarlbottom', to: 'krug' }, grudges: ['snarlbottom → krug: "called my helmet a bucket"', 'krug → snarlbottom: "nicked my nose ring"'], tags: ['rumour-theft', 'trophy', 'callback'] }),

  F('coup', 'vorgash', 'vrakka', 'vorgash', 'DEFEATED',
    'Rumour (works, coup claim): "Vrakka is planning a coup." Vrakka, a Sleepwalker, was found asleep on the battlements holding a map. Vorgash struck first.',
    { tags: ['rumour-coup'], invites: ['profanity'] }),

  F('saviour-gobblak', 'grishnack', 'skagrot', 'grishnack', 'DEFEATED',
    'Grudge flare-up: Grishnack and Skagrot both claim the same wall they each headbutted.',
    { saviour: 'gobblak', aftermath: 'Gobblak, drunk, "saved" Skagrot by throwing a full tankard, which hit Skagrot.', grudges: ['skagrot → grishnack: "stole my wall"'], tags: ['saviour', 'grudge'] }),

  F('saviour-grubbock', 'gristlewick', 'glumnak', 'glumnak', 'DEFEATED',
    'Rumour (wrong orc): meant for Vorgash, "Glumnak says your tusks are fake" reached Sir Gristlewick, who hoards false tusks.',
    { saviour: 'grubbock', aftermath: 'Big Grubbock charged in to help Gristlewick, slipped on black pudding and flattened him.',
      trophy: { item: 'false tusks (set of nine)', from: 'gristlewick', to: 'glumnak' }, tags: ['rumour-wrong-orc', 'saviour', 'trophy'] }),

  F('cword-krug', 'krug', 'skagrot', 'skagrot', 'DEFEATED',
    'Rumour (works, insult): "Krúg says Skagrot nuts walls because walls are the only thing that\'ll have him."',
    { grudges: ['skagrot → krug: "said walls are the only thing that\'ll have me"'], invites: ['profanity', 'c-word', 'innuendo'], tags: ['rumour-works', 'c-word'] }),

  F('cword-vorgash', 'vorgash', 'grishnack', 'vorgash', 'DEFEATED',
    'Grudge flare-up: Grishnack laughed at Vorgash\'s reflection. Being Laughed At is Vorgash\'s Fear.',
    { grudges: ['vorgash → grishnack: "laughed at my tusks"'], invites: ['profanity', 'c-word'], tags: ['fear', 'c-word'] }),

  F('player-line-1', 'mudgut', 'snarlbottom', 'snarlbottom', 'DEFEATED',
    'Rumour (works, insult): "Snarlbottom says Mudgut\'s belly has its own postcode."',
    { rumourLine: 'Mudgut is so fat his mum needs planning permission to hug him', invites: ['profanity', 'your-mum'], tags: ['player-line', 'your-mum'] }),

  F('player-line-2', 'glumnak', 'krug', 'krug', 'SOMEHOW WON',
    'Rumour (garbled): "Glumnak says Krúg is scared of puddles" garbled into "Glumnak is planning a coup with the puddles".',
    { rumourLine: 'krug is a damp little coward and everyone knows it', grudges: ['krug → glumnak: "plotting with the puddles"'], tags: ['player-line', 'rumour-garbled'] }),

  F('player-line-3', 'vrakka', 'gobblak', 'gobblak', 'DEFEATED',
    'Rumour (wrong orc): meant for Krúg, "Vrakka says you sleep with a teddy" reached Gobblak, who does.',
    { rumourLine: 'vrakka says gobblak spoons his teddy and calls it Susan', invites: ['profanity', 'innuendo'], tags: ['player-line', 'rumour-wrong-orc', 'susan'] }),

  F('susan', 'krug', 'gristlewick', 'krug', 'SOMEHOW WON',
    'Dare (pulled off, prank): Krúg was dared to nick Sir Gristlewick\'s hoard of spoons. He got three.',
    { trophy: { item: 'three silver spoons', from: 'gristlewick', to: 'krug' }, aftermath: 'Susan is not having the spoons in the house.', tags: ['dare-prank', 'trophy', 'susan'] }),

  F('muffled-1', 'grimbo', 'mudgut', 'mudgut', 'DEFEATED',
    'Grudge flare-up: Grimbo accused Mudgut of eating the soup vat he drowned in.',
    { grudges: ['grimbo → mudgut: "ate my soup vat"'], tags: ['muffled', 'grudge'] }),

  F('muffled-2', 'grimbo', 'snarlbottom', 'grimbo', 'SOMEHOW WON',
    'Rumour (works, mum claim): "Snarlbottom says Grimbo\'s mum wrapped him like a kebab." Grimbo, enraged, won by accident: he couldn\'t see and ran straight through.',
    { invites: ['profanity', 'your-mum'], trophy: { item: 'heritage helm (bucket)', from: 'snarlbottom', to: 'grimbo' }, tags: ['muffled', 'your-mum', 'trophy'] }),

  F('black-pudding', 'grubbock', 'vrakka', 'grubbock', 'DEFEATED',
    'Rumour (works, insult): "Vrakka says black pudding is just a sausage that gave up." Big Grubbock took it personally.',
    { tags: ['catchphrase', 'class'] }),

  F('class-toff', 'snarlbottom', 'skagrot', 'skagrot', 'DEFEATED',
    'Grudge flare-up: Snarlbottom called Skagrot a peasant. Skagrot nutted the bucket.',
    { grudges: ['skagrot → snarlbottom: "called me a peasant"'], trophy: { item: 'monocle', from: 'snarlbottom', to: 'skagrot' }, invites: ['profanity', 'c-word'], tags: ['class', 'trophy'] }),

  F('return-vendetta', 'krug', 'snarlbottom', 'snarlbottom', 'FLED',
    'Return vendetta: Krúg the Damp Returned bandaged and afraid of puddles. He challenged Snarlbottom, saw a puddle between them, and ran.',
    { grudges: ['krug → snarlbottom: "drowned me"'], aftermath: 'Krúg fled.', tags: ['return', 'fear'] }),

  F('liar', 'glumnak', 'grishnack', 'grishnack', 'DEFEATED',
    'Rumour (garbled; source is a Compulsive Liar): "Glumnak says Grishnack\'s sword is small" escalated to "Glumnak says Grishnack nicked the Warlord\'s throne".',
    { invites: ['profanity', 'innuendo'], tags: ['rumour-garbled', 'innuendo'] }),

  F('hothead', 'grishnack', 'mudgut', 'mudgut', 'DEFEATED',
    'Dare (prank, Hothead turned it into a Clash): Grishnack was dared to hide Old Mudgut\'s dinner. He threw it at him instead.',
    { saviour: 'gobblak', aftermath: 'Gobblak "saved" the dinner by eating it mid-air.', invites: ['profanity'], tags: ['dare-prank', 'saviour'] }),

  F('heights', 'mudgut', 'vorgash', 'vorgash', 'DEFEATED',
    'Dare (botched): Old Mudgut was dared to climb the Warlord\'s banner pole. Heights are his Fear. He got one foot up.',
    { aftermath: 'He fell onto Vorgash, who blamed him for scuffing his tusks.', tags: ['dare-botched', 'fear'] }),

  F('cats', 'vrakka', 'gristlewick', 'gristlewick', 'SOMEHOW WON',
    'Rumour (works, Fear exposed): "Gristlewick says Vrakka is scared of cats." Gristlewick won by hiding behind his hoarded cat-shaped cushion.',
    { tags: ['rumour-fear'] }),

  F('your-mum-cword', 'gobblak', 'krug', 'krug', 'SOMEHOW WON',
    'Rumour (garbled): "Gobblak says Krúg\'s gear is rusty" escalated to "Gobblak fancies Krúg\'s mum". Krúg, a Mummy\'s Boy, went berserk and somehow won.',
    { invites: ['profanity', 'c-word', 'your-mum', 'innuendo'], trophy: { item: 'drinking horn', from: 'gobblak', to: 'krug' }, blame: 'Rumour planted by Dev', accusation: 'Krúg blames Hairy for it', tags: ['your-mum', 'c-word', 'trophy'] }),

  F('show-off', 'vorgash', 'skagrot', 'skagrot', 'DEFEATED',
    'Dare (botched, Show-off never refuses): Vorgash was dared to juggle three knives while posing. Skagrot laughed. Vorgash lost a tusk.',
    { trophy: { item: 'polished tusk', from: 'vorgash', to: 'skagrot' }, invites: ['profanity', 'c-word'], tags: ['dare-botched', 'trophy', 'fear'] }),

  F('soap', 'gobblak', 'snarlbottom', 'snarlbottom', 'DEFEATED',
    'Rumour (wrong orc): "Snarlbottom says you smell" meant for Krúg reached Gobblak. Both of them fear Soap. Snarlbottom brought soap anyway, holding it with tongs.',
    { saviour: 'krug', aftermath: 'Krúg arrived to help, shouting "exit means exit", and pushed Gobblak into the wash tub.', tags: ['rumour-wrong-orc', 'saviour'] }),
];
