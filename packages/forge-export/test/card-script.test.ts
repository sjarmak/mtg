/**
 * Script-text tests: one expected Forge script per pinned vocabulary entry.
 *
 * The expected strings are asserted verbatim rather than by shape. Forge's
 * card scripts are a whitespace- and order-sensitive text format, so "an
 * ability line containing DealDamage" would pass for output Forge rejects.
 */
import { describe, expect, it } from 'vitest';
import { KEYWORDS, mana, parseCard } from '@mtg/dsl';
import { forgeManaCost, forgeTypeLine, transpileCard, transpileTokenScript } from '@mtg/forge-export';
import { creature, mustTranspile, spell } from './helpers';

describe('mana costs', () => {
  it('renders generic first, then one word per colored pip', () => {
    expect(forgeManaCost(mana({ generic: 3, W: 2 }))).toBe('3 W W');
    expect(forgeManaCost(mana({ R: 1 }))).toBe('R');
    expect(forgeManaCost(mana({ generic: 4 }))).toBe('4');
    expect(forgeManaCost(mana({ W: 1, U: 1, B: 1, R: 1, G: 1 }))).toBe('W U B R G');
  });

  it('renders a free cost as 0', () => {
    expect(forgeManaCost(mana())).toBe('0');
  });
});

describe('type lines', () => {
  it('orders supertypes, card types and subtypes', () => {
    expect(forgeTypeLine(creature('Type Probe', { subtypes: ['Bird', 'Soldier'] }))).toBe(
      'Creature Bird Soldier',
    );
    expect(
      forgeTypeLine(
        creature('Artifact Probe', {
          artifact: true,
          colors: [],
          manaCost: { generic: 4 },
          subtypes: ['Golem'],
        }),
      ),
    ).toBe('Artifact Creature Golem');
    expect(forgeTypeLine(creature('Legend Probe', { supertypes: ['legendary'], subtypes: ['Angel'] }))).toBe(
      'Legendary Creature Angel',
    );
  });
});

describe('creature scripts', () => {
  it('emits one K: line per keyword, in vocabulary order', () => {
    const card = creature('Keyword Probe', {
      keywords: ['vigilance', 'flying'],
      subtypes: ['Bird', 'Soldier'],
      power: 2,
      toughness: 1,
    });
    expect(mustTranspile(card)).toBe(
      [
        'Name:Keyword Probe',
        'ManaCost:1 W',
        'Types:Creature Bird Soldier',
        'PT:2/1',
        'K:Flying',
        'K:Vigilance',
        'Oracle:Flying, vigilance',
        '',
      ].join('\n'),
    );
  });

  it('maps every evergreen keyword to its printed Forge name', () => {
    const expected: Record<string, string> = {
      flying: 'K:Flying',
      vigilance: 'K:Vigilance',
      haste: 'K:Haste',
      trample: 'K:Trample',
      deathtouch: 'K:Deathtouch',
      lifelink: 'K:Lifelink',
      menace: 'K:Menace',
      reach: 'K:Reach',
      firstStrike: 'K:First Strike',
    };
    for (const keyword of KEYWORDS) {
      const text = mustTranspile(creature(`Solo ${keyword}`, { keywords: [keyword] }));
      expect(text).toContain(`${expected[keyword]}\n`);
    }
  });

  it('emits a vanilla creature with an empty Oracle line', () => {
    expect(mustTranspile(creature('Vanilla Probe', { subtypes: ['Golem'] }))).toBe(
      ['Name:Vanilla Probe', 'ManaCost:1 W', 'Types:Creature Golem', 'PT:2/2', 'Oracle:', ''].join('\n'),
    );
  });
});

describe('exalted scripts', () => {
  it('emits Forge native Exalted for the exact typed trigger', () => {
    const card = creature('Aven Squire', {
      abilities: [
        {
          kind: 'triggered',
          condition: 'controlledCreatureAttacksAlone',
          effects: [
            {
              kind: 'pumpUntilEndOfTurn',
              power: 1,
              toughness: 1,
              target: { kind: 'triggeringCreature' },
            },
          ],
        },
      ],
    } as never);

    const script = mustTranspile(card);
    expect(script).toContain('K:Exalted\n');
    expect(script).toContain('Oracle:Exalted\n');
  });
});

