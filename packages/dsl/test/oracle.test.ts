import { describe, expect, it } from 'vitest';
import {
  EFFECT_KINDS,
  EXAMPLE_SET,
  exaltedAbility,
  exampleCard,
  formatManaCost,
  mana,
  manaValue,
  renderAbility,
  renderCard,
  renderEffect,
  renderOracleText,
  renderTypeLine,
  typeLineParts,
} from '@mtg/dsl';
import type { Ability, Effect, EffectKind } from '@mtg/dsl';

describe('mana cost formatting', () => {
  it('prints generic then colored pips in WUBRG order', () => {
    expect(formatManaCost(mana({ generic: 1, R: 1 }))).toBe('{1}{R}');
    expect(formatManaCost(mana({ G: 1, W: 1 }))).toBe('{W}{G}');
    expect(formatManaCost(mana({ generic: 3 }))).toBe('{3}');
    expect(formatManaCost(mana())).toBe('{0}');
    expect(formatManaCost(mana({ U: 2 }))).toBe('{U}{U}');
  });

  it('mana value counts generic plus every pip', () => {
    expect(manaValue(mana({ generic: 2, W: 1, B: 1 }))).toBe(4);
  });
});

describe('type lines', () => {
  it('renders each card kind', () => {
    expect(renderTypeLine(exampleCard('slc-skywatch-sentinel'))).toBe('Creature — Bird Soldier');
    expect(renderTypeLine(exampleCard('slc-lightning-lash'))).toBe('Instant');
    expect(renderTypeLine(exampleCard('slc-mortal-verdict'))).toBe('Sorcery');
    expect(renderTypeLine(exampleCard('slc-ironclad-golem'))).toBe('Artifact Creature — Golem');
    expect(renderTypeLine(exampleCard('slc-bronze-monument'))).toBe('Artifact');
    expect(renderTypeLine(exampleCard('slc-mountain'))).toBe('Basic Land — Mountain');
  });

  it('exposes structured parts', () => {
    expect(typeLineParts(exampleCard('slc-ironclad-golem'))).toEqual({
      supertypes: [],
      types: ['Artifact', 'Creature'],
      subtypes: ['Golem'],
    });
  });
});

describe('oracle text', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['slc-skywatch-sentinel', 'Flying, vigilance'],
    ['slc-radiant-charge', 'Target creature gets +2/+2 until end of turn. You gain 2 life.'],
    ['slc-lifebound-cleric', 'Lifelink, first strike'],
    ['slc-windrider-drake', 'Flying'],
    ['slc-dissolving-word', 'Counter target spell. Draw a card.'],
    ['slc-frostbind-current', 'Tap target creature.'],
    ['slc-undertow-snare', "Return target creature to its owner's hand."],
    ['slc-graveblade-stalker', 'Deathtouch, menace'],
    ['slc-mortal-verdict', 'Destroy target creature.'],
    ['slc-grasping-mire', 'Target player mills four cards.'],
    ['slc-emberflow-raider', 'Haste'],
    ['slc-lightning-lash', 'Lightning Lash deals 3 damage to any target.'],
    ['slc-thornhide-guardian', 'Trample, reach'],
    ['slc-wild-summons', 'Create two 2/2 green Bear creature tokens.'],
    ['slc-ironclad-golem', ''],
    ['slc-bronze-monument', ''],
    ['slc-mountain', '{T}: Add {R}.'],
  ];

  for (const [id, expected] of cases) {
    it(`renders ${id}`, () => {
      expect(renderOracleText(exampleCard(id))).toBe(expected);
    });
  }

  it('is stable: rendering twice yields identical text for every fixture', () => {
    for (const card of EXAMPLE_SET) {
      expect(renderOracleText(card)).toBe(renderOracleText(card));
    }
  });

  it('orders keywords canonically regardless of authored order', () => {
    const card = exampleCard('slc-thornhide-guardian');
    const shuffled = { ...card, keywords: [...card.keywords].reverse() };
    expect(renderOracleText(shuffled)).toBe(renderOracleText(card));
  });

  it('renders the whole printed card', () => {
    expect(renderCard(exampleCard('slc-lightning-lash'))).toBe(
      ['Lightning Lash {1}{R}', 'Instant', 'Lightning Lash deals 3 damage to any target.'].join('\n'),
    );
    expect(renderCard(exampleCard('slc-skywatch-sentinel'))).toBe(
      ['Skywatch Sentinel {1}{W}', 'Creature — Bird Soldier', 'Flying, vigilance', '2/1'].join('\n'),
    );
  });
});

