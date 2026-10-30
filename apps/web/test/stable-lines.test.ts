// "Your Stable" ledger lines (#36): private, never in the shared Herald. "+8 gold: Krúg drowned in 30cm of moat".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goldLine, type GoldChange } from '../src/stable-lines.ts';

const names = (id: string) => ({ krug: 'Krúg', gob: 'Gob' })[id] ?? id;
const change = (patch: Partial<GoldChange>): GoldChange => ({
  delta: 0,
  lost: 0,
  reason: 'stipend',
  captainId: null,
  line: null,
  ...patch,
});

test('a payout reads as the gold and the story that paid it', () => {
  assert.equal(
    goldLine(change({ delta: 8, reason: 'payout_infamy', captainId: 'krug', line: 'Krúg drowned in 30cm of moat.' }), names),
    '+8 gold: Krúg drowned in 30cm of moat',
  );
  assert.equal(goldLine(change({ delta: 3, reason: 'payout_win', captainId: 'gob', line: null }), names), '+3 gold: Gob won a Clash');
});

test('Stakes, top-ups, withdrawals, the Stipend and refunds', () => {
  assert.equal(goldLine(change({ delta: -10, reason: 'stake', captainId: 'krug' }), names), '−10 gold: you backed Krúg');
  assert.equal(goldLine(change({ delta: -2, reason: 'top_up', captainId: 'krug' }), names), '−2 gold: you topped up your Stake on Krúg');
  assert.equal(goldLine(change({ delta: 3, reason: 'withdraw', captainId: 'gob' }), names), '+3 gold: you pulled your Stake off Gob (half back)');
  assert.equal(goldLine(change({ delta: 10, reason: 'stipend' }), names), '+10 gold: your daily Stipend');
  assert.equal(goldLine(change({ delta: 6, reason: 'refund' }), names), '+6 gold: a Stake that never took, refunded');
});

test('overflow past 30 says what was lost', () => {
  assert.equal(goldLine(change({ delta: 0, lost: 10, reason: 'stipend' }), names), '+0 gold: your daily Stipend (10 lost: your purse was full)');
  assert.equal(
    goldLine(change({ delta: 1, lost: 2, reason: 'payout_win', captainId: 'gob' }), names),
    '+1 gold: Gob won a Clash (2 lost: your purse was full)',
  );
});
