/** Source-attested Forge export for structured CR 702.96 profiles. */
import {
  parseCard,
  type Card,
  type CardInput,
  type Color,
  type EffectInput,
  type ManaCostInput,
  type OverloadEffect,
} from '@mtg/dsl';
import { transpileEffect, transpileSet } from '@mtg/forge-export';
import { describe, expect, it } from 'vitest';
import { mustTranspile } from './helpers';

interface OverloadFixture {
  readonly collectorNumber: number;
  readonly name: string;
  readonly kind?: 'instant' | 'sorcery';
  readonly manaCost: ManaCostInput;
  readonly colors: readonly Color[];
  readonly effects: readonly EffectInput[];
  readonly overloadCost: ManaCostInput;
  readonly overloadEffects: readonly OverloadEffect[];
  readonly keyword: string;
  readonly ordinary: readonly string[];
}

function cardOf(fixture: OverloadFixture): Card {
  return parseCard({
    kind: fixture.kind ?? 'instant',
    id: `rtr-${String(fixture.collectorNumber)}-${fixture.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: fixture.name,
    rarity: 'uncommon',
    set: { code: 'RTR', collectorNumber: fixture.collectorNumber },
    manaCost: fixture.manaCost,
    colors: fixture.colors,
    effects: [...fixture.effects],
    overload: { cost: fixture.overloadCost, effects: [...fixture.overloadEffects] },
  } as CardInput);
}

const NO_TARGET: { readonly kind: 'noTarget' } = { kind: 'noTarget' };
const OPPOSING_CREATURES: {
  readonly scope: 'permanentsYouDontControl';
  readonly scopeFilter: { readonly cardTypes: ['creature'] };
  readonly target: { readonly kind: 'noTarget' };
} = {
  scope: 'permanentsYouDontControl',
  scopeFilter: { cardTypes: ['creature'] },
  target: NO_TARGET,
};
const YOUR_CREATURES: {
  readonly scope: 'permanentsYouControl';
  readonly scopeFilter: { readonly cardTypes: ['creature'] };
  readonly target: { readonly kind: 'noTarget' };
} = {
  scope: 'permanentsYouControl',
  scopeFilter: { cardTypes: ['creature'] },
  target: NO_TARGET,
};

const FIXTURES: readonly OverloadFixture[] = [
  {
    collectorNumber: 38,
    name: 'Downsize',
    manaCost: { U: 1 },
    colors: ['U'],
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -4,
        toughness: 0,
        target: { kind: 'targetCreatureYouDontControl' },
      },
    ],
    overloadCost: { generic: 2, U: 1 },
    overloadEffects: [{ kind: 'pumpUntilEndOfTurn', power: -4, toughness: 0, ...OPPOSING_CREATURES }],
    keyword: 'K:Overload:2 U',
    ordinary: ['A:SP$ Pump', 'ValidTgts$ Creature.YouDontCtrl', 'NumAtt$ -4', 'NumDef$ +0'],
  },
  {
    collectorNumber: 92,
    name: 'Dynacharge',
    manaCost: { R: 1 },
    colors: ['R'],
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 2,
        toughness: 0,
        target: { kind: 'targetCreatureYouControl' },
      },
    ],
    overloadCost: { generic: 2, R: 1 },
    overloadEffects: [{ kind: 'pumpUntilEndOfTurn', power: 2, toughness: 0, ...YOUR_CREATURES }],
    keyword: 'K:Overload:2 R',
    ordinary: ['A:SP$ Pump', 'ValidTgts$ Creature.YouCtrl', 'NumAtt$ +2', 'NumDef$ +0'],
  },
  {
    collectorNumber: 93,
    name: 'Electrickery',
    manaCost: { R: 1 },
    colors: ['R'],
    effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetCreatureYouDontControl' } }],
    overloadCost: { generic: 1, R: 1 },
    overloadEffects: [{ kind: 'dealDamage', amount: 1, ...OPPOSING_CREATURES }],
    keyword: 'K:Overload:1 R',
    ordinary: ['A:SP$ DealDamage', 'ValidTgts$ Creature.YouDontCtrl', 'NumDmg$ 1'],
  },
  {
    collectorNumber: 101,
    name: 'Mizzium Mortars',
    kind: 'sorcery',
    manaCost: { generic: 1, R: 1 },
    colors: ['R'],
    effects: [{ kind: 'dealDamage', amount: 4, target: { kind: 'targetCreatureYouDontControl' } }],
    overloadCost: { generic: 3, R: 3 },
    overloadEffects: [{ kind: 'dealDamage', amount: 4, ...OPPOSING_CREATURES }],
    keyword: 'K:Overload:3 R R R',
    ordinary: ['A:SP$ DealDamage', 'ValidTgts$ Creature.YouDontCtrl', 'NumDmg$ 4'],
  },
];

describe('Forge native Overload keyword profiles', () => {
  it.each(FIXTURES)('exports $name from its structured ordinary and overload profiles', (fixture) => {
    const lines = mustTranspile(cardOf(fixture)).split('\n');
    expect(lines).toContain(fixture.keyword);
    const ordinary = lines.find((line) => line.startsWith('A:')) ?? '';
    for (const part of fixture.ordinary) expect(ordinary).toContain(part);
    expect(lines.filter((line) => line.startsWith('A:'))).toHaveLength(1);
  });

  it('exports Street Spasm with two paid X symbols and one retained xPaid value', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'rtr-106-street-spasm',
      name: 'Street Spasm',
      rarity: 'uncommon',
      set: { code: 'RTR', collectorNumber: 106 },
      manaCost: { R: 1, hasX: true },
      colors: ['R'],
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'chosenX' },
          target: {
            kind: 'targetCreatureYouDontControl',
            restriction: { kind: 'withoutKeyword', keyword: 'flying' },
          },
        },
      ],
      overload: {
        cost: { R: 2, hasX: true },
        xSymbols: 2,
        effects: [
          {
            kind: 'dealDamage',
            amount: { kind: 'chosenX' },
            scope: 'permanentsYouDontControl',
            scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
            target: NO_TARGET,
          },
        ],
      },
    });
    const lines = mustTranspile(card).split('\n');

    expect(lines).toContain('ManaCost:X R');
    expect(lines).toContain('K:Overload:X X R R');
    expect(lines).toContain('SVar:X:Count$xPaid');
    expect(lines.filter((line) => line === 'SVar:X:Count$xPaid')).toHaveLength(1);
    expect(lines.find((line) => line.startsWith('A:'))).toContain(
      'ValidTgts$ Creature.withoutFlying+YouDontCtrl',
    );
    expect(lines.find((line) => line.startsWith('A:'))).toContain('NumDmg$ X');
  });

  it('exports the source-attested ordinary selectors for Vandalblast and Cyclonic Rift', () => {
    const vandalblast = cardOf({
      collectorNumber: 111,
      name: 'Vandalblast',
      kind: 'sorcery',
      manaCost: { R: 1 },
      colors: ['R'],
      effects: [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactYouDontControl' } }],
      overloadCost: { generic: 4, R: 1 },
      overloadEffects: [
        {
          kind: 'destroyPermanent',
          scope: 'permanentsYouDontControl',
          scopeFilter: { cardTypes: ['artifact'] },
          target: NO_TARGET,
        },
      ],
      keyword: 'K:Overload:4 R',
      ordinary: [],
    });
    const rift = cardOf({
      collectorNumber: 35,
      name: 'Cyclonic Rift',
      manaCost: { generic: 1, U: 1 },
      colors: ['U'],
      effects: [{ kind: 'returnToHand', target: { kind: 'targetNonlandPermanentYouDontControl' } }],
      overloadCost: { generic: 6, U: 1 },
      overloadEffects: [
        {
          kind: 'returnToHand',
          scope: 'permanentsYouDontControl',
          scopeFilter: { excludeCardTypes: ['land'] },
          target: NO_TARGET,
        },
      ],
      keyword: 'K:Overload:6 U',
      ordinary: [],
    });

    expect(mustTranspile(vandalblast)).toContain('A:SP$ Destroy | ValidTgts$ Artifact.YouDontCtrl');
    expect(mustTranspile(rift)).toContain('A:SP$ ChangeZone | ValidTgts$ Permanent.nonLand+YouDontCtrl');
  });

  it("retains Mizzium Skin's pumped cohort for its keyword rider", () => {
    const skin = cardOf({
      collectorNumber: 45,
      name: 'Mizzium Skin',
      manaCost: { U: 1 },
      colors: ['U'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 0,
          toughness: 1,
          target: { kind: 'targetCreatureYouControl' },
        },
        { kind: 'grantKeywordUntilEndOfTurn', keyword: 'hexproof', target: { kind: 'thatCreature' } },
      ],
      overloadCost: { generic: 1, U: 1 },
      overloadEffects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 0,
          toughness: 1,
          ...YOUR_CREATURES,
        },
        {
          kind: 'grantKeywordUntilEndOfTurn',
          keyword: 'hexproof',
          ...YOUR_CREATURES,
        },
      ],
      keyword: 'K:Overload:1 U',
      ordinary: [],
    });
    const script = mustTranspile(skin);

    expect(script).toContain(
      'A:SP$ Pump | ValidTgts$ Creature.YouCtrl | NumAtt$ +0 | NumDef$ +1 | RememberPumped$ True | SubAbility$ DBEffect1',
    );
    expect(script).toContain('SVar:DBEffect1:DB$ Pump | Defined$ Remembered | KW$ Hexproof');
    expect(script).toContain('SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True');
  });

  it("exports Teleportal's source-attested remembered-pump chain", () => {
    const teleportal = cardOf({
      collectorNumber: 202,
      name: 'Teleportal',
      kind: 'sorcery',
      manaCost: { U: 1, R: 1 },
      colors: ['U', 'R'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 0,
          target: { kind: 'targetCreatureYouControl' },
        },
        { kind: 'cantBeBlockedThisTurn', target: { kind: 'thatCreature' } },
      ],
      overloadCost: { generic: 3, U: 1, R: 1 },
      overloadEffects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: 1,
          toughness: 0,
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: NO_TARGET,
        },
        {
          kind: 'cantBeBlockedThisTurn',
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: NO_TARGET,
        },
      ],
      keyword: 'K:Overload:3 U R',
      ordinary: [],
    });
    const script = mustTranspile(teleportal);

    expect(script).toContain(
      'A:SP$ Pump | ValidTgts$ Creature.YouCtrl | NumAtt$ +1 | NumDef$ +0 | RememberPumped$ True | SubAbility$ DBEffect1',
    );
    expect(script).toContain(
      'SVar:DBEffect1:DB$ Effect | RememberObjects$ Remembered | ForgetOnMoved$ Battlefield | StaticAbilities$ Unblockable | SubAbility$ DBEffect2',
    );
    expect(script).toContain('SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True');
    expect(script).toContain(
      "SVar:Unblockable:Mode$ CantBlockBy | ValidAttacker$ Card.IsRemembered | Description$ This creature can't be blocked this turn.",
    );
  });

  it("exports Chemister's Trick with the source-attested remembered-pump chain", () => {
    const trick = cardOf({
      collectorNumber: 149,
      name: "Chemister's Trick",
      manaCost: { U: 1, R: 1 },
      colors: ['U', 'R'],
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -2,
          toughness: 0,
          target: { kind: 'targetCreatureYouDontControl' },
        },
        { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
      ],
      overloadCost: { generic: 3, U: 1, R: 1 },
      overloadEffects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -2,
          toughness: 0,
          scope: 'permanentsYouDontControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: NO_TARGET,
        },
        {
          kind: 'attacksThisTurnIfAble',
          scope: 'permanentsYouDontControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: NO_TARGET,
        },
      ],
      keyword: 'K:Overload:3 U R',
      ordinary: [],
    });
    const script = mustTranspile(trick);

    expect(script).toContain(
      'A:SP$ Pump | ValidTgts$ Creature.YouDontCtrl | NumAtt$ -2 | NumDef$ +0 | RememberPumped$ True | SubAbility$ DBEffect1',
    );
    expect(script).toContain(
      'SVar:DBEffect1:DB$ Effect | StaticAbilities$ MustAttack | ExileOnMoved$ Battlefield | RememberObjects$ Remembered | SubAbility$ DBEffect2',
    );
    expect(script).toContain('SVar:DBEffect2:DB$ Cleanup | ClearRemembered$ True');
    expect(script).toContain(
      'SVar:MustAttack:Mode$ MustAttack | ValidCreature$ Creature.IsRemembered | Description$ This creature attacks this turn if able.',
    );
  });

  it("exports Counterflux's opposing target, opposing sweep, and counter immunity exactly", () => {
    const card = parseCard({
      kind: 'instant',
      id: 'rtr-153-counterflux',
      name: 'Counterflux',
      rarity: 'rare',
      set: { code: 'RTR', collectorNumber: 153 },
      manaCost: { U: 2, R: 1 },
      colors: ['U', 'R'],
      cannotBeCountered: true,
      effects: [{ kind: 'counterSpell' }],
      overload: {
        cost: { generic: 1, U: 2, R: 1 },
        effects: [{ kind: 'counterSpell', spellSelection: 'spellsYouDontControl' }],
      },
    });
    const lines = mustTranspile(card).split('\n');

    expect(lines).toContain(
      "R:Event$ Counter | ValidCard$ Card.Self | ValidSA$ Spell | Layer$ CantHappen | Description$ This spell can't be countered.",
    );
    expect(lines).toContain('K:Overload:1 U U R');
    expect(lines.find((line) => line.startsWith('A:'))).toBe(
      "A:SP$ Counter | TargetType$ Spell | ValidTgts$ Card.YouDontCtrl | TgtPrompt$ Select target spell you don't control | SpellDescription$ Counter target spell you don't control.",
    );
  });

  it('writes the source-attested opponent-only nonland selector for Cyclonic Rift', () => {
    const result = transpileEffect(
      {
        kind: 'returnToHand',
        target: { kind: 'targetNonlandPermanentOpponentControls' },
      },
      'rtr-35-cyclonic-rift',
      'effects[0]',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        ability: {
          api: 'ChangeZone',
          params: [
            ['ValidTgts', 'Permanent.nonLand+OppCtrl'],
            ['Origin', 'Battlefield'],
            ['Destination', 'Hand'],
          ],
        },
      },
    });
  });

  it('rejects an unsupported replacement shape before emitting any Forge card', () => {
    const valid = cardOf(FIXTURES[1]!);
    if (valid.kind !== 'instant' && valid.kind !== 'sorcery') throw new Error('expected spell');
    const invalid = {
      ...valid,
      overload: {
        ...valid.overload,
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: -3,
            toughness: 0,
            ...OPPOSING_CREATURES,
          },
        ],
      },
    } as Card;
    const result = transpileSet([invalid], { name: 'RTR Overload Test', date: '2012-10-05' });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.rejections).toEqual([
      expect.objectContaining({
        code: 'DSL_VIOLATION',
        cardId: valid.id,
        path: 'cards[0].overload.effects[0]',
        message: expect.stringContaining('may not change the effect payload'),
      }),
    ]);
  });
});
