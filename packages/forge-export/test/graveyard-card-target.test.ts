/** Forge's source-attested selector for Trading Post's graveyard target. */
import { describe, expect, it } from 'vitest';
import { PERMANENT_CARD_KINDS, parseCard, type CardInput } from '@mtg/dsl';
import { mustTranspile } from './helpers';

describe('a targeted card in your graveyard', () => {
  it('keeps the owner qualifier and graveyard origin when a filter supplies the card type', () => {
    const card = parseCard({
      kind: 'artifact',
      id: 'm13-220-graveyard-target',
      name: 'Recall Post',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 220 },
      colors: [],
      manaCost: { generic: 4 },
      abilities: [
        {
          kind: 'activated',
          cost: {
            mana: { generic: 1 },
            tapSelf: true,
            sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
          },
          effects: [
            {
              kind: 'returnToHand',
              target: { kind: 'targetCardInYourGraveyard', filter: { cardTypes: ['artifact'] } },
            },
          ],
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toContain(
      'A:AB$ ChangeZone | Cost$ 1 T Sac<1/Creature> | ValidTgts$ Artifact.YouCtrl | Origin$ Graveyard | Destination$ Hand',
    );
  });

  it('matches Forge master for a target from either graveyard and an arrival grant', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'm13-rise-target',
      name: 'Rise Again',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 108 },
      colors: ['B'],
      manaCost: { generic: 4, B: 1 },
      effects: [
        {
          kind: 'returnFromGraveyard',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
          control: 'you',
          alsoBecomes: { colors: ['B'], subtypes: ['Zombie'] },
        },
      ],
    } as CardInput);
    const script = mustTranspile(card);

    expect(script).toContain(
      'A:SP$ ChangeZone | ValidTgts$ Creature | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | StaticEffect$ Animate',
    );
    expect(script).toContain(
      'SVar:Animate:Mode$ Continuous | Affected$ Card.IsRemembered | AddType$ Zombie | AddColor$ Black',
    );
  });

  it('matches Forge master for targeted exile from either graveyard', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'm13-vile-target',
      name: 'Vile Return',
      rarity: 'uncommon',
      set: { code: 'M13', collectorNumber: 113 },
      colors: ['B'],
      manaCost: { B: 1 },
      effects: [
        {
          kind: 'exileTarget',
          target: { kind: 'targetCardInAGraveyard', filter: { cardTypes: ['creature'] } },
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toContain(
      'A:SP$ ChangeZone | ValidTgts$ Creature | Origin$ Graveyard | Destination$ Exile',
    );
  });

  it('matches Sun Titan’s owner-qualified permanent mana-value selector', () => {
    const card = parseCard({
      kind: 'creature',
      id: 'm13-sun-titan-target',
      name: 'Sun Titan Probe',
      rarity: 'mythic',
      set: { code: 'M13', collectorNumber: 35 },
      colors: ['W'],
      manaCost: { generic: 4, W: 2 },
      subtypes: ['Giant'],
      power: 6,
      toughness: 6,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEntersOrAttacks',
          optional: true,
          effects: [
            {
              kind: 'returnFromGraveyard',
              target: {
                kind: 'targetCardInYourGraveyard',
                filter: { cardTypes: [...PERMANENT_CARD_KINDS], maxManaValue: 3 },
              },
            },
          ],
        },
      ],
    } as CardInput);

    expect(mustTranspile(card)).toContain(
      'ValidTgts$ Permanent.YouCtrl+cmcLE3 | Origin$ Graveyard | Destination$ Battlefield',
    );
  });
});
