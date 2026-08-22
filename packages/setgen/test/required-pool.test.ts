import { describe, expect, it } from 'vitest';
import type { CardKind, Color } from '@mtg/dsl';
import type { Rng, SetBrief, SetBriefInput, Slot } from '@mtg/setgen';
import { allocateSlots, parseBrief, pinRequiredCards, slotId } from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

/**
 * A required card can ask for the colorless pool.
 *
 * the set design document, decision 5 ends "Marquee gear is
 * colorless", and the marquee gear is the part of the list the set is named
 * after: Moonblade, Vantan Shield, Scimitar of the Dunes, Boulder Breaker,
 * Ancient Blade, the Savage Direhorn Bow. `@mtg/dsl`'s `ColorSchema` has five
 * members and no colorless, so a required card's pool is setgen's own input
 * vocabulary rather than the DSL's five colors.
 *
 * The census half matters as much as the vocabulary: colorless cards are
 * allocated out of their own pool, so a card that asks for colorless has to
 * land in a colorless slot and must never spend a colored one.
 */

const unshuffled: Rng = () => 0.999999;

function slot(index: number, color: Color | null, cardKind: CardKind): Slot {
  return {
    id: slotId('common', color, index + 1),
    index,
    collectorNumber: index + 1,
    rarity: 'common',
    color,
    cardKind,
    role: cardKind === 'creature' ? 'creature' : 'filler',
    manaValueMin: 2,
    manaValueMax: 3,
    keywords: [],
    effectKinds: [],
    abilityKinds: [],
    auraModifications: [],
    triggerConditions: [],
    mechanics: [],
    archetypes: [],
    signpost: false,
  };
}

function briefRequiring(requiredCards: SetBriefInput['requiredCards']): SetBrief {
  return parseBrief({ ...TEST_BRIEF, requiredCards });
}

describe('the brief boundary takes colorless as a pool', () => {
  it('accepts a required card that asks for colorless', () => {
    const brief = briefRequiring([{ name: 'Moonblade', color: 'colorless' }]);
    expect(brief.requiredCards[0]?.color).toBe('colorless');
  });

  // Typed as unknown on purpose: a brief arrives as JSON from a file or a CLI,
  // so the compiler is not the thing that keeps a bad pool out.
  it('rejects a pool that is neither a color nor colorless', () => {
    const withPool = (color: string): unknown => ({
      ...TEST_BRIEF,
      requiredCards: [{ name: 'Moonblade', color }],
    });
    expect(() => parseBrief(withPool('C'))).toThrow();
    expect(() => parseBrief(withPool('Colorless'))).toThrow();
    expect(() => parseBrief(withPool('artifact'))).toThrow();
  });
});

describe('a colorless required card is seated in the colorless pool', () => {
  it('passes over the colored slot it would walk first', () => {
    const { slots } = pinRequiredCards(
      [slot(0, 'R', 'creature'), slot(1, null, 'artifact')],
      briefRequiring([{ name: 'Moonblade', color: 'colorless' }]),
      unshuffled,
    );
    expect(slots.map((seat) => seat.requiredCard?.name)).toStrictEqual([undefined, 'Moonblade']);
  });

  it('is refused rather than seated on a colored slot', () => {
    expect(() =>
      pinRequiredCards(
        [slot(0, 'R', 'creature'), slot(1, 'W', 'creature')],
        briefRequiring([{ name: 'Moonblade', color: 'colorless' }]),
        unshuffled,
      ),
    ).toThrow(/"Moonblade" \(colorless\): no slot in the set matches/);
  });

  it('spends no colored slot when the set has both pools', () => {
    const gear = ['Moonblade', 'Vantan Shield', 'Scimitar of the Dunes'].map((name) => ({
      name,
      color: 'colorless' as const,
    }));
    const { slots } = allocateSlots(parseBrief({ ...TEST_BRIEF, targetSize: 250, requiredCards: gear }));
    const reserved = slots.filter((seat) => seat.requiredCard !== undefined);

    expect(reserved).toHaveLength(3);
    expect(reserved.map((seat) => seat.color)).toStrictEqual([null, null, null]);
  });
});
