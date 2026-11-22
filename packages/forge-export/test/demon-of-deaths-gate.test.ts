/** Demon of Death's Gate against Forge's checked-in alternative-cost script. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const DEMON = parseCard({
  kind: 'creature',
  id: 'm11-92-demon-of-deaths-gate-forge',
  name: "Demon of Death's Gate",
  rarity: 'mythic',
  set: { code: 'M11', collectorNumber: 92 },
  colors: ['B'],
  manaCost: { generic: 6, B: 3 },
  subtypes: ['Demon'],
  power: 9,
  toughness: 9,
  keywords: ['flying', 'trample'],
  alternativeCost: {
    payLife: 6,
    sacrificeMatching: {
      count: 3,
      filter: { cardTypes: ['creature'], colors: ['B'] },
    },
  },
} as unknown as CardInput);

describe("Demon of Death's Gate Forge export", () => {
  it('matches the primary-source AlternativeCost, PayLife, and Sac protocol exactly', () => {
    expect(mustTranspile(DEMON)).toBe(
      [
        "Name:Demon of Death's Gate",
        'ManaCost:6 B B B',
        'Types:Creature Demon',
        'PT:9/9',
        'K:Flying',
        'K:Trample',
        "S:Mode$ AlternativeCost | ValidSA$ Spell.Self | EffectZone$ All | Cost$ PayLife<6> Sac<3/Creature.Black> | Description$ You may pay 6 life and sacrifice three black creatures rather than pay this spell's mana cost.",
        "Oracle:You may pay 6 life and sacrifice three black creatures rather than pay this spell's mana cost.\\nFlying, trample",
        '',
      ].join('\n'),
    );
  });
});
