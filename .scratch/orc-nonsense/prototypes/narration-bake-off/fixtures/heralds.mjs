// Herald inputs: lists of templated one-line event log entries (ticket 11's Templated tier).
// `blame` is here on purpose: it is appended by the game, never sent to the model.
export const HERALDS = [
  {
    id: 'herald-gdd-chain',
    events: [
      'Rumour landed on the wrong orc: Lord Snarlbottom heard Krúg called his helmet a bucket.',
      'Clash: Lord Snarlbottom DEFEATED Krúg. Wrong saviour: Old Mudgut (ate the pies).',
      'Death: Krúg drowned in 30cm of moat. Infamy +25.',
      'Trophy: Lord Snarlbottom took Krúg\'s nose ring.',
      'Return: Krúg Returned as "Krúg the Damp", bandaged, now afraid of puddles.',
      'Warlord change: Vorgash the Polished fell off the throne. Krúg the Damp is Warlord by Infamy.',
    ],
    blame: ['Rumour planted by Haris, who has been informed.'],
  },
  {
    id: 'herald-dares',
    events: [
      'Dare botched: Old Mudgut climbed one foot up the banner pole and fell on the Warlord.',
      'Dare refused: Grimbo would not sleep in the haunted latrine. Branded a coward. Infamy +5.',
      'Dare pulled off: Old Mudgut ate the cursed pie, and the plate.',
      'Humiliation: Vorgash the Polished lost a tusk juggling knives.',
    ],
    blame: ['Dares set by Dev and Haris.'],
  },
  {
    id: 'herald-quiet',
    events: [
      'Rumour garbled: "Glumnak says Krúg is scared of puddles" became a coup plot involving the puddles.',
      'Clash: Krúg SOMEHOW WON against Glumnak.',
    ],
  },
];
