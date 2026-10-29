# Backing economy

Type: grilling
Status: resolved
Assignee: Mohammed
Blocked by: 04

## Question

How does gold work? Where does it come from, does it reset, how big is the Backing edge, and how are payouts on wins and on Infamy calculated?

Depends on [Score or no score](04-score-or-no-score.md): with no score, gold may only need to exist as "how much chaos can I fund today".

## Answer

Resolved with Mohammed on 2026-10-29 (three grilling rounds).

**Backing is a standing Stake. Gold comes from a small daily Stipend, and backing idiots pays best.** The numbers are placeholders, set to show scale, and get tuned at implementation.

### Gold in

- **Stipend:** a flat **10 gold a day**, the same for every Player. Backing payouts are the only other source: no gold from Meddles, Blame or logging in.
- **Cap, no reset:** unspent gold banks up to **30** (3 days). Staked gold doesn't count towards the cap. Payouts over the cap are **lost**, which pushes you to spend. There are no seasons, so there's no reset.
- **New Players** start with a full 30.

### Backing

- **Standing Stake:** gold put behind a Captain stays there until withdrawn and pays out over time. It's never a per-Clash wager. The Stable is just the set of Captains you have Stakes on.
- **Limits:** a minimum of 1 gold, no maximum (the cap is the real limit), any number of Captains, top up any time.
- **Withdrawal:** any time, for **half back**. The Captain's next bark or Herald line can mention being abandoned by his sponsor. This is flavour only: no Blame and no change to state.
- **Death:** the Stake is **held** through death and resumes on Return, just as Meddles are held on dead Captains.
- **Public who, private how much:** everyone can see who backs whom ("Haris's champion"). Stake amounts and gold totals are visible only to their owner.

### The edge

- **A flat edge for each backer, whatever the Stake:** each backing Player adds about **+5% Clash win chance**, capped at **+10%** in total. Gold never buys better odds.
- **Clashes only.** Dares, Rumours and accidents are never nudged, so Backing never protects a Captain from his own stupidity. When two backed Captains Clash, both edges apply and partly cancel.

### Payouts

- The Stake isn't consumed. Each event pays a percentage of it, **rounded up** (so every payout is at least 1 gold):
  - **Clash win:** 10% of the Stake.
  - **Infamy:** 1% of the Stake for each Infamy point gained.
- Infamy is deliberately the bigger earner. If Krúg drowns for +25 Infamy on a 30-gold Stake, that pays 8, while a win pays 3. Backing an idiot beats backing a hard man.
- **No special cases.** Becoming Warlord is an Infamy jump and pays through Infamy. Losing to a Captain in your own Stable is not refunded.
- **Private only:** payouts appear only in the Player's own view ("+8 gold: Krúg drowned in 30cm of moat"). The Herald never names amounts.

**Effects on the map:**
- [Failing Upward rules](09-failing-upward-rules.md) sets the size of Infamy gains, which directly sets payout size. Keep the scale in mind: roughly 5–30 for a notable disaster.
- The *Herald* fog gains a private, per-Player section in "Since You Left" for payouts and Stable news, kept separate from the shared Herald.
- The *data model* fog gains Stakes (Player, Captain, amount), held Stakes on dead Captains, and each Player's banked gold.

## Comments
