/** Forge's installed Destroy plus TargetedController DigUntil chain. */
import { describe, expect, it } from 'vitest';
import type { EffectInput } from '@mtg/dsl';
import { mustTranspile, spell } from './helpers';

describe('Destroy the Evidence', () => {
  it('matches the installed land-destruction and revealed-to-graveyard DigUntil chain', () => {
    const card = spell(
      'Destroy the Evidence',
      [
        {
          kind: 'destroyPermanent',
          controllerLibraryFollowup: 'revealUntilLandToGraveyard',
          target: { kind: 'targetPermanent', filter: { cardTypes: ['land'] } },
        } as unknown as EffectInput,
      ],
      { kind: 'sorcery', manaCost: { generic: 4, B: 1 }, colors: ['B'] },
    );

    const script = mustTranspile(card);
    expect(script).toContain(
      'A:SP$ Destroy | ValidTgts$ Land | SubAbility$ DBEffect1 | SpellDescription$ Destroy target land. Its controller reveals cards from the top of their library until they reveal a land card, then puts those cards into their graveyard.',
    );
    expect(script).toContain(
      'SVar:DBEffect1:DB$ DigUntil | Defined$ TargetedController | Valid$ Land | ValidDescription$ land | RevealedDestination$ Graveyard',
    );
  });
});