/**
 * The two vocabulary members a hand-authored card may name and the generator
 * may not, exported end to end.
 *
 * Both are checked off the emitted line rather than off `FORGE_VALID_TARGETS`
 * and `FORGE_TRIGGER_MODES`, because the line is what Forge parses and a test
 * that reads the table moves whenever the table does. Both mappings are
 * unverified against a booted Forge, which is `mtg-17a`; what is asserted here
 * is that the transpiler reaches them at all and writes the qualifier into the
 * clause it belongs to, which is the half a checkout can settle.
 */
describe('hand-authored vocabulary', () => {
  it('writes an attack trigger that reaches only the defending player creatures', () => {
    const card = creature('Withering Reach', {
      manaCost: { generic: 2, B: 1 },
      colors: ['B'],
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfAttacks',
          effects: [
            {
              kind: 'pumpUntilEndOfTurn',
              power: -2,
              toughness: -2,
              target: { kind: 'targetCreatureDefendingPlayerControls' },
            },
          ],
        },
      ],
    } as never);

    const script = mustTranspile(card);
    expect(script).toContain('T:Mode$ Attacks | ValidCard$ Card.Self | Execute$ Trig1Effect1 |');
    expect(script).toContain(
      'SVar:Trig1Effect1:DB$ Pump | ValidTgts$ Creature.DefenderCtrl | NumAtt$ -2 | NumDef$ -2',
    );
    // The wider phrase is what a dropped qualifier would leave behind, and it
    // is the export that lets the attacker shrink their own creature.
    expect(script).not.toContain('ValidTgts$ Creature |');
  });

  it('writes a death trigger the sacrifice qualifier keeps off a sacrifice', () => {
    const card = creature('Clutching Dread', {
      manaCost: { generic: 2, B: 1 },
      colors: ['B'],
      power: 3,
      toughness: 3,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfDiesNotSacrificed',
          effects: [
            {
              kind: 'createToken',
              count: 1,
              token: {
                name: 'Revenant',
                power: 5,
                toughness: 5,
                colors: ['B'],
                subtypes: ['Spirit'],
                keywords: [],
                abilities: [],
              },
            },
          ],
        },
      ],
    } as never);

    const script = mustTranspile(card);
    expect(script).toContain(
      'T:Mode$ ChangesZone | Origin$ Battlefield | Destination$ Graveyard | ' +
        'ValidCard$ Card.Self+wasNotSacrificed | Execute$ Trig1Effect1 |',
    );
    // The trigger the wider condition writes, which is the one that would fire
    // on a sacrifice and hand the outlet its second body.
    expect(script).not.toContain('ValidCard$ Card.Self |');
    expect(script).toContain("TriggerDescription$ When CARDNAME dies, if it wasn't sacrificed,");
  });
});

