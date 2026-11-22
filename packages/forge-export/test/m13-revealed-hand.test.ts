/** Forge parity for M13's two linked revealed-hand operations. */
import { describe, expect, it } from 'vitest';
import { parseCard, type CardInput } from '@mtg/dsl';
import { transpileCard } from '@mtg/forge-export';
import { mustTranspile } from './helpers';

function mindclawShaman() {
  return parseCard({
    kind: 'creature',
    id: 'm13-142',
    name: 'Mindclaw Shaman',
    rarity: 'uncommon',
    set: { code: 'M13', collectorNumber: 142 },
    manaCost: { generic: 4, R: 1 },
    colors: ['R'],
    subtypes: ['Lizard', 'Shaman'],
    power: 2,
    toughness: 2,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          {
            kind: 'chooseFromRevealedHand',
            target: { kind: 'targetOpponent' },
            filter: { cardTypes: ['instant', 'sorcery'] },
            outcome: { kind: 'mayCastWithoutPayingManaCost' },
          },
        ],
      },
    ],
  } as unknown as CardInput);
}

function shimianSpecter(target: 'triggeringPlayer' | 'targetOpponent' = 'triggeringPlayer') {
  return parseCard({
    kind: 'creature',
    id: 'm13-109',
    name: 'Shimian Specter',
    rarity: 'rare',
    set: { code: 'M13', collectorNumber: 109 },
    manaCost: { generic: 2, B: 2 },
    colors: ['B'],
    subtypes: ['Specter'],
    power: 2,
    toughness: 2,
    keywords: ['flying'],
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDealsCombatDamageToPlayer',
        effects: [
          {
            kind: 'chooseFromRevealedHand',
            target: { kind: target },
            filter: { excludeCardTypes: ['land'] },
            outcome: { kind: 'exileAllCardsWithSameNameThenShuffle' },
          },
        ],
      },
    ],
  } as unknown as CardInput);
}

describe('M13 revealed-hand Forge scripts', () => {
  /**
   * Sources: Card-Forge/forge master,
   * `forge-gui/res/cardsfolder/m/mindclaw_shaman.txt` and
   * `forge-gui/res/cardsfolder/s/shimian_specter.txt`, read 2026-08-26.
   */
  it('exports Mindclaw Shaman through RevealHand then optional free Play', () => {
    const script = mustTranspile(mindclawShaman());

    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ RevealHand | ValidTgts$ Player.Opponent | SubAbility$ Trig1Effect1Hold',
    );
    expect(script).toContain(
      'SVar:Trig1Effect1Hold:DB$ Play | Valid$ Card.TargetedPlayerCtrl | ValidSA$ Instant,Sorcery | ValidZone$ Hand | WithoutManaCost$ True | Optional$ True',
    );
  });

  it('exports Shimian Specter through remembered choice and same-name zone moves', () => {
    const script = mustTranspile(shimianSpecter());

    expect(script).toContain(
      'DB$ ChooseCard | Choices$ Card.nonLand+OwnedBy TriggeredTarget | ChoiceZone$ Hand | RememberChosen$ True',
    );
    expect(script).toContain(
      'Origin$ Graveyard | Destination$ Exile | Defined$ TriggeredTarget | ChangeType$ Remembered.sameName',
    );
    expect(script).toContain(
      'Origin$ Hand | Destination$ Exile | DefinedPlayer$ TriggeredTarget | ChangeType$ Remembered.sameName',
    );
    expect(script).toContain(
      'Origin$ Library | Destination$ Exile | DefinedPlayer$ TriggeredTarget | ChangeType$ Remembered.sameName',
    );
    expect(script).toContain('DB$ Cleanup | ClearRemembered$ True');
  });

  it('refuses a purge aimed at an ordinary target rather than the retained damaged player', () => {
    const result = transpileCard(shimianSpecter('targetOpponent'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'UNMAPPED_EFFECT_KIND',
          path: expect.stringContaining('.target') as string,
          message: expect.stringContaining('triggering player') as string,
        }),
      ]),
    );
  });
});
