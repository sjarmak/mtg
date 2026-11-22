/** Source-attested Forge parity for M11 Hunters' Feast. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe("Hunters' Feast Forge export", () => {
  it('emits Forge current card source exactly', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm11-182-hunters-feast-forge',
      name: "Hunters' Feast",
      rarity: 'common',
      set: { code: 'M11', collectorNumber: 182 },
      manaCost: { generic: 3, G: 1 },
      colors: ['G'],
      effects: [
        {
          kind: 'gainLife',
          amount: 6,
          target: { kind: 'targetPlayer', anyNumber: true },
        },
      ],
    } as unknown as CardInput);

    expect(mustTranspile(card)).toBe(
      [
        "Name:Hunters' Feast",
        'ManaCost:3 G',
        'Types:Sorcery',
        'A:SP$ GainLife | ValidTgts$ Player | TargetMin$ 0 | TargetMax$ MaxTgt | LifeAmount$ 6 | SpellDescription$ Any number of target players each gain 6 life.',
        'SVar:MaxTgt:PlayerCountPlayers$Amount',
        'DeckHas:Ability$LifeGain',
        'Oracle:Any number of target players each gain 6 life.',
        '',
      ].join('\n'),
    );
  });
});