describe('static ability scripts', () => {
  it('writes a tribal lord as one S: line, after the keywords', () => {
    const card = creature('Merfolk Tidecaller', {
      subtypes: ['Merfolk'],
      keywords: ['flying'],
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Merfolk',
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
        },
      ],
    });
    expect(mustTranspile(card)).toBe(
      [
        'Name:Merfolk Tidecaller',
        'ManaCost:1 W',
        'Types:Creature Merfolk',
        'PT:2/2',
        'K:Flying',
        'S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl+Merfolk | AddPower$ +1 | AddToughness$ +1 | Description$ Other Merfolk creatures you control get +1/+1.',
        'Oracle:Flying\\nOther Merfolk creatures you control get +1/+1.',
        '',
      ].join('\n'),
    );
  });

  it('writes a conditional static with ConditionPresent$/ConditionCompare$, not as an unconditional S: line', () => {
    const card = creature('Trisigil Kaelen', {
      supertypes: ['legendary'],
      subtypes: ['Human'],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
          enabledWhile: { kind: 'controlsSubtype', subtype: 'Trisigil', atLeast: 1 },
        },
      ],
    });
    const line = mustTranspile(card)
      .split('\n')
      .find((entry) => entry.startsWith('S:'));
    expect(line).toBe(
      'S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ +1 | AddToughness$ +1 | ' +
        'ConditionPresent$ Trisigil.YouCtrl | ConditionCompare$ GE1 | ' +
        'Description$ As long as you control a Trisigil, creatures you control get +1/+1.',
    );
    // The unfixed bug: an S: line with no ConditionPresent$/ConditionCompare$
    // runs the modification whether or not the source controls a Trisigil,
    // which is strictly better than what the card says.
    expect(line).not.toBe(
      'S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddPower$ +1 | AddToughness$ +1 | ' +
        'Description$ As long as you control a Trisigil, creatures you control get +1/+1.',
    );
  });

  /**
   * `mtg-jp23`'s `anyCreatureHasCounter` is the one `Condition` member
   * `conditionParams` (`ability-script.ts`) refuses rather than translates:
   * Forge's `ConditionPresent$`/`ConditionCheckSVar$` grammar for "any
   * permanent anywhere has counter X" is unverified here, so this follows
   * `UNMAPPED_TARGET_RESTRICTION`'s precedent (`target-restrictions.test.ts`)
   * of refusing by name over guessing at syntax nobody has run through Forge.
   */
  it('refuses a static conditioned on anyCreatureHasCounter rather than guessing at Forge syntax', () => {
    const card = creature('Blight Counter Probe', {
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 1 },
          enabledWhile: { kind: 'anyCreatureHasCounter', counter: 'gloom' },
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((reason) => reason.code)).toContain('UNMAPPED_EFFECT_KIND');
  });

  /**
   * `mtg-nhyv.28`'s `opponentGraveyardAtLeast` is refused on the same
   * precedent and for a sharper reason: every `ConditionPresent$` filter this
   * transpiler writes names permanents on a battlefield, and a graveyard count
   * needs a zone qualifier no card in the corpus this package was built from
   * demonstrates. A guess would transpile clean and count the wrong pile.
   */
  it('refuses a static conditioned on a graveyard count rather than guessing at a zone qualifier', () => {
    const card = creature('Graveyard Threshold Probe', {
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'statBonus', power: 4, toughness: 4 },
          enabledWhile: { kind: 'opponentGraveyardAtLeast', atLeast: 10 },
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((reason) => reason.code)).toContain('UNMAPPED_EFFECT_KIND');
  });

  it('writes a keyword-granting anthem on a noncreature artifact', () => {
    const card = creature('Banner of the Goddess', {
      kind: 'artifact',
      colors: [],
      manaCost: { generic: 3 },
      power: undefined,
      toughness: undefined,
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'grantKeyword', keyword: 'firstStrike' },
        },
      ],
    });
    expect(mustTranspile(card)).toContain(
      'S:Mode$ Continuous | Affected$ Creature.YouCtrl | AddKeyword$ First Strike | Description$ Creatures you control have first strike.\n',
    );
  });

  /**
   * `AddKeyword$` takes indestructible from the same enum it takes first strike
   * from, so the transpiler needed one row rather than a second code path
   * (`mtg-nhyv.74`). The row is in `FORGE_GRANTABLE_KEYWORDS`, not
   * `FORGE_KEYWORDS`, because the nine-member map is what the printed `K:` line
   * reads and a printed indestructible is already spelled by
   * `FORGE_KEYWORD_ABILITIES`; widening the printed map would have given one
   * word two spellings on one card.
   */
  it('grants indestructible to a subtype the way it grants an evergreen keyword', () => {
    const card = creature('Exemplar of the Order', {
      subtypes: ['Knight'],
      abilities: [
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Knight',
          modification: { kind: 'grantKeyword', keyword: 'indestructible' },
        },
      ],
    });
    const statics = mustTranspile(card)
      .split('\n')
      .filter((line) => line.startsWith('S:'));
    expect(statics).toEqual([
      'S:Mode$ Continuous | Affected$ Creature.Other+YouCtrl+Knight | AddKeyword$ Indestructible | Description$ Other Knight creatures you control have indestructible.',
    ]);
  });

  it('writes a self-scoped static against the source card', () => {
    const card = creature('Standard Bearer', {
      abilities: [
        {
          kind: 'static',
          scope: 'self',
          subtype: null,
          modification: { kind: 'statBonus', power: 2, toughness: -1 },
        },
      ],
    });
    expect(mustTranspile(card)).toContain(
      'S:Mode$ Continuous | Affected$ Card.Self | AddPower$ +2 | AddToughness$ -1 | Description$ CARDNAME gets +2/-1.\n',
    );
  });

  it('emits one S: line per printed ability, in card order', () => {
    const card = creature('Vantian Marshal', {
      subtypes: ['Soldier'],
      abilities: [
        {
          kind: 'static',
          scope: 'creaturesYouControl',
          subtype: null,
          modification: { kind: 'statBonus', power: 1, toughness: 0 },
        },
        {
          kind: 'static',
          scope: 'otherCreaturesYouControl',
          subtype: 'Soldier',
          modification: { kind: 'grantKeyword', keyword: 'vigilance' },
        },
      ],
    });
    const statics = mustTranspile(card)
      .split('\n')
      .filter((line) => line.startsWith('S:'));
    expect(statics.length).toBe(2);
    expect(statics[0]).toContain('AddPower$ +1');
    expect(statics[1]).toContain('AddKeyword$ Vigilance');
  });
});

