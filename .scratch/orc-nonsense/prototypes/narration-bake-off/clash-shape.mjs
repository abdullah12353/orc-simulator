// Ticket 10: 3 lines per Clash (jab, comeback, loser's last word), 4 when a wrong saviour crashes in.
// One definition, used by the prompt (what we ask for) and the validator (what we accept).
export function clashShape(fact) {
  return {
    speakerIds: [fact.a, fact.b, fact.saviour].filter(Boolean),
    expectedLines: fact.saviour ? 4 : 3,
  };
}
