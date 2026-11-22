/** Overload is a hand-authored alternate cast profile with structured replacement effects. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  abilityLineReminder,
  canonicalJson,
  formatManaCost,
  formatOverloadCost,
  ModelEffectSchema,
  ModelManaCostSchema,
  ModelTargetSpecSchema,
  overloadReminder,
  parseCard,
  renderOracleText,
  safeParseCard,
  spellEffectsFor,
  validateCard,
  type CardInput,
} from '@mtg/dsl';

function digest(schema: z.ZodType): string {
  return createHash('sha256')
    .update(canonicalJson(z.toJSONSchema(schema, { io: 'output' })))
    .digest('hex');
}

const DOWNSIZE = {
  kind: 'instant',
  id: 'rtr-38-downsize',
  name: 'Downsize',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 38 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -4,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
  ],
  overload: {
    cost: { generic: 2, U: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -4,
        toughness: 0,
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const STREET_SPASM = {
  kind: 'instant',
  id: 'rtr-106-street-spasm',
  name: 'Street Spasm',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 106 },
  colors: ['R'],
  manaCost: { R: 1, hasX: true },
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
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const COUNTERFLUX = {
  kind: 'instant',
  id: 'rtr-153-counterflux',
  name: 'Counterflux',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 153 },
  colors: ['U', 'R'],
  manaCost: { U: 2, R: 1 },
  cannotBeCountered: true,
  effects: [{ kind: 'counterSpell' }],
  overload: {
    cost: { generic: 1, U: 2, R: 1 },
    effects: [{ kind: 'counterSpell', spellSelection: 'spellsYouDontControl' }],
  },
} as unknown as CardInput;

const BLUSTERSQUALL = {
  kind: 'instant',
  id: 'rtr-30-blustersquall',
  name: 'Blustersquall',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 30 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [{ kind: 'tapPermanent', target: { kind: 'targetCreatureYouDontControl' } }],
  overload: {
    cost: { generic: 3, U: 1 },
    effects: [
      {
        kind: 'tapPermanent',
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const VANDALBLAST = {
  kind: 'sorcery',
  id: 'rtr-111-vandalblast',
  name: 'Vandalblast',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 111 },
  colors: ['R'],
  manaCost: { R: 1 },
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetArtifactYouDontControl' } }],
  overload: {
    cost: { generic: 4, R: 1 },
    effects: [
      {
        kind: 'destroyPermanent',
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['artifact'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const MIZZIUM_SKIN = {
  kind: 'instant',
  id: 'rtr-45-mizzium-skin',
  name: 'Mizzium Skin',
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 45 },
  colors: ['U'],
  manaCost: { U: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 0,
      toughness: 1,
      target: { kind: 'targetCreatureYouControl' },
    },
    { kind: 'grantKeywordUntilEndOfTurn', keyword: 'hexproof', target: { kind: 'thatCreature' } },
  ],
  overload: {
    cost: { generic: 1, U: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 0,
        toughness: 1,
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'grantKeywordUntilEndOfTurn',
        keyword: 'hexproof',
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const CYCLONIC_RIFT = {
  kind: 'instant',
  id: 'rtr-35-cyclonic-rift',
  name: 'Cyclonic Rift',
  rarity: 'rare',
  set: { code: 'RTR', collectorNumber: 35 },
  colors: ['U'],
  manaCost: { generic: 1, U: 1 },
  effects: [{ kind: 'returnToHand', target: { kind: 'targetNonlandPermanentYouDontControl' } }],
  overload: {
    cost: { generic: 6, U: 1 },
    effects: [
      {
        kind: 'returnToHand',
        scope: 'permanentsYouDontControl',
        scopeFilter: { excludeCardTypes: ['land'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

function ownPump(
  id: string,
  name: string,
  collectorNumber: number,
  power: number,
  overloadGeneric: number,
): CardInput {
  return {
    kind: 'instant',
    id,
    name,
    rarity: 'common',
    set: { code: 'RTR', collectorNumber },
    colors: ['R'],
    manaCost: { R: 1 },
    effects: [
      { kind: 'pumpUntilEndOfTurn', power, toughness: 0, target: { kind: 'targetCreatureYouControl' } },
    ],
    overload: {
      cost: { generic: overloadGeneric, R: 1 },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power,
          toughness: 0,
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
      ],
    },
  } as unknown as CardInput;
}

const DYNACHARGE = ownPump('rtr-92-dynacharge', 'Dynacharge', 92, 2, 2);

function opposingDamage(
  kind: 'instant' | 'sorcery',
  id: string,
  name: string,
  rarity: 'common' | 'rare',
  collectorNumber: number,
  manaCost: Readonly<Record<string, number>>,
  amount: number,
  overloadCost: Readonly<Record<string, number>>,
): CardInput {
  return {
    kind,
    id,
    name,
    rarity,
    set: { code: 'RTR', collectorNumber },
    colors: ['R'],
    manaCost,
    effects: [{ kind: 'dealDamage', amount, target: { kind: 'targetCreatureYouDontControl' } }],
    overload: {
      cost: overloadCost,
      effects: [
        {
          kind: 'dealDamage',
          amount,
          scope: 'permanentsYouDontControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
      ],
    },
  } as unknown as CardInput;
}

const ELECTRICKERY = opposingDamage(
  'instant',
  'rtr-93-electrickery',
  'Electrickery',
  'common',
  93,
  { R: 1 },
  1,
  { generic: 1, R: 1 },
);
const MIZZIUM_MORTARS = opposingDamage(
  'sorcery',
  'rtr-101-mizzium-mortars',
  'Mizzium Mortars',
  'rare',
  101,
  { generic: 1, R: 1 },
  4,
  { generic: 3, R: 3 },
);

const CHEMISTERS_TRICK = {
  kind: 'instant',
  id: 'rtr-149-chemisters-trick',
  name: "Chemister's Trick",
  rarity: 'common',
  set: { code: 'RTR', collectorNumber: 149 },
  colors: ['U', 'R'],
  manaCost: { U: 1, R: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: -2,
      toughness: 0,
      target: { kind: 'targetCreatureYouDontControl' },
    },
    { kind: 'attacksThisTurnIfAble', target: { kind: 'thatCreature' } },
  ],
  overload: {
    cost: { generic: 3, U: 1, R: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: -2,
        toughness: 0,
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'attacksThisTurnIfAble',
        scope: 'permanentsYouDontControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const TELEPORTAL = {
  kind: 'sorcery',
  id: 'rtr-202-teleportal',
  name: 'Teleportal',
  rarity: 'uncommon',
  set: { code: 'RTR', collectorNumber: 202 },
  colors: ['U', 'R'],
  manaCost: { U: 1, R: 1 },
  effects: [
    {
      kind: 'pumpUntilEndOfTurn',
      power: 1,
      toughness: 0,
      target: { kind: 'targetCreatureYouControl' },
    },
    { kind: 'cantBeBlockedThisTurn', target: { kind: 'thatCreature' } },
  ],
  overload: {
    cost: { generic: 3, U: 1, R: 1 },
    effects: [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 0,
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
      {
        kind: 'cantBeBlockedThisTurn',
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: { kind: 'noTarget' },
      },
    ],
  },
} as unknown as CardInput;

const SOURCE_CARDS = [
  BLUSTERSQUALL,
  CYCLONIC_RIFT,
  DOWNSIZE,
  MIZZIUM_SKIN,
  DYNACHARGE,
  ELECTRICKERY,
  MIZZIUM_MORTARS,
  STREET_SPASM,
  VANDALBLAST,
  CHEMISTERS_TRICK,
  COUNTERFLUX,
  TELEPORTAL,
] as const;

describe('Overload card contract', () => {
  it('accepts exact source identities and the missing ordinary target envelopes', () => {
    expect(
      SOURCE_CARDS.map((input) => {
        const card = parseCard(input);
        if ((card.kind !== 'instant' && card.kind !== 'sorcery') || card.overload === undefined) {
          throw new Error(`${card.name} did not parse with Overload`);
        }
        return [
          card.name,
          card.rarity,
          card.set.collectorNumber,
          formatManaCost(card.manaCost),
          formatOverloadCost(card.overload),
        ];
      }),
    ).toEqual([
      ['Blustersquall', 'uncommon', 30, '{U}', '{3}{U}'],
      ['Cyclonic Rift', 'rare', 35, '{1}{U}', '{6}{U}'],
      ['Downsize', 'common', 38, '{U}', '{2}{U}'],
      ['Mizzium Skin', 'common', 45, '{U}', '{1}{U}'],
      ['Dynacharge', 'common', 92, '{R}', '{2}{R}'],
      ['Electrickery', 'common', 93, '{R}', '{1}{R}'],
      ['Mizzium Mortars', 'rare', 101, '{1}{R}', '{3}{R}{R}{R}'],
      ['Street Spasm', 'uncommon', 106, '{X}{R}', '{X}{X}{R}{R}'],
      ['Vandalblast', 'uncommon', 111, '{R}', '{4}{R}'],
      ["Chemister's Trick", 'common', 149, '{U}{R}', '{3}{U}{R}'],
      ['Counterflux', 'rare', 153, '{U}{U}{R}', '{1}{U}{U}{R}'],
      ['Teleportal', 'uncommon', 202, '{U}{R}', '{3}{U}{R}'],
    ]);
  });

  it('accepts a same-subject thatCreature rider paired to one overloaded cohort', () => {
    expect(renderOracleText(parseCard(MIZZIUM_SKIN))).toContain(
      'Target creature you control gets +0/+1 and gains hexproof until end of turn.',
    );
    expect(renderOracleText(parseCard(CHEMISTERS_TRICK))).toContain(
      "Target creature you don't control gets -2/-0 until end of turn and attacks this turn if able.",
    );
    expect(renderOracleText(parseCard(TELEPORTAL))).toContain(
      "Target creature you control gets +1/+0 until end of turn and can't be blocked this turn.",
    );
  });

  it('keeps a retained keyword rider before a computed pump suffix', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'computed-pump-rider',
      name: 'Computed Pump Rider',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 1 },
      colors: ['G'],
      manaCost: { G: 1 },
      effects: [
        {
          kind: 'pumpUntilEndOfTurn',
          power: { kind: 'countMatching', filter: { cardTypes: ['creature'] } },
          toughness: 0,
          target: { kind: 'targetCreature' },
        },
        { kind: 'grantKeywordUntilEndOfTurn', keyword: 'trample', target: { kind: 'thatCreature' } },
      ],
    });

    expect(renderOracleText(card)).toBe(
      'Target creature gets +X/+0 and gains trample until end of turn, where X is the number of creatures you control.',
    );
  });

  it('derives the dynamic Overload reminder from the rendered cost line', () => {
    const streetSpasm = parseCard(STREET_SPASM);
    if (streetSpasm.kind !== 'instant' || streetSpasm.overload === undefined) {
      throw new Error('Street Spasm did not parse with Overload');
    }
    expect(abilityLineReminder('Overload {X}{X}{R}{R}')).toEqual({
      keyword: 'Overload {X}{X}{R}{R}',
      gloss:
        '(You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
    });
    expect(overloadReminder(streetSpasm.overload)).toEqual({
      keyword: 'Overload {X}{X}{R}{R}',
      gloss:
        '(You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")',
    });
  });

  it('selects ordinary and overloaded structured effects without rewriting text', () => {
    const card = parseCard(DOWNSIZE);
    if (card.kind !== 'instant') throw new Error('Downsize did not parse as an instant');

    expect(spellEffectsFor(card, null, 'ordinary')).toEqual(card.effects);
    expect(spellEffectsFor(card, null, 'overload')).toEqual(card.overload?.effects);
    expect(renderOracleText(card)).toBe(
      ["Target creature you don't control gets -4/-0 until end of turn.", 'Overload {2}{U}'].join('\n'),
    );
  });

  it('represents {X}{X} beside the overload cost while retaining one chosen X amount', () => {
    const card = parseCard(STREET_SPASM);
    if (card.kind !== 'instant') throw new Error('Street Spasm did not parse as an instant');

    expect(card.overload?.cost.hasX).toBe(true);
    expect(card.overload?.xSymbols).toBe(2);
    expect(renderOracleText(card)).toBe(
      [
        "Street Spasm deals X damage to target creature without flying you don't control.",
        'Overload {X}{X}{R}{R}',
      ].join('\n'),
    );
  });

  it('prints Counterflux ordinary targeting from its structured opposing-spell selection', () => {
    const card = parseCard(COUNTERFLUX);

    expect(spellEffectsFor(card, null, 'ordinary')).toEqual([
      { kind: 'counterSpell', spellSelection: 'targetSpellYouDontControl' },
    ]);
    expect(renderOracleText(card)).toBe(
      [
        "This spell can't be countered.",
        "Counter target spell you don't control.",
        'Overload {1}{U}{U}{R}',
      ].join('\n'),
    );
  });

  it('rejects a replacement that changes rules values, retains a target, or reaches the wrong side', () => {
    const base = DOWNSIZE as unknown as Record<string, unknown>;
    const invalidEffects = [
      [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -3,
          toughness: 0,
          scope: 'permanentsYouDontControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
      ],
      [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -4,
          toughness: 0,
          target: { kind: 'targetCreatureYouDontControl' },
        },
      ],
      [
        {
          kind: 'pumpUntilEndOfTurn',
          power: -4,
          toughness: 0,
          scope: 'permanentsYouControl',
          scopeFilter: { cardTypes: ['creature'] },
          target: { kind: 'noTarget' },
        },
      ],
    ];
    for (const effects of invalidEffects) {
      const parsed = safeParseCard({
        ...base,
        overload: { cost: { generic: 2, U: 1 }, effects },
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok)
        expect(parsed.violations.map((violation) => violation.code)).toContain('INVALID_OVERLOAD_PAIR');
    }
  });

  it('rejects multiplicity without X, X without a chosen-X effect, and competing alternate profiles', () => {
    const base = STREET_SPASM as unknown as Record<string, unknown>;
    const overload = (base.overload ?? {}) as Record<string, unknown>;
    expect(safeParseCard({ ...base, overload: { ...overload, cost: { R: 2 }, xSymbols: 2 } }).ok).toBe(false);
    expect(
      safeParseCard({
        ...base,
        overload: {
          ...overload,
          effects: [
            {
              kind: 'dealDamage',
              amount: 3,
              scope: 'permanentsYouDontControl',
              scopeFilter: { cardTypes: ['creature'], excludeKeywords: ['flying'] },
              target: { kind: 'noTarget' },
            },
          ],
        },
      }).ok,
    ).toBe(false);
    expect(
      safeParseCard({
        ...(DOWNSIZE as unknown as Record<string, unknown>),
        alternativeCost: {
          payLife: 1,
          sacrificeMatching: { count: 1, filter: { cardTypes: ['creature'] } },
        },
      }).ok,
    ).toBe(false);
  });

  it('keeps overload, its scope, and X multiplicity outside every model-facing schema', async () => {
    expect(digest(ModelEffectSchema)).toBe(
      '654b51f0eded32ff5af1d228413125e291976f1abd2d94dfa8064a6d055c391a',
    );
    expect(digest(ModelManaCostSchema)).toBe(
      '1fe727a509658a0f25e9a1b3fbe98185d09697f2aac2f4c43c9a943af2929c76',
    );
    expect(digest(ModelTargetSpecSchema)).toBe(
      '583f5562ecfa8534e871edecfc70124ad38663e6773141c9b1ea0af78938c919',
    );
    const { FilledCardSchema } = await import('@mtg/setgen');
    expect(digest(FilledCardSchema)).toBe('b62ecc8da776c27f9fd1d779a9246439223cd397810cc829a8105166d4c6d22b');
    const shown = canonicalJson(z.toJSONSchema(ModelEffectSchema, { io: 'output' }));
    expect(shown).not.toContain('permanentsYouDontControl');
    expect(shown).not.toContain('spellSelection');
    expect(ModelTargetSpecSchema.safeParse({ kind: 'targetArtifactYouDontControl' }).success).toBe(false);
    expect(ModelTargetSpecSchema.safeParse({ kind: 'targetNonlandPermanentYouDontControl' }).success).toBe(
      false,
    );
    expect(canonicalJson(z.toJSONSchema(ModelManaCostSchema, { io: 'output' }))).not.toContain('xSymbols');
    expect(validateCard(parseCard(DOWNSIZE))).toEqual([]);
  });
});