describe('spell effect scripts', () => {
  it('dealDamage', () => {
    expect(
      mustTranspile(
        spell('Damage Probe', [{ kind: 'dealDamage', amount: 3, target: { kind: 'anyTarget' } }]),
      ),
    ).toContain(
      'A:SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to any target.\n',
    );
  });

  it('dealDamage at a creature and at a player', () => {
    expect(
      mustTranspile(
        spell('Creature Burn', [{ kind: 'dealDamage', amount: 2, target: { kind: 'targetCreature' } }]),
      ),
    ).toContain('A:SP$ DealDamage | ValidTgts$ Creature | NumDmg$ 2 |');
    expect(
      mustTranspile(
        spell('Player Burn', [{ kind: 'dealDamage', amount: 5, target: { kind: 'targetPlayer' } }]),
      ),
    ).toContain('A:SP$ DealDamage | ValidTgts$ Player | NumDmg$ 5 |');
  });

  it('destroyPermanent', () => {
    expect(
      mustTranspile(
        spell('Destroy Probe', [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }]),
      ),
    ).toContain('A:SP$ Destroy | ValidTgts$ Creature | SpellDescription$ Destroy target creature.\n');
  });

  it('pumpUntilEndOfTurn keeps signed deltas', () => {
    expect(
      mustTranspile(
        spell('Pump Probe', [
          { kind: 'pumpUntilEndOfTurn', power: 3, toughness: -1, target: { kind: 'targetCreature' } },
        ]),
      ),
    ).toContain('A:SP$ Pump | ValidTgts$ Creature | NumAtt$ +3 | NumDef$ -1 |');
  });

  /**
   * Forge's own `Pump` API carries `KW$` beside `NumAtt$`/`NumDef$` on one
   * line, which is the parity argument for making the rider a field on the
   * pump rather than a second effect: the shape our vocabulary needed is the
   * shape the oracle engine already had. Two effects would transpile to two
   * `SP$ Pump` lines with two `ValidTgts$` selectors, and that is Magic's other
   * template, not Mighty Leap's.
   */
  it('pumpUntilEndOfTurn carries a keyword rider on the same line', () => {
    expect(
      mustTranspile(
        spell('Leap Probe', [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 2,
            toughness: 2,
            keyword: 'flying',
            target: { kind: 'targetCreature' },
          },
        ]),
      ),
    ).toContain('A:SP$ Pump | ValidTgts$ Creature | NumAtt$ +2 | NumDef$ +2 | KW$ Flying |');
    // The two-word keyword, spelled by `FORGE_KEYWORDS` rather than here.
    expect(
      mustTranspile(
        spell('Strike Probe', [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 2,
            toughness: 0,
            keyword: 'firstStrike',
            target: { kind: 'targetCreature' },
          },
        ]),
      ),
    ).toContain('A:SP$ Pump | ValidTgts$ Creature | NumAtt$ +2 | NumDef$ +0 | KW$ First Strike |');
  });

  it('drawCards for you and for a target player', () => {
    expect(
      mustTranspile(spell('Draw Probe', [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }])),
    ).toContain('A:SP$ Draw | Defined$ You | NumCards$ 2 | SpellDescription$ Draw two cards.\n');
    expect(
      mustTranspile(spell('Gift Draw', [{ kind: 'drawCards', count: 1, target: { kind: 'targetPlayer' } }])),
    ).toContain('A:SP$ Draw | ValidTgts$ Player | NumCards$ 1 |');
  });

  it('gainLife', () => {
    expect(
      mustTranspile(spell('Life Probe', [{ kind: 'gainLife', amount: 4, target: { kind: 'noTarget' } }])),
    ).toContain('A:SP$ GainLife | Defined$ You | LifeAmount$ 4 | SpellDescription$ You gain 4 life.\n');
  });

  it('counterSpell targets a spell on the stack', () => {
    expect(mustTranspile(spell('Counter Probe', [{ kind: 'counterSpell' }]))).toContain(
      'A:SP$ Counter | TargetType$ Spell | ValidTgts$ Card | TgtPrompt$ Select target spell | SpellDescription$ Counter target spell.\n',
    );
  });

  it('createToken references a token script and hints the deck AI', () => {
    const text = mustTranspile(
      spell('Token Probe', [
        {
          kind: 'createToken',
          count: 2,
          token: { name: 'Bear', power: 2, toughness: 2, colors: ['R'], subtypes: ['Bear'] },
        },
      ]),
    );
    expect(text).toContain(
      'A:SP$ Token | TokenAmount$ 2 | TokenScript$ r_2_2_bear | TokenOwner$ You | SpellDescription$ Create two 2/2 red Bear creature tokens.\n',
    );
    expect(text).toContain('DeckHas:Ability$Token\n');
  });

  it('tapPermanent', () => {
    expect(
      mustTranspile(spell('Tap Probe', [{ kind: 'tapPermanent', target: { kind: 'targetCreature' } }])),
    ).toContain('A:SP$ Tap | ValidTgts$ Creature | SpellDescription$ Tap target creature.\n');
  });

  it('returnToHand becomes a ChangeZone', () => {
    expect(
      mustTranspile(spell('Bounce Probe', [{ kind: 'returnToHand', target: { kind: 'targetCreature' } }])),
    ).toContain(
      "A:SP$ ChangeZone | ValidTgts$ Creature | Origin$ Battlefield | Destination$ Hand | SpellDescription$ Return target creature to its owner's hand.\n",
    );
  });

  it('millCards', () => {
    expect(
      mustTranspile(spell('Mill Probe', [{ kind: 'millCards', count: 4, target: { kind: 'targetPlayer' } }])),
    ).toContain(
      'A:SP$ Mill | ValidTgts$ Player | NumCards$ 4 | SpellDescription$ Target player mills four cards.\n',
    );
  });
});

