import { describe, expect, it } from 'vitest';
import { legacyCubeReviewedRepeatableModeRefusals, loadLegacyCubeSyntaxReview } from '../src/index';

const inventory = loadLegacyCubeSyntaxReview();
const bytes = (lines: readonly string[]): Uint8Array => new TextEncoder().encode(lines.join('\n'));

const wretched = [
  'Name:Wretched Confluence',
  'ManaCost:3 B B',
  'Types:Instant',
  'A:SP$ Charm | Choices$ DBDraw,DBPump,DBChangeZone | CharmNum$ 3 | CanRepeatModes$ True',
  'SVar:DBDraw:DB$ Draw | ValidTgts$ Player | NumCards$ 1 | SubAbility$ DBLoseLife | SpellDescription$ Target player draws a card and loses 1 life.',
  'SVar:DBLoseLife:DB$ LoseLife | LifeAmount$ 1 | Defined$ Targeted',
  'SVar:DBPump:DB$ Pump | ValidTgts$ Creature | NumAtt$ -2 | NumDef$ -2 | IsCurse$ True | SpellDescription$ Target creature gets -2/-2 until end of turn.',
  'SVar:DBChangeZone:DB$ ChangeZone | TgtPrompt$ Choose target creature card in your graveyard | ValidTgts$ Creature.YouOwn | Origin$ Graveyard | Destination$ Hand | SpellDescription$ Return target creature card from your graveyard to your hand.',
] as const;

const fiery = [
  'Name:Fiery Confluence',
  'ManaCost:2 R R',
  'Types:Sorcery',
  'A:SP$ Charm | Choices$ DBDamageCreatures,DBDamageOpponents,DBDestroy | CharmNum$ 3 | CanRepeatModes$ True',
  'SVar:DBDamageCreatures:DB$ DamageAll | NumDmg$ 1 | ValidCards$ Creature | SpellDescription$ CARDNAME deals 1 damage to each creature.',
  'SVar:DBDamageOpponents:DB$ DealDamage | Defined$ Player.Opponent | NumDmg$ 2 | AILogic$ Good | SpellDescription$ CARDNAME deals 2 damage to each opponent.',
  'SVar:DBDestroy:DB$ Destroy | ValidTgts$ Artifact | SpellDescription$ Destroy target artifact.',
] as const;

const mystic = [
  'Name:Mystic Confluence',
  'ManaCost:3 U U',
  'Types:Instant',
  'A:SP$ Charm | Choices$ DBCounter,DBReturn,DBDraw | CharmNum$ 3 | CanRepeatModes$ True',
  'SVar:DBCounter:DB$ Counter | TargetType$ Spell | ValidTgts$ Card | UnlessCost$ 3 | UnlessPayer$ ThisTargetedController | SpellDescription$ Counter target spell unless its controller pays {3}.',
  "SVar:DBReturn:DB$ ChangeZone | Origin$ Battlefield | Destination$ Hand | ValidTgts$ Creature | SpellDescription$ Return target creature to its owner's hand.",
  'SVar:DBDraw:DB$ Draw | Defined$ You | NumCards$ 1 | SpellDescription$ Draw a card.',
] as const;

describe('Legacy Cube reviewed repeatable modes', () => {
  it.each([
    ['Wretched Confluence', wretched],
    ['Fiery Confluence', fiery],
    ['Mystic Confluence', mystic],
  ] as const)('admits only the exact %s three-pick composition', (_label, script) => {
    expect(legacyCubeReviewedRepeatableModeRefusals(bytes(script), inventory)).toEqual([]);
  });

  it.each([
    ['another identity', wretched.map((line) => line.replace('Name:Wretched Confluence', 'Name:Other'))],
    ['another count', wretched.map((line) => line.replace('CharmNum$ 3', 'CharmNum$ 2'))],
    ['nonrepeatable', fiery.map((line) => line.replace('CanRepeatModes$ True', 'CanRepeatModes$ False'))],
    ['another outcome', fiery.map((line) => line.replace('NumDmg$ 2', 'NumDmg$ 3'))],
    ['another UnlessCost', mystic.map((line) => line.replace('UnlessCost$ 3', 'UnlessCost$ 4'))],
    [
      'another UnlessPayer',
      mystic.map((line) => line.replace('UnlessPayer$ ThisTargetedController', 'UnlessPayer$ You')),
    ],
    [
      'another mode order',
      mystic.map((line) =>
        line.replace('Choices$ DBCounter,DBReturn,DBDraw', 'Choices$ DBDraw,DBReturn,DBCounter'),
      ),
    ],
  ] as const)('refuses %s', (_label, script) => {
    expect(legacyCubeReviewedRepeatableModeRefusals(bytes(script), inventory)).not.toEqual([]);
  });
});