describe('modal spell text', () => {
  // CR 700.2's "Choose one —" family: `checkEffects` permits (and requires,
  // for a modal spell) an empty `effects` list beside a populated `modes`
  // list, so a card that reaches this renderer with `effects: []` and
  // `modes` set is not a blank spell — it is a modal one, and it must not
  // render as one.
  const verdict = exampleCard('slc-mortal-verdict');
  const BOLT: Effect = { kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } };
  const DRAW: Effect = { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } };

  it('prints "Choose one —" and one bulleted line per mode, not a blank effect paragraph', () => {
    const card = { ...verdict, effects: [], modes: [{ effects: [BOLT] }, { effects: [DRAW] }] };
    expect(renderOracleText(card).split('\n')).toEqual([
      'Choose one —',
      `• ${verdict.name} deals 3 damage to target creature.`,
      '• Draw a card.',
    ]);
  });

  it('prints every effect of a multi-effect mode on its bullet, same as a fixed effect list', () => {
    const card = { ...verdict, effects: [], modes: [{ effects: [BOLT, DRAW] }, { effects: [DRAW] }] };
    expect(renderOracleText(card).split('\n')).toEqual([
      'Choose one —',
      `• ${verdict.name} deals 3 damage to target creature. Draw a card.`,
      '• Draw a card.',
    ]);
  });
});

describe('static ability text', () => {
  const bear = exampleCard('slc-skywatch-sentinel');

  function withAbility(ability: Ability): string {
    return renderOracleText({ ...bear, keywords: [], abilities: [ability] });
  }

  const cases: ReadonlyArray<readonly [Ability, string]> = [
    [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
      'Creatures you control get +1/+1.',
    ],
    [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: 'Merfolk',
        modification: { kind: 'grantKeyword', keyword: 'vigilance' },
      },
      'Merfolk creatures you control have vigilance.',
    ],
    [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 2, toughness: -1 },
      },
      'Other creatures you control get +2/-1.',
    ],
    [
      {
        kind: 'static',
        scope: 'otherCreaturesYouControl',
        subtype: 'Soldier',
        modification: { kind: 'grantKeyword', keyword: 'firstStrike' },
      },
      'Other Soldier creatures you control have first strike.',
    ],
    [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 0 },
      },
      'Skywatch Sentinel gets +1/+0.',
    ],
    [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'grantKeyword', keyword: 'trample' },
      },
      'Skywatch Sentinel has trample.',
    ],
    [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: {
          kind: 'definePt',
          countOf: 'graveyardCardTypesEach',
          powerOffset: 0,
          toughnessOffset: 1,
        },
      },
      // CR 613.4a, Tarmogoyf's own printed sentence, verbatim.
      "Skywatch Sentinel's power is equal to the number of card types among cards in all graveyards and its toughness is equal to that number plus 1.",
    ],
    // The seven combat modifications (`static-modification-class.ts`'s
    // `'combat'` class), generalized off the Aura-only path so a plain static
    // prints the same clause an Aura would attach — CR 508/509's permissions and
    // requirements rather than CR 613's characteristic layers, dispatched
    // through `combatModificationSentence` instead of `modificationClause`.
    [
      { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantAttack' } },
      "Skywatch Sentinel can't attack.",
    ],
    [
      { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantBlock' } },
      "Skywatch Sentinel can't block.",
    ],
    [
      { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'cantBeBlocked' } },
      "Skywatch Sentinel can't be blocked.",
    ],
    [
      { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'attacksEachCombatIfAble' } },
      'Skywatch Sentinel attacks each combat if able.',
    ],
    [
      { kind: 'static', scope: 'self', subtype: null, modification: { kind: 'mustBeBlockedIfAble' } },
      'All creatures able to block Skywatch Sentinel do so.',
    ],
    [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'blockOnlyCreaturesWithKeyword', keyword: 'flying' },
      },
      'Skywatch Sentinel can block only creatures with flying.',
    ],
    // The subtype is pluralized, which is Magic's own template for this
    // restriction — Juggernaut prints "can't be blocked by Walls", never "by
    // Wall". `englishPlural` is the function that already pluralizes a subtype
    // the card chose rather than one this package wrote (`text-util.ts`), so
    // `Wall` and `Wolf` come out of the same table a `sacrificeOther` cost
    // reads.
    [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'cantBeBlockedBySubtype', subtype: 'Wall' },
      },
      "Skywatch Sentinel can't be blocked by Walls.",
    ],
    [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'cantBeBlockedBySubtype', subtype: 'Wolf' },
      },
      "Skywatch Sentinel can't be blocked by Wolves.",
    ],
  ];

  for (const [ability, expected] of cases) {
    it(`renders ${expected}`, () => {
      expect(withAbility(ability)).toBe(expected);
      // `renderAbility` is the same rule the card-level renderer uses, so the
      // two cannot disagree about a line.
      expect(renderAbility(ability, bear.name)).toBe(expected);
    });
  }

  it('slots ability lines between the keyword line and the effect paragraph', () => {
    const card = {
      ...bear,
      keywords: ['flying' as const],
      abilities: [cases[0]?.[0] ?? assertUnreachable(), cases[3]?.[0] ?? assertUnreachable()],
    };
    expect(renderOracleText(card).split('\n')).toEqual([
      'Flying',
      'Creatures you control get +1/+1.',
      'Other Soldier creatures you control have first strike.',
    ]);
  });
});

