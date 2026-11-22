/** Forge's source-attested LKI controller protocol for Public Execution. */
import { describe, expect, it } from 'vitest';
import { parseCard } from '@mtg/dsl';
import { mustTranspile } from './helpers';

const CARD = parseCard({
  kind: 'instant',
  id: 'm13-public-execution',
  name: 'Public Execution',
  rarity: 'uncommon',
  set: { code: 'M13', collectorNumber: 105 },
  manaCost: { generic: 5, B: 1 },
  colors: ['B'],
  effects: [
    { kind: 'destroyPermanent', target: { kind: 'targetCreatureOpponentControls' } },
    {
      kind: 'pumpUntilEndOfTurn',
      power: -2,
      toughness: 0,
      scope: 'creaturesThatPlayerControls',
      excludeReferent: true,
      target: { kind: 'thatCreaturesController' },
    },
  ],
});

const ALL_CREATURES_CARD = parseCard({
  ...CARD,
  id: 'departed-controller-sweep',
  name: 'Departed Controller Sweep',
  effects: [
    CARD.effects[0]!,
    {
      kind: 'pumpUntilEndOfTurn',
      power: -2,
      toughness: 0,
      scope: 'creaturesThatPlayerControls',
      target: { kind: 'thatCreaturesController' },
    },
  ],
});

describe('Public Execution Forge export', () => {
  const script = mustTranspile(CARD);

  it('remembers the chosen creature last-known controller before destroying it', () => {
    expect(script).toContain(
      'A:SP$ Destroy | ValidTgts$ Creature.OppCtrl | RememberLKI$ True | AlwaysRemember$ True | SubAbility$ DBEffect1',
    );
  });

  it('shrinks every other creature controlled by the remembered controller', () => {
    expect(script).toContain(
      'SVar:DBEffect1:DB$ PumpAll | ValidCards$ Creature.ControlledBy RememberedController+!IsRemembered | NumAtt$ -2 | SubAbility$ DBEffect2',
    );
    expect(script).not.toContain('NumDef$ +0');
  });

  it('clears the retained object after the chain resolves', () => {
    expect(script).toContain('SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True');
    expect(script).toContain(
      'SpellDescription$ Destroy target creature an opponent controls. Each other creature that player controls gets -2/-0 until end of turn.',
    );
  });

  it('retains a departed controller even when the cohort includes the chosen creature', () => {
    const allCreatures = mustTranspile(ALL_CREATURES_CARD);
    expect(allCreatures).toContain('RememberLKI$ True | AlwaysRemember$ True');
    expect(allCreatures).toContain('ValidCards$ Creature.ControlledBy RememberedController');
    expect(allCreatures).not.toContain('!IsRemembered');
  });
});