describe('multi-effect spells', () => {
  it('chains sub-abilities and prints the whole text once, on the primary line', () => {
    const card = spell('Chain Probe', [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
      { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      { kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } },
    ]);
    expect(mustTranspile(card)).toBe(
      [
        'Name:Chain Probe',
        'ManaCost:1 R',
        'Types:Instant',
        'A:SP$ Destroy | ValidTgts$ Creature | SubAbility$ DBEffect1 | SpellDescription$ Destroy target creature. Draw a card. You gain 2 life.',
        'SVar:DBEffect1:DB$ Draw | Defined$ You | NumCards$ 1 | SubAbility$ DBEffect2',
        'SVar:DBEffect2:DB$ GainLife | Defined$ You | LifeAmount$ 2',
        'DeckHas:Ability$LifeGain',
        'Oracle:Destroy target creature. Draw a card. You gain 2 life.',
        '',
      ].join('\n'),
    );
  });

  it('marks a distinct slot with TargetUnique, which is Forge for "another target"', () => {
    // Forge collects the targets already chosen across a spell's sub-ability
    // chain and excludes them from a TargetUnique$ True slot, which is the same
    // rule `honoursDistinctSlots` enforces in the kernel. Without the flag the
    // exported card would let Forge aim both Destroys at one creature while our
    // own engine refused to, and the parity oracle would report a difference we
    // put there ourselves.
    const card = spell('Twin Probe', [
      { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
      { kind: 'destroyPermanent', target: { kind: 'targetCreature', distinct: true } },
    ]);
    expect(mustTranspile(card)).toBe(
      [
        'Name:Twin Probe',
        'ManaCost:1 R',
        'Types:Instant',
        'A:SP$ Destroy | ValidTgts$ Creature | SubAbility$ DBEffect1 | SpellDescription$ Destroy target creature. Destroy another target creature.',
        'SVar:DBEffect1:DB$ Destroy | ValidTgts$ Creature | TargetUnique$ True',
        'Oracle:Destroy target creature. Destroy another target creature.',
        '',
      ].join('\n'),
    );
  });
});

describe('lands and artifacts', () => {
  it('does not re-script a basic land Forge already ships', () => {
    const mountain = parseCard({
      kind: 'land',
      id: 'tst-mountain',
      name: 'Mountain',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 900 },
      supertypes: ['basic'],
      basicLandType: 'Mountain',
      producesMana: ['R'],
    });
    const result = transpileCard(mountain);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.stock).toBe(true);
    expect(result.script.fileName).toBe('');
  });

  it('scripts a custom-named basic land', () => {
    const custom = parseCard({
      kind: 'land',
      id: 'tst-ashen-waste',
      name: 'Ashen Waste',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 901 },
      supertypes: ['basic'],
      basicLandType: 'Mountain',
      producesMana: ['R'],
    });
    const result = transpileCard(custom);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.script.stock).toBe(false);
    expect(result.script.fileName).toBe('ashen_waste.txt');
    expect(result.script.text).toBe(
      ['Name:Ashen Waste', 'ManaCost:no cost', 'Types:Basic Land Mountain', 'Oracle:{T}: Add {R}.', ''].join(
        '\n',
      ),
    );
  });

  it('scripts a noncreature artifact', () => {
    const artifact = parseCard({
      kind: 'artifact',
      id: 'tst-bronze-monument',
      name: 'Bronze Monument',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 902 },
      manaCost: { generic: 2 },
    });
    expect(mustTranspile(artifact)).toBe(
      ['Name:Bronze Monument', 'ManaCost:2', 'Types:Artifact', 'Oracle:', ''].join('\n'),
    );
  });
});

describe('token scripts', () => {
  it('matches the shipped token-script shape', () => {
    expect(
      transpileTokenScript({
        name: 'Knight',
        power: 2,
        toughness: 2,
        colors: ['W'],
        subtypes: ['Knight'],
        keywords: ['vigilance'],
      }),
    ).toBe(
      [
        'Name:Knight Token',
        'ManaCost:no cost',
        'Colors:white',
        'Types:Creature Knight',
        'PT:2/2',
        'K:Vigilance',
        'Oracle:Vigilance',
        '',
      ].join('\n'),
    );
  });

  it('lists multiple colors in WUBRG order', () => {
    expect(
      transpileTokenScript({
        name: 'Elf',
        power: 2,
        toughness: 2,
        colors: ['G', 'B'],
        subtypes: ['Elf'],
        keywords: [],
      }),
    ).toContain('Colors:black,green\n');
  });
});
