import { describe, expect, it } from 'vitest';
import {
  classifyLegacyCubeForgeScript,
  inventoryLegacyCubeForgeScript,
  loadLegacyCubeSyntaxReview,
} from '../src/legacy-cube/decision-ledger';

const syntax = loadLegacyCubeSyntaxReview();
const zoneChoice = { kind: 'semantic-marker', token: 'zone-card-choice' };
const script = (ability: string): Uint8Array =>
  new TextEncoder().encode(`Name:Zone Selection Probe\nTypes:Sorcery\n${ability}\n`);

describe('ChangeZone player targets and card products', () => {
  it.each([
    ['Player', 'A:AB'],
    ['Opponent', 'SVar:Move:DB'],
    ['Player', 'A:SP'],
  ])('classifies %s targets on %s as a separate card choice', (target, prefix) => {
    const bytes = script(
      `${prefix}$ ChangeZone | ValidTgts$ ${target} | Origin$ Graveyard | Destination$ Exile | ChangeType$ Card | ChangeNum$ 1`,
    );
    expect(inventoryLegacyCubeForgeScript(bytes)).toContainEqual(zoneChoice);
    expect(classifyLegacyCubeForgeScript(bytes, syntax)).toMatchObject({
      families: ['priority', 'targets', 'zone-card-selection'],
      unknownDecisionSyntax: [],
    });
  });

  it('preserves a player-owned choice with reordered fields and surrounding whitespace', () => {
    const bytes = script(
      'SVar:Move:DB$ ChangeZone | Chooser$ Targeted | DefinedPlayer$ Targeted | ChangeNum$ 1 | Origin$ Hand | Destination$ Exile | ValidTgts$   Opponent  ',
    );
    expect(inventoryLegacyCubeForgeScript(bytes)).toContainEqual(zoneChoice);
    expect(classifyLegacyCubeForgeScript(bytes, syntax).families).toEqual([
      'priority',
      'targets',
      'zone-card-selection',
    ]);
  });

  it.each(['Creature', 'Card', 'Creature.OppCtrl'])('%s targets already specify the moved card', (target) => {
    const bytes = script(
      `A:SP$ ChangeZone | ValidTgts$ ${target} | Origin$ Graveyard | Destination$ Battlefield | ChangeType$ Creature | ChangeNum$ 1`,
    );
    expect(inventoryLegacyCubeForgeScript(bytes)).not.toContainEqual(zoneChoice);
    expect(classifyLegacyCubeForgeScript(bytes, syntax).families).toEqual(['priority', 'targets']);
  });

  it('does not turn a Reanimate-shaped direct target into a second card selection', () => {
    const bytes = script(
      'A:SP$ ChangeZone | ValidTgts$ Creature | TgtZone$ Graveyard | Origin$ Graveyard | Destination$ Battlefield | ChangeNum$ 1',
    );
    expect(classifyLegacyCubeForgeScript(bytes, syntax).families).toEqual(['priority', 'targets']);
  });

  it.each(['Self', 'Remembered'])(
    'a Defined %s card product stays resolved even with a player target',
    (defined) => {
      const bytes = script(
        `A:SP$ ChangeZone | ValidTgts$ Player | Defined$ ${defined} | Origin$ Graveyard | Destination$ Exile | ChangeType$ Card | ChangeNum$ 1`,
      );
      expect(inventoryLegacyCubeForgeScript(bytes)).not.toContainEqual(zoneChoice);
      expect(classifyLegacyCubeForgeScript(bytes, syntax).families).toEqual(['priority', 'targets']);
    },
  );

  it('requires a selection parameter as well as a player target', () => {
    expect(
      inventoryLegacyCubeForgeScript(
        script('A:SP$ ChangeZone | ValidTgts$ Player | DefinedPlayer$ Targeted'),
      ),
    ).not.toContainEqual(zoneChoice);
  });

  it.each(['PlayerCard', 'Creature.PlayerOwns', 'Creature,Player'])(
    'does not infer player-only targeting from %s text',
    (target) => {
      const bytes = script(
        `A:SP$ ChangeZone | ValidTgts$ ${target} | ChangeNum$ 1 | SpellDescription$ Player chooses a card from a zone.`,
      );
      expect(inventoryLegacyCubeForgeScript(bytes)).not.toContainEqual(zoneChoice);
    },
  );

  it('does not infer an effect from descriptive text', () => {
    expect(
      inventoryLegacyCubeForgeScript(
        script('A:SP$ Draw | ValidTgts$ Player | SpellDescription$ ChangeZone lets a player choose a card.'),
      ),
    ).not.toContainEqual(zoneChoice);
  });
});
