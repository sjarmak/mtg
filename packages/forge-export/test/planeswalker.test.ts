/**
 * Planeswalkers compile: a `Loyalty:` line and one `A:AB$` per loyalty ability.
 *
 * The expectations are read off Forge 2.0.14's `res/cardsfolder`, the same
 * authority the enchantment mapping uses and for the same reason — there is no
 * booted Forge here to check against (`mtg-17a`).
 *
 * Two things about a loyalty ability are not an ordinary activation. The cost
 * is a counter payment rather than mana, and Forge writes the `[+1]:` symbol
 * itself from that cost, so the `SpellDescription$` carries the sentence
 * without it. Both are asserted below, because getting the second wrong prints
 * the symbol on the card twice and still boots.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { forgeTokenScriptName, transpileCardScript, transpileTokenScript } from '@mtg/forge-export';

function walker(overrides: Partial<CardInput> = {}): Card {
  return parseCard({
    kind: 'planeswalker',
    id: 'tst-ajani',
    name: 'Ajani Goldmane',
    rarity: 'mythic',
    set: { code: 'TST', collectorNumber: 1 },
    manaCost: { generic: 2, W: 2 },
    colors: ['W'],
    supertypes: ['legendary'],
    subtypes: ['Ajani'],
    startingLoyalty: 4,
    abilities: [
      {
        kind: 'activated',
        loyaltyCost: 1,
        cost: { mana: {} },
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        loyaltyCost: 0,
        cost: { mana: {} },
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
      {
        kind: 'activated',
        loyaltyCost: -6,
        cost: { mana: {} },
        effects: [{ kind: 'createToken', count: 1, token: { name: 'Cat', power: 2, toughness: 2 } }],
      },
    ],
    ...overrides,
  } as CardInput);
}

function scriptOf(card: Card): readonly string[] {
  const result = transpileCardScript(card);
  if (!result.ok) throw new Error(`expected a script, got ${JSON.stringify(result.rejections)}`);
  return result.value.lines;
}

describe('planeswalker card scripts', () => {
  it('writes starting loyalty as its own line, never a PT', () => {
    const lines = scriptOf(walker());
    expect(lines).toContain('Types:Legendary Planeswalker Ajani');
    expect(lines).toContain('Loyalty:4');
    expect(lines.some((line) => line.startsWith('PT:'))).toBe(false);
  });

  it('pays a plus ability with AddCounter and a minus ability with SubCounter', () => {
    const activations = scriptOf(walker()).filter((line) => line.startsWith('A:'));
    expect(activations[0]).toContain('Cost$ AddCounter<1/LOYALTY>');
    expect(activations[2]).toContain('Cost$ SubCounter<6/LOYALTY>');
  });

  it('pays a zero ability with AddCounter<0>, which is the form 53 shipped scripts use', () => {
    // Five ship `SubCounter<0/LOYALTY>` instead. Both are legal and one had to
    // be chosen; this is the majority spelling.
    expect(scriptOf(walker()).filter((line) => line.startsWith('A:'))[1]).toContain(
      'Cost$ AddCounter<0/LOYALTY>',
    );
  });

  it('marks every loyalty ability Planeswalker$ True', () => {
    // Universal in the corpus: 991 of 998 loyalty-cost lines write it exactly
    // this way and the remaining seven write the same word in lower case.
    const activations = scriptOf(walker()).filter((line) => line.startsWith('A:'));
    expect(activations).toHaveLength(3);
    for (const line of activations) expect(line).toContain('Planeswalker$ True');
  });

  it('leaves the loyalty symbol off SpellDescription, because Forge writes it', () => {
    const activations = scriptOf(walker()).filter((line) => line.startsWith('A:'));
    expect(activations[0]).toContain('SpellDescription$ You gain 2 life.');
    for (const line of activations) expect(line).not.toContain('SpellDescription$ [');
  });

  it('keeps the printed symbol on the Oracle line, where the card face reads it', () => {
    const oracle = scriptOf(walker()).find((line) => line.startsWith('Oracle:'));
    expect(oracle).toContain('[+1]: You gain 2 life.');
    expect(oracle).toContain('[0]: Draw a card.');
  });

  it('carries no mana in the cost, because a loyalty ability pays only loyalty', () => {
    // `checkActivatedAbility` refuses a loyalty ability that also costs mana,
    // taps or sacrifices, so the counter payment is the whole `Cost$` and a
    // stray `2 W` here would mean that rule stopped holding.
    for (const line of scriptOf(walker()).filter((line) => line.startsWith('A:'))) {
      expect(line).toMatch(/Cost\$ (Add|Sub)Counter<\d+\/LOYALTY> \|/);
    }
  });

  it('exports a persistent emblem and its granted Swamp mana ability', () => {
    const lines = scriptOf(
      walker({
        id: 'm13-liliana-dark-realms-emblem-probe',
        name: 'Liliana of the Dark Realms',
        colors: ['B'],
        manaCost: { generic: 2, B: 2 },
        subtypes: ['Liliana'],
        startingLoyalty: 3,
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: -6,
            cost: { mana: {} },
            effects: [
              {
                kind: 'createEmblem',
                emblem: {
                  name: 'Liliana of the Dark Realms Emblem',
                  grantsManaAbility: {
                    filter: { cardTypes: ['land'], subtypes: ['Swamp'] },
                    produces: ['B'],
                    amount: 4,
                  },
                },
              },
            ],
          },
        ],
      }),
    );

    expect(lines.find((line) => line.startsWith('A:'))).toContain('AB$ Effect | Cost$ SubCounter<6/LOYALTY>');
    expect(lines).toContainEqual(
      expect.stringContaining(
        'Mode$ Continuous | Affected$ Swamp.YouCtrl | AffectedZone$ Battlefield | AddAbility$',
      ),
    );
    expect(lines).toContainEqual(expect.stringContaining('AB$ Mana | Cost$ T | Produced$ B | Amount$ 4'));
  });

  it('matches Forge master for Ajani Goldmane and its life-linked Avatar token', () => {
    const avatar = {
      identity: 'avatar-life-total',
      name: 'Avatar',
      power: 0,
      toughness: 0,
      characteristicPowerToughness: { kind: 'controllerLifeTotal' as const },
      colors: ['W' as const],
      subtypes: ['Avatar'],
      keywords: [],
    };
    const lines = scriptOf(
      walker({
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: 1,
            cost: { mana: {} },
            effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
          },
          {
            kind: 'activated',
            loyaltyCost: -1,
            cost: { mana: {} },
            effects: [
              {
                kind: 'putCounters',
                counter: 'plusOnePlusOne',
                count: 1,
                keyword: 'vigilance',
                target: { kind: 'noTarget' },
                scope: 'permanentsYouControl',
                scopeFilter: { cardTypes: ['creature'] },
              },
            ],
          },
          {
            kind: 'activated',
            loyaltyCost: -6,
            cost: { mana: {} },
            effects: [{ kind: 'createToken', count: 1, token: avatar }],
          },
        ],
      }),
    );
    expect(lines).toStrictEqual([
      'Name:Ajani Goldmane',
      'ManaCost:2 W W',
      'Types:Legendary Planeswalker Ajani',
      'Loyalty:4',
      'A:AB$ GainLife | Cost$ AddCounter<1/LOYALTY> | LifeAmount$ 2 | Planeswalker$ True | SpellDescription$ You gain 2 life.',
      'A:AB$ PutCounterAll | Cost$ SubCounter<1/LOYALTY> | ValidCards$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ 1 | Planeswalker$ True | SubAbility$ DBPumpAll | SpellDescription$ Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.',
      'SVar:DBPumpAll:DB$ PumpAll | ValidCards$ Creature.YouCtrl | KW$ Vigilance',
      'A:AB$ Token | Cost$ SubCounter<6/LOYALTY> | TokenScript$ w_x_x_avatar_life_total | TokenOwner$ You | Planeswalker$ True | Ultimate$ True | SpellDescription$ Create a white Avatar creature token. It has "This token\'s power and toughness are each equal to your life total."',
      // Ours, not Forge master's: the shipped `ajani_goldmane.txt` carries no
      // `DeckHas`, as no M11 or M13 script does, and this transpiler emits the
      // hint its effect table implies for every card kind (`mtg-9xz4`). The
      // rules-bearing lines above are the parity claim.
      'DeckHas:Ability$LifeGain|Token',
      'Oracle:[+1]: You gain 2 life.\\n[-1]: Put a +1/+1 counter on each creature you control. Those creatures gain vigilance until end of turn.\\n[-6]: Create a white Avatar creature token. It has "This token\'s power and toughness are each equal to your life total."',
    ]);
    expect(forgeTokenScriptName(avatar)).toBe('w_x_x_avatar_life_total');
    expect(transpileTokenScript(avatar)).toBe(
      [
        'Name:Avatar Token',
        'ManaCost:no cost',
        'Colors:white',
        'Types:Creature Avatar',
        'PT:*/*',
        "S:Mode$ Continuous | SetPower$ X | SetToughness$ X | CharacteristicDefining$ True | Description$ This creature's power and toughness are each equal to your life total.",
        'SVar:X:Count$YourLifeTotal',
        "Oracle:This creature's power and toughness are each equal to your life total.",
        '',
      ].join('\n'),
    );
  });

  it('preserves Garruk Wildspeaker target cardinality and controller-scoped ultimate', () => {
    // Forge master writes the first ability with TargetMin/TargetMax 2 and the
    // ultimate as one PumpAll. The DSL's exact native forms are two mandatory
    // target slots (the second TargetUnique) and two chained layer effects;
    // neither chain admits a choice or priority window between its members, so
    // the exported behavior is the same while retaining the kernel's own
    // effect vocabulary.
    const lines = scriptOf(
      walker({
        id: 'm11-garruk-wildspeaker',
        name: 'Garruk Wildspeaker',
        colors: ['G'],
        manaCost: { generic: 2, G: 2 },
        subtypes: ['Garruk'],
        startingLoyalty: 3,
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: 1,
            cost: { mana: {} },
            effects: [
              {
                kind: 'untapPermanent',
                target: { kind: 'targetPermanent', filter: { cardTypes: ['land'] } },
              },
              {
                kind: 'untapPermanent',
                target: {
                  kind: 'targetPermanent',
                  filter: { cardTypes: ['land'] },
                  distinct: true,
                },
              },
            ],
          },
          {
            kind: 'activated',
            loyaltyCost: -1,
            cost: { mana: {} },
            effects: [
              {
                kind: 'createToken',
                count: 1,
                token: {
                  name: 'Beast',
                  power: 3,
                  toughness: 3,
                  colors: ['G'],
                  subtypes: ['Beast'],
                  keywords: [],
                },
              },
            ],
          },
          {
            kind: 'activated',
            loyaltyCost: -4,
            cost: { mana: {} },
            effects: [
              {
                kind: 'pumpUntilEndOfTurn',
                power: 3,
                toughness: 3,
                target: { kind: 'noTarget' },
                scope: 'permanentsYouControl',
                scopeFilter: { cardTypes: ['creature'] },
              },
              {
                kind: 'grantKeywordUntilEndOfTurn',
                keyword: 'trample',
                target: { kind: 'noTarget' },
                scope: 'permanentsYouControl',
                scopeFilter: { cardTypes: ['creature'] },
              },
            ],
          },
        ],
      }),
    );
    const activations = lines.filter((line) => line.startsWith('A:'));
    expect(activations[0]).toContain(
      'AB$ Untap | Cost$ AddCounter<1/LOYALTY> | ValidTgts$ Land | Planeswalker$ True',
    );
    expect(activations[0]).toContain('SubAbility$');
    const secondUntap = lines.find((line) => line.includes('DB$ Untap'));
    expect(secondUntap).toContain('ValidTgts$ Land');
    expect(secondUntap).toContain('TargetUnique$ True');
    expect(activations[2]).toContain(
      'AB$ PumpAll | Cost$ SubCounter<4/LOYALTY> | ValidCards$ Creature.YouCtrl',
    );
    expect(activations[2]).toContain('NumAtt$ +3 | NumDef$ +3');
    const trample = lines.find((line) => line.includes('DB$ PumpAll'));
    expect(trample).toContain('ValidCards$ Creature.YouCtrl');
    expect(trample).toContain('KW$ Trample');
  });

  it('matches Forge master for Liliana Vess choices, tutor order, and all-graveyards control', () => {
    const lines = scriptOf(
      walker({
        id: 'm11-liliana-vess',
        name: 'Liliana Vess',
        colors: ['B'],
        manaCost: { generic: 3, B: 2 },
        subtypes: ['Liliana'],
        startingLoyalty: 5,
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: 1,
            cost: { mana: {} },
            effects: [{ kind: 'discardCards', count: 1, target: { kind: 'targetPlayer' } }],
          },
          {
            kind: 'activated',
            loyaltyCost: -2,
            cost: { mana: {} },
            effects: [{ kind: 'searchLibrary', filter: {}, destination: 'libraryTop', count: 1 }],
          },
          {
            kind: 'activated',
            loyaltyCost: -8,
            cost: { mana: {} },
            effects: [
              {
                kind: 'returnFromGraveyard',
                scope: 'creatureCardsInAllGraveyards',
                control: 'you',
                target: { kind: 'noTarget' },
              },
            ],
          },
        ],
      }),
    );
    expect(lines).toStrictEqual([
      'Name:Liliana Vess',
      'ManaCost:3 B B',
      'Types:Legendary Planeswalker Liliana',
      'Loyalty:5',
      'A:AB$ Discard | Cost$ AddCounter<1/LOYALTY> | ValidTgts$ Player | NumCards$ 1 | Mode$ TgtChoose | Planeswalker$ True | SpellDescription$ Target player discards a card.',
      'A:AB$ ChangeZone | Cost$ SubCounter<2/LOYALTY> | Origin$ Library | Destination$ Library | LibraryPosition$ 0 | ChangeType$ Card | ChangeNum$ 1 | Mandatory$ True | Planeswalker$ True | SpellDescription$ Search your library for a card, then shuffle and put that card on top.',
      'A:AB$ ChangeZoneAll | Cost$ SubCounter<8/LOYALTY> | ChangeType$ Creature | Origin$ Graveyard | Destination$ Battlefield | GainControl$ True | Planeswalker$ True | Ultimate$ True | SpellDescription$ Put all creature cards from all graveyards onto the battlefield under your control.',
      'Oracle:[+1]: Target player discards a card.\\n[-2]: Search your library for a card, then shuffle and put that card on top.\\n[-8]: Put all creature cards from all graveyards onto the battlefield under your control.',
    ]);
  });

  it('matches Forge master for Chandra Nalaar variable loyalty and linked ultimate', () => {
    const lines = scriptOf(
      walker({
        id: 'm11-chandra-nalaar',
        name: 'Chandra Nalaar',
        colors: ['R'],
        manaCost: { generic: 3, R: 2 },
        subtypes: ['Chandra'],
        startingLoyalty: 6,
        abilities: [
          {
            kind: 'activated',
            loyaltyCost: 1,
            cost: { mana: {} },
            effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'targetPlayerOrPlaneswalker' } }],
          },
          {
            kind: 'activated',
            loyaltyCost: { kind: 'removeChosenX' },
            cost: { mana: {} },
            effects: [
              {
                kind: 'dealDamage',
                amount: { kind: 'chosenX' },
                target: { kind: 'targetCreature' },
              },
            ],
          },
          {
            kind: 'activated',
            loyaltyCost: -8,
            cost: { mana: {} },
            effects: [
              {
                kind: 'dealDamage',
                amount: 10,
                target: { kind: 'targetPlayerOrPlaneswalker' },
                scope: 'targetAndPermanentsItsPlayerControls',
                scopeFilter: { cardTypes: ['creature'] },
              },
            ],
          },
        ],
      }),
    );
    expect(lines).toStrictEqual([
      'Name:Chandra Nalaar',
      'ManaCost:3 R R',
      'Types:Legendary Planeswalker Chandra',
      'Loyalty:6',
      'A:AB$ DealDamage | Cost$ AddCounter<1/LOYALTY> | ValidTgts$ Player,Planeswalker | TgtPrompt$ Select target player or planeswalker | NumDmg$ 1 | Planeswalker$ True | SpellDescription$ CARDNAME deals 1 damage to target player or planeswalker.',
      'A:AB$ DealDamage | Cost$ SubCounter<X/LOYALTY> | ValidTgts$ Creature | NumDmg$ X | Planeswalker$ True | SpellDescription$ CARDNAME deals X damage to target creature.',
      'SVar:X:Count$xPaid',
      "A:AB$ DealDamage | Cost$ SubCounter<8/LOYALTY> | ValidTgts$ Player,Planeswalker | TgtPrompt$ Select a player or planeswalker | NumDmg$ 10 | Planeswalker$ True | Ultimate$ True | SubAbility$ DmgAll | DamageMap$ True | SpellDescription$ CARDNAME deals 10 damage to target player or planeswalker and each creature that player or that planeswalker's controller controls.",
      'SVar:DmgAll:DB$ DamageAll | NumDmg$ 10 | ValidCards$ Creature.ControlledBy TargetedOrController | SubAbility$ DBDamageResolve',
      'SVar:DBDamageResolve:DB$ DamageResolve',
      "Oracle:[+1]: Chandra Nalaar deals 1 damage to target player or planeswalker.\\n[-X]: Chandra Nalaar deals X damage to target creature.\\n[-8]: Chandra Nalaar deals 10 damage to target player or planeswalker and each creature that player or that planeswalker's controller controls.",
    ]);
  });
});
