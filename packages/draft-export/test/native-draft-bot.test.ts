/**
 * The native draft bot sees typed DSL cards and its own prior picks. These
 * tests use cards invented here so passing them cannot depend on knowledge of
 * a named set or on a profile table maintained beside one.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORE_WEIGHTS, evaluateCard } from '@mtg/deckbuild';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import {
  DEFAULT_NATIVE_DRAFT_BOT_POLICY,
  DRAFTMANCER_SIMPLE_BOT_POLICY,
  NATIVE_DECK_CONDITIONED_BOT_POLICY,
  nativeDraftPick,
  nativeDraftScores,
} from '../src/native-draft-bot';
import type { EvaluatorRating } from '../src/rating';
import { createRng } from '../src/rng';

let collectorNumber = 0;

function card(input: Partial<CardInput> & { readonly id: string }): Card {
  collectorNumber += 1;
  return parseCard({
    name: input.id,
    rarity: 'common',
    set: { code: 'HLD', collectorNumber },
    ...input,
  } as CardInput);
}

function creature(
  id: string,
  manaValue: number,
  color: 'W' | 'U' | 'B' | 'R' | 'G',
  subtype = 'Scout',
): Card {
  return card({
    id,
    kind: 'creature',
    manaCost: { generic: Math.max(0, manaValue - 1), [color]: 1 },
    colors: [color],
    subtypes: [subtype],
    power: Math.max(1, Math.floor(manaValue / 2)),
    toughness: Math.max(1, Math.ceil(manaValue / 2)),
  });
}

function rating(subject: Card, value = 2.5): EvaluatorRating {
  return { card: subject, score: value, rating: value, source: 'evaluator' };
}

describe('the native draft policy identity', () => {
  it('defaults to the versioned deck-conditioned policy and names the static export separately', () => {
    expect(DEFAULT_NATIVE_DRAFT_BOT_POLICY).toBe(NATIVE_DECK_CONDITIONED_BOT_POLICY);
    expect(NATIVE_DECK_CONDITIONED_BOT_POLICY).not.toBe(DRAFTMANCER_SIMPLE_BOT_POLICY);
  });
});

describe('a native pick over held-out generated cards', () => {
  it('uses the observed pool to prefer a missing curve role in its established colors', () => {
    const cheap = creature('held-out-cheap', 2, 'W');
    const expensive = creature('held-out-expensive', 6, 'W');
    const pool = Array.from({ length: 8 }, (_, index) => creature(`held-out-top-${String(index)}`, 6, 'W'));
    const scores = nativeDraftScores([rating(cheap), rating(expensive)], pool);

    expect(scores[0]).toBeGreaterThan(scores[1] ?? Number.POSITIVE_INFINITY);
    expect(nativeDraftPick([rating(cheap), rating(expensive)], pool, createRng('held-out/curve'))[0]).toBe(0);
  });

  it('lets typed enablers increase a payoff without a set-specific tag table', () => {
    const payoff = card({
      id: 'held-out-soldier-payoff',
      kind: 'creature',
      manaCost: { generic: 2, W: 1 },
      colors: ['W'],
      subtypes: ['Noble'],
      power: 2,
      toughness: 2,
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Soldier',
          modification: { kind: 'statBonus', power: 2, toughness: 2 },
        },
      ],
    });
    const plain = creature('held-out-plain', 3, 'W', 'Noble');
    const soldiers = Array.from({ length: 8 }, (_, index) =>
      creature(`held-out-soldier-${String(index)}`, 2, 'W', 'Soldier'),
    );
    const barren = nativeDraftScores([rating(payoff), rating(plain)], []);
    const enabled = nativeDraftScores([rating(payoff), rating(plain)], soldiers);

    expect(enabled[0]! - enabled[1]!).toBeGreaterThan(barren[0]! - barren[1]!);
    expect(nativeDraftPick([rating(payoff), rating(plain)], soldiers, createRng('held-out/synergy'))[0]).toBe(
      0,
    );
  });

  it('is deterministic for one policy, pool, pack, and seed', () => {
    const pack = [rating(creature('held-out-a', 2, 'U')), rating(creature('held-out-b', 2, 'U'))];
    const first = nativeDraftPick(pack, [], createRng('held-out/tie'));
    const second = nativeDraftPick(pack, [], createRng('held-out/tie'));
    expect(first).toEqual(second);
  });

  it('projects fixing lands, noncreature interaction, and prepared evaluations through the same model', () => {
    const fixing = card({
      id: 'held-out-fixing',
      kind: 'land',
      colors: [],
      producesMana: ['W', 'U', 'C'],
    });
    const removal = card({
      id: 'held-out-removal',
      kind: 'artifact',
      manaCost: { generic: 2 },
      colors: [],
      abilities: [
        {
          kind: 'activated',
          cost: { mana: { generic: 2 }, tapSelf: true, sacrificeSelf: false },
          effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
        },
      ],
    });
    const candidate = creature('held-out-candidate', 3, 'W');
    const ratings = new Map([
      [fixing.id, rating(fixing, 8)],
      [removal.id, rating(removal, -2)],
    ]);
    const contextFree = new Map([
      [fixing.id, evaluateCard(fixing, DEFAULT_SCORE_WEIGHTS)],
      [removal.id, evaluateCard(removal, DEFAULT_SCORE_WEIGHTS)],
    ]);

    const scores = nativeDraftScores([rating(candidate)], [fixing, removal], {
      ratings,
      contextFree,
      weights: DEFAULT_SCORE_WEIGHTS,
    });

    expect(scores).toHaveLength(1);
    expect(scores[0]).toBeTypeOf('number');
    expect(Number.isFinite(scores[0])).toBe(true);
  });

  it('refuses an empty visible pack', () => {
    expect(() => nativeDraftScores([], [])).toThrow('cannot score an empty pack');
  });
});