describe('triggered ability text', () => {
  const bear = exampleCard('slc-skywatch-sentinel');
  const gainTwo: Effect = { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } };

  function withAbility(ability: Ability): string {
    return renderOracleText({ ...bear, keywords: [], abilities: [ability] });
  }

  it('prints the condition clause and lowercases the sentence that follows it', () => {
    expect(withAbility({ kind: 'triggered', condition: 'selfEnters', effects: [gainTwo] })).toBe(
      `When ${bear.name} enters the battlefield, you gain 2 life.`,
    );
    expect(withAbility({ kind: 'triggered', condition: 'selfAttacks', effects: [gainTwo] })).toBe(
      `Whenever ${bear.name} attacks, you gain 2 life.`,
    );
    expect(withAbility({ kind: 'triggered', condition: 'selfDies', effects: [gainTwo] })).toBe(
      `When ${bear.name} dies, you gain 2 life.`,
    );
  });

  it('keeps a sentence that opens with the card name capitalized', () => {
    // `renderEffect` writes the card's name first only for `dealDamage`, which
    // always does; every other primitive opens with a verb or with the target.
    expect(
      withAbility({
        kind: 'triggered',
        condition: 'selfAttacks',
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayer' } }],
      }),
    ).toBe(`Whenever ${bear.name} attacks, ${bear.name} deals 1 damage to target player.`);
  });

  it('prints "you may" in front of an optional trigger (CR 603.3b)', () => {
    expect(
      withAbility({
        kind: 'triggered',
        condition: 'selfDies',
        optional: true,
        effects: [
          { kind: 'putCounters', counter: 'plusOnePlusOne', count: 1, target: { kind: 'targetCreature' } },
        ],
      }),
    ).toBe(`When ${bear.name} dies, you may put a +1/+1 counter on target creature.`);
  });

  it('switches to "you may have CARDNAME deal" when the sentence names the source', () => {
    // Magic's own templating: "you may Ember Drake deals 2 damage" is not
    // English, and "you may deal 2 damage" says the player deals it.
    expect(
      withAbility({
        kind: 'triggered',
        condition: 'selfDies',
        optional: true,
        effects: [{ kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } }],
      }),
    ).toBe(`When ${bear.name} dies, you may have ${bear.name} deal 2 damage to any target.`);
  });

  it('leaves no effect kind printing the source as the subject of a "may"', () => {
    // The guard behind `mayClause`'s one rewrite. A primitive added tomorrow
    // whose sentence opens with the card's name would otherwise ship a card
    // reading "you may CARDNAME does something", silently. Every kind is walked
    // rather than the one that is known to need it.
    const sample: Readonly<Record<EffectKind, Effect>> = {
      dealDamage: { kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget' } },
      destroyPermanent: { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
      pumpUntilEndOfTurn: {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 1,
        target: { kind: 'targetCreature' },
      },
      drawCards: { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      gainLife: gainTwo,
      counterSpell: { kind: 'counterSpell' },
      createToken: {
        kind: 'createToken',
        count: 1,
        token: { name: 'Trophy Horn', colors: [], subtypes: [], keywords: [] },
      },
      tapPermanent: { kind: 'tapPermanent', target: { kind: 'targetCreature' } },
      returnToHand: { kind: 'returnToHand', target: { kind: 'targetCreature' } },
      millCards: { kind: 'millCards', count: 1, target: { kind: 'noTarget' } },
      putCounters: {
        kind: 'putCounters',
        counter: 'plusOnePlusOne',
        count: 1,
        target: { kind: 'targetCreature' },
      },
      exileTarget: { kind: 'exileTarget', target: { kind: 'targetCreature' } },
      scry: { kind: 'scry', count: 1 },
      returnFromGraveyard: {
        kind: 'returnFromGraveyard',
        scope: 'creatureCardsInPlayerGraveyard',
        target: { kind: 'targetPlayer' },
      },
    };
    for (const kind of EFFECT_KINDS) {
      const line = withAbility({
        kind: 'triggered',
        condition: 'selfDies',
        optional: true,
        effects: [sample[kind]],
      });
      expect(line, `${kind} prints the source as the subject of a "may"`).not.toContain(
        `you may ${bear.name} `,
      );
      expect(line, `${kind} lost its permission clause`).toContain('you may ');
    }
  });

  it('prints a second effect as its own sentence, unlowered', () => {
    expect(
      withAbility({
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [gainTwo, { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      }),
    ).toBe(`When ${bear.name} enters the battlefield, you gain 2 life. Draw a card.`);
  });

  it('renders one line per ability, in card order, under the keyword line', () => {
    const card = {
      ...bear,
      keywords: ['flying' as const],
      abilities: [
        {
          kind: 'static' as const,
          scope: 'creaturesYouControl' as const,
          subtype: null,
          modification: { kind: 'statBonus' as const, power: 1, toughness: 0 },
        },
        { kind: 'triggered' as const, condition: 'selfDies' as const, effects: [gainTwo] },
      ],
    };
    expect(renderOracleText(card).split('\n')).toEqual([
      'Flying',
      'Creatures you control get +1/+0.',
      `When ${bear.name} dies, you gain 2 life.`,
    ]);
  });

  it('is the same line `renderAbility` gives a transpiler, with CARDNAME in it', () => {
    expect(
      renderAbility({ kind: 'triggered', condition: 'selfEnters', effects: [gainTwo] }, 'CARDNAME'),
    ).toBe('When CARDNAME enters the battlefield, you gain 2 life.');
  });
});

describe('exalted text', () => {
  it('renders the exact keyword from its typed trigger and keeps its referent non-targeting', () => {
    expect(renderAbility(exaltedAbility(), 'Aven Squire')).toBe('Exalted');
  });
});

describe('activated ability text', () => {
  const bear = exampleCard('slc-skywatch-sentinel');
  const ping: Effect = { kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } };

  function withAbility(ability: Ability): string {
    return renderOracleText({ ...bear, keywords: [], abilities: [ability] });
  }

  it('prints the mana symbols, then the tap symbol, then a colon', () => {
    expect(
      withAbility({
        kind: 'activated',
        cost: { mana: mana({ generic: 1, R: 1 }), tapSelf: true, sacrificeSelf: false },
        effects: [ping],
      }),
    ).toBe(`{1}{R}, {T}: ${bear.name} deals 1 damage to any target.`);
  });

  it('prints a mana-only cost with no comma', () => {
    expect(
      withAbility({
        kind: 'activated',
        cost: { mana: mana({ generic: 2 }), tapSelf: false, sacrificeSelf: false },
        effects: [{ kind: 'pumpUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } }],
      }),
    ).toBe('{2}: Target creature gets +1/+1 until end of turn.');
  });

  it('prints a tap-only cost as {T}, never as {0}, {T}', () => {
    expect(
      withAbility({
        kind: 'activated',
        cost: { mana: mana(), tapSelf: true, sacrificeSelf: false },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      }),
    ).toBe('{T}: Draw a card.');
  });

  /**
   * The effect sentence keeps its capital where a trigger's loses it: a colon
   * ends the cost clause and opens a sentence, while a trigger's comma
   * continues one. Both branches of that rule are asserted, here and above,
   * because the two abilities share `renderEffect` and differ only in this.
   */
  it('does not lowercase the sentence after the colon', () => {
    expect(
      withAbility({
        kind: 'activated',
        cost: { mana: mana({ generic: 1 }), tapSelf: false, sacrificeSelf: false },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      }),
    ).toBe('{1}: You gain 2 life.');
  });

  it('prints a second effect as its own sentence', () => {
    expect(
      withAbility({
        kind: 'activated',
        cost: { mana: mana({ generic: 1, U: 1 }), tapSelf: true, sacrificeSelf: false },
        effects: [
          { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
          { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
        ],
      }),
    ).toBe('{1}{U}, {T}: Draw a card. You gain 1 life.');
  });

  it('prints all three ability kinds on one card, in card order, under the keywords', () => {
    const card = {
      ...bear,
      keywords: ['flying' as const],
      abilities: [
        {
          kind: 'static' as const,
          scope: 'creaturesYouControl' as const,
          subtype: null,
          modification: { kind: 'statBonus' as const, power: 1, toughness: 0 },
        },
        {
          kind: 'triggered' as const,
          condition: 'selfDies' as const,
          effects: [{ kind: 'gainLife' as const, amount: 2, target: { kind: 'noTarget' as const } }],
        },
      ],
    };
    // `Card.abilities` caps at two, so the three-kind line-up is asserted on
    // the renderer directly: `renderOracleText` prints whatever list it is
    // handed, and the cap is a New World Order budget, not a print rule.
    const activated = {
      kind: 'activated' as const,
      cost: { mana: mana({ generic: 2 }), tapSelf: true, sacrificeSelf: false },
      effects: [ping],
    };
    expect(renderOracleText({ ...card, abilities: [...card.abilities, activated] }).split('\n')).toEqual([
      'Flying',
      'Creatures you control get +1/+0.',
      `When ${bear.name} dies, you gain 2 life.`,
      `{2}, {T}: ${bear.name} deals 1 damage to any target.`,
    ]);
  });

  it('is the same line `renderAbility` gives a transpiler, with CARDNAME in it', () => {
    expect(
      renderAbility(
        {
          kind: 'activated',
          cost: { mana: mana({ generic: 1, R: 1 }), tapSelf: true, sacrificeSelf: false },
          effects: [ping],
        },
        'CARDNAME',
      ),
    ).toBe('{1}{R}, {T}: CARDNAME deals 1 damage to any target.');
  });
});

function assertUnreachable(): never {
  throw new Error('the static ability cases table lost an entry');
}

describe('effect rendering edge cases', () => {
  const variants: ReadonlyArray<readonly [Effect, string]> = [
    [
      { kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayer' } },
      'Probe deals 1 damage to target player.',
    ],
    [
      { kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } },
      'Probe deals 2 damage to target creature.',
    ],
    [
      { kind: 'pumpUntilEndOfTurn', power: -2, toughness: 1, target: { kind: 'targetCreature' } },
      'Target creature gets -2/+1 until end of turn.',
    ],
    [{ kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } }, 'Target player draws a card.'],
    [{ kind: 'drawCards', count: 3, target: { kind: 'noTarget' } }, 'Draw three cards.'],
    [{ kind: 'gainLife', amount: 5, target: { kind: 'targetPlayer' } }, 'Target player gains 5 life.'],
    [{ kind: 'millCards', count: 1, target: { kind: 'noTarget' } }, 'You mill one card.'],
    // The two arms of CR 701.22's sentence. `includeSelf` is the difference
    // between Elixir of Immortality and the same effect printed on a spell, and
    // it is the only field the renderer reads here.
    [{ kind: 'shuffleGraveyardIntoLibrary' }, "Shuffle your graveyard into its owner's library."],
    [
      { kind: 'shuffleGraveyardIntoLibrary', includeSelf: true },
      "Shuffle this permanent and your graveyard into their owner's library.",
    ],
    [
      {
        kind: 'createToken',
        count: 1,
        token: {
          name: 'Spirit',
          power: 1,
          toughness: 1,
          colors: ['W'],
          subtypes: ['Spirit'],
          keywords: ['flying'],
        },
      },
      'Create a 1/1 white Spirit creature token with flying.',
    ],
    [
      {
        kind: 'createToken',
        count: 3,
        token: { name: 'Golem', power: 8, toughness: 8, colors: [], subtypes: ['Golem'], keywords: [] },
      },
      'Create three 8/8 colorless Golem creature tokens.',
    ],
    [
      {
        kind: 'createToken',
        count: 1,
        token: { name: 'Ogre', power: 8, toughness: 8, colors: ['B', 'R'], subtypes: ['Ogre'], keywords: [] },
      },
      'Create an 8/8 black and red Ogre creature token.',
    ],
    // A `distinct` slot prints the "another target" template. The wording and
    // the kernel's tuple filter are one change: printing "another" while the
    // kernel still allowed the repeat would be worse than not printing it.
    [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } },
      'Destroy another target creature.',
    ],
    [
      {
        kind: 'pumpUntilEndOfTurn',
        power: 3,
        toughness: 1,
        target: { kind: 'targetCreature', distinct: true },
      },
      'Another target creature gets +3/+1 until end of turn.',
    ],
    [
      { kind: 'dealDamage', amount: 2, target: { kind: 'anyTarget', distinct: true } },
      'Probe deals 2 damage to another target.',
    ],
    [
      { kind: 'millCards', count: 2, target: { kind: 'targetPlayer', distinct: true } },
      'Another target player mills two cards.',
    ],
    // `TargetSpec.count` (`mtg-kg44`): "up to two target creatures", and the
    // pluralized follow-on the counted-target card needed a castable half for.
    [
      { kind: 'tapPermanent', target: { kind: 'targetCreature', count: 2 } },
      'Tap up to two target creatures.',
    ],
    [
      {
        kind: 'tapPermanent',
        target: { kind: 'targetCreature', count: 2 },
        doesNotUntap: true,
      },
      "Tap up to two target creatures. They don't untap during their next untap step.",
    ],
    // Downpour (M13 48), the card `count`'s `literal(2)` pin kept unprintable
    // until `mtg-hgmz` widened it.
    [
      { kind: 'tapPermanent', target: { kind: 'targetCreature', count: 3 } },
      'Tap up to three target creatures.',
    ],
  ];

  for (const [effect, expected] of variants) {
    it(`renders ${effect.kind}: ${expected}`, () => {
      expect(renderEffect(effect, 'Probe')).toBe(expected);
    });
  }
});
