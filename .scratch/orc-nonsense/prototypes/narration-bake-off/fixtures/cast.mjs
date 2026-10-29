// Captain cards. The first seven are the tone bible §6 calibration cast; the rest are invented
// for this bake-off only (not canon). Traits and Fears come from the ticket-06 pools.
const captain = (id, name, accent, traits, fear, power, extra = {}) => ({
  id, name, accent, traits, fear, power, infamy: 0, humiliations: [], trophies: [], overlays: [], status: 'active', ...extra,
});

export const CAST = Object.fromEntries([
  captain('krug', 'Krúg', 'cockney', ["Mummy's Boy", 'Little Fortresser'], 'Water', 3, { catchphrase: 'Exit means exit.', infamy: 40 }),
  captain('snarlbottom', 'Lord Snarlbottom', 'posh RP', ['Snob', 'Vain'], 'Soap', 6, { catchphrase: 'Do send the invoice to Mummy.', overlays: ['bucket worn as a "heritage helm"'] }),
  captain('mudgut', 'Old Mudgut', 'West Country', ['Glutton', 'Lazy'], 'Heights', 5, { catchphrase: "I've ate worse than you." }),
  captain('skagrot', 'Skagrot', 'Scouse', ['Gullible', 'Hothead'], 'Birds (geese especially)', 4, { catchphrase: 'Still sound, that.' }),
  captain('grishnack', 'Grishnack', 'Glaswegian', ['Hothead', 'Sore Loser'], 'Doctors', 7, { catchphrase: "I'll take yous all on." }),
  captain('vorgash', 'Vorgash', 'Indian English', ['Vain', 'Show-off'], 'Being Laughed At', 8, { epithet: 'the Polished', status: 'Warlord', catchphrase: 'Polished. Every morning.' }),
  captain('grimbo', 'Grimbo', 'West Country', ['Coward', "Mummy's Boy"], 'His Mum', 3, { epithet: 'Bandaged', overlays: ['mummy bandages over eyes and mouth (MUFFLED)'], humiliations: ['drowned in a soup vat, Returned bandaged'] }),
  // Invented for the bake-off.
  captain('gobblak', 'Gobblak', 'Scouse', ['Glutton', 'Drunkard'], 'Soap', 4, { catchphrase: "Is anyone finishin' that?" }),
  captain('gristlewick', 'Sir Gristlewick', 'posh RP', ['Coward', 'Hoarder'], 'Small Dogs', 2, { catchphrase: 'Mine. Also mine.' }),
  captain('glumnak', 'Glumnak', 'Glaswegian', ['Superstitious', 'Compulsive Liar'], 'The Dark', 5, { catchphrase: "That's bad luck, that." }),
  captain('vrakka', 'Vrakka', 'Indian English', ['Sleepwalker', 'Little Fortresser'], 'Cats', 5, { catchphrase: 'The fortress for the fortress-born.' }),
  captain('grubbock', 'Big Grubbock', 'cockney', ['Glutton', 'Show-off'], 'Doctors', 6, { catchphrase: 'Once you go black pudding, you never go back.' }),
].map((x) => [x.id, x]));
