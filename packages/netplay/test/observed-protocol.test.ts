/**
 * The observed wire's readers and the one projection it does itself.
 *
 * `playFor` is the claim worth pinning: the backend writes one play
 * interaction for the deciding seat, and the other seat is sent the public
 * part and no move. The readers are pinned the way `readRoomBuild`'s are, one
 * refusal per field, so a browser that sends the wrong shape reads a sentence.
 */
import { describe, expect, it } from 'vitest';
import type { PendingDecision, PlayInteraction } from '@mtg/engine';
import { OBSERVED_TABLE_PROTOCOL, playFor, readObservedMove, readObservedOpenRequest } from '@mtg/netplay';

const OPEN = {
  protocol: OBSERVED_TABLE_PROTOCOL,
  format: 'm11-sealed',
  content: { kind: 'printed', format: 'm11-sealed' },
  seed: 'seed-1',
  maximumTurns: null,
};

const GUEST_DECK = {
  name: 'Token Triumph',
  cards: [{ name: 'Emmara, Soul of the Accord', count: 1 }],
  commanders: [{ name: 'Emmara, Soul of the Accord', count: 1 }],
};

const DECISION: PendingDecision = {
  seat: 0,
  kind: 'priority',
  prompt: 'Host has priority',
  options: [{ id: 'pass', text: 'Pass', targets: [] }],
  complete: true,
};

const PLAY: PlayInteraction = {
  turnStep: 'precombatMain',
  passPriority: 'pass',
  concede: 'concede',
  manaPools: [
    { W: 0, U: 1, B: 0, R: 0, G: 0, C: 0 },
    { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  ],
  objectActions: [{ oid: 'forge-card-11', move: 'play-11', category: 'play' }],
  seatActions: [{ seat: 1, move: 'target-1' }],
  promptRole: 'opening-hand',
  automatic: null,
};

describe('readObservedOpenRequest', () => {
  it('reads a request naming a format, content, seed and turn limit', () => {
    expect(readObservedOpenRequest(OPEN)).toEqual(OPEN);
    expect(readObservedOpenRequest({ ...OPEN, rules: { variant: 'commander', startingLife: 40 } })).toEqual({
      ...OPEN,
      rules: { variant: 'commander', startingLife: 40 },
    });
    expect(readObservedOpenRequest({ ...OPEN, deck: GUEST_DECK })).toEqual({
      ...OPEN,
      deck: GUEST_DECK,
    });
  });

  it('refuses each missing field by sentence', () => {
    expect(readObservedOpenRequest({ ...OPEN, protocol: 0 })).toBe('the request has no recognized protocol');
    expect(readObservedOpenRequest({ ...OPEN, format: '' })).toBe('the request names no format');
    expect(readObservedOpenRequest({ ...OPEN, content: { kind: 'printed' } })).toBe(
      'the request has no supported content reference',
    );
    expect(readObservedOpenRequest({ ...OPEN, seed: 7 })).toBe('the seed must be a string or null');
    expect(readObservedOpenRequest({ ...OPEN, maximumTurns: 0 })).toBe(
      'the turn limit must be a positive safe integer or null',
    );
    expect(readObservedOpenRequest({ ...OPEN, rules: { variant: 'draft' } })).toBe(
      'match rules name a standard, commander, or momir variant and a positive starting life',
    );
    expect(readObservedOpenRequest({ ...OPEN, deck: { name: 'Broken', cards: [{}] } })).toBe(
      'every deck slot needs a name and a positive safe-integer count',
    );
    expect(readObservedOpenRequest('open')).toBe('the request has no recognized protocol');
  });
});

describe('readObservedMove', () => {
  it('reads a move id under the protocol and refuses anything else', () => {
    expect(readObservedMove({ protocol: OBSERVED_TABLE_PROTOCOL, move: 'pass' })).toEqual({ move: 'pass' });
    expect(readObservedMove({ protocol: 2, move: 'pass' })).toBe('the request has no recognized protocol');
    expect(readObservedMove({ protocol: OBSERVED_TABLE_PROTOCOL, move: '' })).toBe(
      'the request has no move id',
    );
  });
});

describe('playFor', () => {
  it('hands the deciding seat the whole interaction', () => {
    expect(playFor(0, DECISION, PLAY)).toBe(PLAY);
  });

  it('hands the other seat the public part and no move', () => {
    expect(playFor(1, DECISION, PLAY)).toEqual({
      turnStep: 'precombatMain',
      passPriority: null,
      concede: null,
      manaPools: PLAY.manaPools,
      objectActions: [],
      seatActions: [],
      promptRole: null,
      automatic: null,
    });
    expect(JSON.stringify(playFor(1, DECISION, PLAY))).not.toContain('forge-card-11');
  });

  it('strips both seats when nobody holds a decision, and passes null through', () => {
    expect(playFor(0, null, PLAY)?.objectActions).toEqual([]);
    expect(playFor(0, DECISION, null)).toBeNull();
    const bare: PlayInteraction = { turnStep: null, passPriority: null, concede: null, objectActions: [] };
    expect(playFor(1, DECISION, bare)).not.toHaveProperty('manaPools');
  });
});
