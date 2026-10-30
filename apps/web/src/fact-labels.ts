// What a Fact kind is called on screen, in the GLOSSARY's words (the Hall's tags, #40). Pure, so it's
// tested in apps/web/test.

const LABELS: Record<string, string> = {
  accusation: 'Accusation',
  benched: 'Benched',
  clash: 'Clash',
  crowned: 'Crowned Warlord',
  dare: 'Dare',
  death: 'Death',
  death_averted: 'Death averted',
  grudge: 'Grudge',
  humiliation: 'Humiliation',
  humiliation_ended: 'Humiliation ended',
  incident: 'Incident',
  legendary: 'Legendary',
  power: 'Power',
  return: 'Return',
  rumour: 'Rumour',
  stepped_in: 'Stepped in',
  trophy: 'Trophy',
  unmasked: 'Unmasked',
  warlord_fell: 'the Warlord fell',
};

/** "Return", "the Warlord fell": a Fact kind as words. */
export function factKindLabel(kind: string): string {
  return LABELS[kind] ?? kind.replace(/_/g, ' ');
}
