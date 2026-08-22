/**
 * The co-design conformance tests.
 *
 * These are the tests that actually enforce "the generator's output space
 * equals the engine's enforceable space" at the Forge boundary: every pinned
 * vocabulary entry must have a mapping, and the transpiler's own view of what
 * is legal must not drift from the DSL's.
 */
import { describe, expect, it } from 'vitest';
import type {
  Ability,
  ActivationCost,
  CounterKind,
  EffectKind,
  StaticAbility,
  TriggerCondition,
} from '@mtg/dsl';
import {
  ABILITY_KINDS,
  COUNTER_DECLARATIONS,
  COUNTER_KINDS,
  ALL_EFFECT_KINDS,
  EFFECT_KINDS,
  EXAMPLE_SET,
  KEYWORDS,
  legalTargetsFor,
  mana,
  MODEL_TRIGGER_CONDITIONS,
  parseCard,
  renderOracleText,
  RARITIES,
  STATIC_MODIFICATION_KINDS,
  STATIC_SCOPES,
  TARGET_KINDS,
} from '@mtg/dsl';
import {
  FORGE_COUNTER_TYPES,
  FORGE_EFFECTS,
  FORGE_KEYWORDS,
  FORGE_RARITY_CODES,
  FORGE_STATIC_AFFECTED,
  FORGE_VALID_TARGETS,
  transpileAbility,
  transpileCard,
  transpileSet,
} from '@mtg/forge-export';

describe('vocabulary coverage', () => {
  it('rejects a targeted imitation of exalted at the public ability seam', () => {
    const result = transpileAbility(
      {
        kind: 'triggered',
        condition: 'controlledCreatureAttacksAlone',
        effects: [
          {
            kind: 'pumpUntilEndOfTurn',
            power: 1,
            toughness: 1,
            target: { kind: 'targetCreature' },
          },
        ],
      },
      0,
      'tst-hostile-exalted',
      'abilities[0]',
    );

    expect(result).toEqual({
      ok: false,
      rejections: [
        expect.objectContaining({
          cardId: 'tst-hostile-exalted',
          path: 'abilities[0]',
          message: expect.stringMatching(/reserved.*canonical.*exalted/iu),
        }),
      ],
    });
  });

  it('maps every evergreen keyword to a Forge K: name', () => {
    expect(Object.keys(FORGE_KEYWORDS).sort()).toEqual([...KEYWORDS].sort());
    for (const keyword of KEYWORDS) {
      expect(FORGE_KEYWORDS[keyword].length).toBeGreaterThan(0);
    }
  });

  it('maps every effect primitive to a Forge effect API', () => {
    expect(Object.keys(FORGE_EFFECTS).sort()).toEqual([...ALL_EFFECT_KINDS].sort());
    for (const kind of ALL_EFFECT_KINDS) {
      expect(FORGE_EFFECTS[kind].api.length, kind).toBeGreaterThan(0);
    }
  });

  it('maps every targeting mode', () => {
    expect(Object.keys(FORGE_VALID_TARGETS).sort()).toEqual([...TARGET_KINDS].sort());
  });

  it('maps every rarity to an edition-file code', () => {
    expect(Object.keys(FORGE_RARITY_CODES).sort()).toEqual([...RARITIES].sort());
  });

  it('maps every static scope to a Forge Affected$ restriction', () => {
    expect(Object.keys(FORGE_STATIC_AFFECTED).sort()).toEqual([...STATIC_SCOPES].sort());
    for (const scope of STATIC_SCOPES) {
      expect(FORGE_STATIC_AFFECTED[scope].length).toBeGreaterThan(0);
    }
  });

  /**
   * The counter half of the drift alarm, and the one that stops the parts
   * economy exporting a lie.
   *
   * A counter kind's meaning is `COUNTER_DECLARATIONS`, and the Forge entry
   * beside it is a second table rather than a derivation, for the reason
   * `ForgeEffectMapping.targets` gives: a hand-written line a reader can check
   * against a Forge card script, with a test that fails when the two disagree.
   * So the declaration is decomposed here and compared. Change a part's
   * declared effect without changing its Forge counters and this goes red,
   * rather than exporting a token that does less in Forge than in the kernel.
   *
   * The decomposition is deliberately narrow: a stat bonus is `P1P1` or `M1M1`,
   * a granted keyword is that keyword's own Forge counter, and anything else is
   * `null`, meaning the transpiler must refuse the counter rather than guess.
   * Forge does ship `P1P0`, `P2P2` and `M0M1` (2.0.14's `res/cardsfolder`), and
   * no declaration asks for one yet.
   */
  it('maps every counter kind to the Forge counters its declaration means', () => {
    expect(Object.keys(FORGE_COUNTER_TYPES).sort()).toEqual([...COUNTER_KINDS].sort());

    const decompose = (kind: CounterKind): readonly string[] | null => {
      const forge: string[] = [];
      for (const modification of COUNTER_DECLARATIONS[kind].modifications) {
        if (modification.kind === 'grantKeyword') {
          forge.push(FORGE_KEYWORDS[modification.keyword]);
          continue;
        }
        if (modification.kind !== 'statBonus') return null;
        if (modification.power === 1 && modification.toughness === 1) forge.push('P1P1');
        else if (modification.power === -1 && modification.toughness === -1) forge.push('M1M1');
        else return null;
      }
      return forge.length === 0 ? null : forge;
    };

    for (const kind of COUNTER_KINDS) {
      const mapped = FORGE_COUNTER_TYPES[kind];
      expect(mapped === null ? null : [...mapped], `Forge counters for "${kind}"`).toEqual(decompose(kind));
    }
    // The part counter is the case the two-counter form exists for.
    expect(FORGE_COUNTER_TYPES.horn).toEqual(['P1P1', 'First Strike']);
  });

  /**
   * The ability half of the drift alarm. `transpileAbility`'s `assertNever`
   * catches a new ability *kind* at compile time; nothing catches a new static
   * modification that reaches the `S:` line with no parameters, so every
   * modification the vocabulary names is transpiled here and its output read.
   */
  it('writes a Forge line for every ability kind and static modification', () => {
    const statics: readonly StaticAbility[] = [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'statBonus', power: 1, toughness: 1 },
      },
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: null,
        modification: { kind: 'grantKeyword', keyword: 'flying' },
      },
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
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: {
          kind: 'statBonusPer',
          power: 0,
          toughness: 1,
          each: { kind: 'landsWithSubtype', subtype: 'Mountain', whose: 'you' },
        },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'doubleDamage' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'doubleLifeGain' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'cantAttack' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'cantBlock' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'cantBeBlocked' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'attacksEachCombatIfAble' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'mustBeBlockedIfAble' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'blockOnlyCreaturesWithKeyword', keyword: 'flying' },
      },
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'cantBeBlockedBySubtype', subtype: 'Wall' },
      },
    ];
    const triggers: readonly Ability[] = MODEL_TRIGGER_CONDITIONS.map((condition) => ({
      kind: 'triggered',
      condition,
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    }));
    const activations: readonly Ability[] = [
      {
        kind: 'activated',
        cost: { mana: mana({ generic: 1, R: 1 }), tapSelf: true, sacrificeSelf: false },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      },
    ];
    const samples: readonly Ability[] = [...statics, ...triggers, ...activations];
    expect([...new Set(samples.map((ability) => ability.kind))].sort()).toEqual([...ABILITY_KINDS].sort());
    expect(statics.map((ability) => ability.modification.kind).sort()).toEqual(
      [...STATIC_MODIFICATION_KINDS].sort(),
    );
    for (const ability of statics) {
      const result = transpileAbility(ability, 0, 'tst-conformance', 'abilities[0]');
      if (ability.modification.kind === 'definePt') {
        // CR 613.4a characteristic-defining P/T: `forge-export` has no Forge
        // CDA script mapping yet (`ability-script.ts`'s docblock says why),
        // and rejects with a named code instead of emitting a vanilla static.
        // This proves the rejection fires rather than asserting a mapping
        // that does not exist.
        expect(result.ok, JSON.stringify(ability)).toBe(false);
        if (!result.ok) {
          expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_CHARACTERISTIC_DEFINING_PT');
        }
        continue;
      }
      if (ability.modification.kind === 'statBonusPer') {
        // A rate times a live board count. Forge writes that as a counting
        // SVar plus `AddPower$ X`, which is two lines this transpiler has no
        // shape for, so it rejects by name rather than emitting the printed
        // rate as a flat bonus — which would export a creature that is +0/+1
        // whatever the board holds.
        expect(result.ok, JSON.stringify(ability)).toBe(false);
        if (!result.ok) {
          expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_EFFECT_KIND');
        }
        continue;
      }
      if (ability.modification.kind === 'doubleDamage' || ability.modification.kind === 'doubleLifeGain') {
        // CR 614 replacement, not a CR 613 static. Forge writes both as `R:`
        // lines and this transpiler emits only `S:` lines, so the refusal is
        // the mapping (`ability-script.ts`'s docblock says why). Read the same
        // way as the CDA above: prove the rejection fires rather than assert a
        // spelling nobody has written.
        expect(result.ok, JSON.stringify(ability)).toBe(false);
        if (!result.ok) {
          expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_EFFECT_KIND');
        }
        continue;
      }
      if (
        ability.modification.kind === 'cantAttack' ||
        ability.modification.kind === 'cantBlock' ||
        ability.modification.kind === 'cantBeBlocked' ||
        ability.modification.kind === 'attacksEachCombatIfAble' ||
        ability.modification.kind === 'mustBeBlockedIfAble' ||
        ability.modification.kind === 'blockOnlyCreaturesWithKeyword' ||
        ability.modification.kind === 'cantBeBlockedBySubtype'
      ) {
        // CR 508/509 combat restrictions and requirements, printed on a plain
        // static rather than an Aura. `mtg-t3ik` generalized the kernel's
        // legality checks (`combat.ts`'s `hasCombatModification`) to read any
        // battlefield source's printed statics, not only an Aura's, but this
        // transpiler's `S:Mode$ Continuous | Affected$ …` shape has no slot for
        // a combat restriction: `aura-script.ts` already writes
        // `cantAttack`/`cantBlock`/`cantBeBlocked` for an *Aura* onto Forge's
        // separate `Mode$ CantAttack`/`CantBlock`/`CantBlockBy` grammar, and a
        // second transpiler that reaches the same grammar from a plain static
        // — plus a Forge grammar for the three requirements/restrictions that
        // have no worked Aura example at all — is scope this bead did not take
        // on (`ability-script.ts`'s `modificationParams` docblock says the
        // same). Read the same way as the two refusals above: prove the
        // rejection fires by name rather than assert a Forge line nobody has
        // written.
        expect(result.ok, JSON.stringify(ability)).toBe(false);
        if (!result.ok) {
          expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_EFFECT_KIND');
        }
        continue;
      }
      expect(result.ok, JSON.stringify(ability)).toBe(true);
      if (!result.ok) continue;
      const line = result.value.lines[0] ?? '';
      expect(line.startsWith('S:Mode$ Continuous')).toBe(true);
      expect(line).toContain('Affected$');
      expect(line).toContain('Description$');
    }
    for (const [index, ability] of triggers.entries()) {
      const result = transpileAbility(ability, index, 'tst-conformance', `abilities[${index}]`);
      expect(result.ok, JSON.stringify(ability)).toBe(true);
      if (!result.ok) continue;
      const [trigger, sub] = result.value.lines;
      expect(trigger).toContain('T:Mode$');
      expect(trigger).toContain('ValidCard$ Card.Self');
      expect(trigger).toContain(`Execute$ Trig${index + 1}Effect1`);
      expect(trigger).toContain('TriggerDescription$ ');
      expect(sub).toBe(`SVar:Trig${index + 1}Effect1:DB$ GainLife | Defined$ You | LifeAmount$ 2`);
    }
    for (const ability of activations) {
      const result = transpileAbility(ability, 0, 'tst-conformance', 'abilities[0]');
      expect(result.ok, JSON.stringify(ability)).toBe(true);
      if (!result.ok) continue;
      const line = result.value.lines[0] ?? '';
      expect(line.startsWith('A:AB$ ')).toBe(true);
      expect(line).toContain('Cost$ ');
      expect(line).toContain('SpellDescription$ ');
    }
  });

  /**
   * What the `A:` line actually says, clause by clause.
   *
   * The test above proves an `A:AB$` line exists and carries a cost; it reads
   * nothing that distinguishes `{1}{R}, {T}` from `{4}`, so a cost builder that
   * dropped the pips, the tap symbol or the sacrifice passed it. Forge is the
   * parity oracle:
   * a card exported with the wrong activation cost is an oracle that agrees
   * with the kernel about a card neither of them is playing, and this package's
   * failures are silent by construction — the suite is green while the file on
   * disk is wrong. So the line is parsed and read.
   */
  it('writes the activation cost in Forge order: generic, pips, tap symbol, sacrifice', () => {
    const cases: ReadonlyArray<readonly [ActivationCost, string]> = [
      [{ mana: mana({ generic: 1, R: 1 }), tapSelf: true, sacrificeSelf: false }, '1 R T'],
      [{ mana: mana({ generic: 2 }), tapSelf: false, sacrificeSelf: false }, '2'],
      [{ mana: mana(), tapSelf: true, sacrificeSelf: false }, 'T'],
      [{ mana: mana({ W: 1, U: 1 }), tapSelf: true, sacrificeSelf: false }, 'W U T'],
      [{ mana: mana({ generic: 3, G: 2 }), tapSelf: false, sacrificeSelf: false }, '3 G G'],
      // The sacrifice goes last, after the tap symbol, and prints even when it
      // is the only thing in the cost — a sacrifice-only ability writes
      // `Sac<1/CARDNAME>`, never `0 Sac<1/CARDNAME>`.
      [{ mana: mana({ generic: 1 }), tapSelf: false, sacrificeSelf: true }, '1 Sac<1/CARDNAME>'],
      [{ mana: mana({ generic: 1, R: 1 }), tapSelf: true, sacrificeSelf: true }, '1 R T Sac<1/CARDNAME>'],
      [{ mana: mana(), tapSelf: false, sacrificeSelf: true }, 'Sac<1/CARDNAME>'],
    ];
    for (const [cost, expected] of cases) {
      const result = transpileAbility(
        {
          kind: 'activated',
          cost,
          effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
        },
        0,
        'tst-conformance',
        'abilities[0]',
      );
      expect(result.ok, expected).toBe(true);
      if (!result.ok) continue;
      const line = result.value.lines[0] ?? '';
      const pairs: Record<string, string> = {};
      for (const clause of line.slice(2).split(' | ')) {
        const [key = '', value = ''] = clause.split('$ ');
        pairs[key] = value;
      }
      expect(pairs.AB).toBe('DealDamage');
      expect(pairs.Cost, expected).toBe(expected);
      expect(pairs.ValidTgts).toBe('Any');
      expect(pairs.NumDmg).toBe('1');
    }
  });

  /**
   * A second effect hangs off `SubAbility$` and lands in its own `SVar:`, named
   * with the ability's index so two activations on one card cannot collide.
   */
  it('chains a two-effect activation through SubAbility, indexed by ability', () => {
    const ability: Ability = {
      kind: 'activated',
      cost: { mana: mana({ generic: 2 }), tapSelf: false, sacrificeSelf: false },
      effects: [
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
        { kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } },
      ],
    };
    const result = transpileAbility(ability, 1, 'tst-conformance', 'abilities[1]');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [line, sub, extra] = result.value.lines;
    // Effect 1 rides on the `A:` line itself, so the first SVar is Effect2:
    // the numbering is the ability's effect index, not the SVar's position.
    expect(line).toContain('AB$ Draw');
    expect(line).toContain('SubAbility$ Act2Effect2');
    expect(sub).toBe('SVar:Act2Effect2:DB$ GainLife | Defined$ You | LifeAmount$ 1');
    expect(extra).toBeUndefined();
    // Every name the `A:` line points at is a name the emitted lines define.
    // A reference to an SVar nobody writes is the defect slice B shipped in
    // this package, in the other direction: a dangling `TokenScript$`.
    for (const match of (line ?? '').matchAll(/SubAbility\$ (\w+)/g)) {
      const named = match[1] ?? '';
      expect(
        result.value.lines.some((emitted) => emitted.startsWith(`SVar:${named}:`)),
        `SubAbility$ ${named} has no SVar`,
      ).toBe(true);
    }
  });

  /**
   * An activation costing nothing at all is a rejection, not an empty `Cost$`.
   *
   * `checkAbilities` refuses that card first (`ABILITY_COST_INVALID`), so the
   * only way here is a caller that skipped validation — which is exactly the
   * caller a transpiler has to survive, because the alternative is a line
   * reading `Cost$ | ValidTgts$ Any` that Forge parses as something else. The
   * guard was untested: turning its condition to `false` left the whole suite
   * green, which means it was a comment with parentheses.
   */
  it('refuses an activation with no mana cost and no tap symbol', () => {
    const free = transpileAbility(
      {
        kind: 'activated',
        cost: { mana: mana(), tapSelf: false, sacrificeSelf: false },
        effects: [{ kind: 'dealDamage', amount: 1, target: { kind: 'anyTarget' } }],
      },
      0,
      'tst-free-ping',
      'abilities[0]',
    );
    expect(free.ok).toBe(false);
    if (free.ok) return;
    expect(free.rejections.map((entry) => entry.code)).toEqual(['UNSAFE_SCRIPT_TEXT']);
    expect(free.rejections[0]?.path).toBe('abilities[0].cost');
    expect(free.rejections[0]?.message).toContain('empty Cost$');
  });

  /**
   * The tap symbol alone is a cost, and it is the one case where the mana half
   * is empty and the line is still legal. `0 T` is not what Forge writes.
   */
  it('accepts a tap-only cost and never writes a zero beside it', () => {
    const result = transpileAbility(
      {
        kind: 'activated',
        cost: { mana: mana(), tapSelf: true, sacrificeSelf: false },
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
      0,
      'tst-tap-only',
      'abilities[0]',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]).toContain('Cost$ T |');
    expect(result.value.lines[0]).not.toContain('Cost$ 0');
  });

  /**
   * Which trigger each condition actually becomes in the exported card.
   *
   * The test above proves a `T:` line exists and carries `Card.Self`; it reads
   * nothing that distinguishes one condition from another, so a
   * `FORGE_TRIGGER_MODES` whose `selfDies` entry held the enters endpoints
   * passed the whole suite and shipped every dies-ability into Forge as an
   * enters-ability. Forge is the parity oracle, so a wrong trigger there is not
   * a wrong export: it is an oracle that agrees with the kernel about a card
   * neither of them is playing.
   *
   * Read off the emitted line rather than the table, because the line is what
   * Forge parses, and asserted as endpoints rather than as a copy of the table,
   * because a copy moves when the original moves.
   */
  it('writes each trigger condition as the Forge mode that means it', () => {
    const emitted = new Map<TriggerCondition, Readonly<Record<string, string>>>();
    for (const condition of MODEL_TRIGGER_CONDITIONS) {
      const ability: Ability = {
        kind: 'triggered',
        condition,
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      };
      const result = transpileAbility(ability, 0, 'tst-conformance', 'abilities[0]');
      expect(result.ok, JSON.stringify(ability)).toBe(true);
      if (!result.ok) continue;
      const line = result.value.lines[0] ?? '';
      expect(line.startsWith('T:'), line).toBe(true);
      const pairs: Record<string, string> = {};
      for (const clause of line.slice(2).split(' | ')) {
        const [key = '', value = ''] = clause.split('$ ');
        pairs[key] = value;
      }
      emitted.set(condition, pairs);
    }
    expect([...emitted.keys()].sort()).toEqual([...MODEL_TRIGGER_CONDITIONS].sort());

    const enters = emitted.get('selfEnters') ?? {};
    const attacks = emitted.get('selfAttacks') ?? {};
    const dies = emitted.get('selfDies') ?? {};

    // Entering is a zone change that ends on the battlefield; dying is one that
    // starts there and ends in the graveyard. Swapping the two is the mutation
    // this test exists for, and it moves both of these lines at once.
    expect(enters.Mode).toBe('ChangesZone');
    expect(enters.Destination).toBe('Battlefield');
    expect(enters.Origin).not.toBe('Battlefield');
    expect(dies.Mode).toBe('ChangesZone');
    expect(dies.Origin).toBe('Battlefield');
    expect(dies.Destination).toBe('Graveyard');

    // Attacking is not a zone change at all, so an endpoint on this line would
    // be a parameter Forge's `Attacks` mode does not read.
    expect(attacks.Mode).toBe('Attacks');
    expect(attacks.Origin).toBeUndefined();
    expect(attacks.Destination).toBeUndefined();

    for (const [condition, pairs] of emitted) {
      expect(pairs.ValidCard, condition).toBe('Card.Self');
      expect(pairs.Execute, condition).toBe('Trig1Effect1');
    }
  });

  /**
   * The drift alarm: if the DSL widens which targets an effect may take, this
   * fails until the Forge mapping is extended, rather than letting a card
   * transpile with its target silently dropped.
   */
  it('agrees with the DSL about which targets each effect may take', () => {
    for (const kind of ALL_EFFECT_KINDS) {
      expect([...FORGE_EFFECTS[kind].targets].sort()).toEqual([...legalTargetsFor(kind)].sort());
    }
  });

  /**
   * Forge writes a zone move as one `ChangeZone` with an origin and a
   * destination, so the exile primitive is the bounce script with one parameter
   * changed — which is the same sentence the kernel arm makes about
   * `moveObject`, checked at the other boundary.
   */
  /**
   * The spelling here was read off Forge's own cardsfolder rather than reasoned
   * out of its API list, so this test pins a line Forge already parses: 468 of
   * its shipped cards scry, Preordain among them, and every one writes
   * `ScryNum$`. The absent `Defined$` is the corpus default and the DSL
   * primitive's meaning at once — nobody but the controller scries.
   */
  it('scries to the depth the effect names, as Forge spells it', () => {
    const card = parseCard({
      kind: 'instant',
      id: 'tst-far-sight',
      name: 'Far Sight',
      rarity: 'common',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: mana({ U: 1 }),
      colors: ['U'],
      effects: [{ kind: 'scry', count: 2 }],
    });
    expect(renderOracleText(card)).toBe('Scry 2.');

    const result = transpileCard(card);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.rejections)).toBe(true);
    const script = result.ok ? result.script.text : '';
    expect(script).toContain('SP$ Scry');
    expect(script).toContain('ScryNum$ 2');
    expect(script).not.toContain('Defined$');
  });

  it('exiles a creature as a ChangeZone into Exile', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'tst-void-call',
      name: 'Void Call',
      rarity: 'uncommon',
      set: { code: 'TST', collectorNumber: 1 },
      manaCost: mana({ generic: 2, W: 1 }),
      colors: ['W'],
      effects: [{ kind: 'exileTarget', target: { kind: 'targetCreature' } }],
    });
    expect(renderOracleText(card)).toBe('Exile target creature.');

    const result = transpileCard(card);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.rejections)).toBe(true);
    const script = result.ok ? result.script.text : '';
    expect(script).toContain('ChangeZone');
    expect(script).toContain('Origin$ Battlefield');
    expect(script).toContain('Destination$ Exile');
    expect(script).toContain('ValidTgts$ Creature');
  });

  /**
   * The scoped form lands on a different Forge API, which is the one place the
   * two engines disagree about what a primitive is: the DSL has one effect with
   * an optional scope and Forge has `ChangeZone` for one object and
   * `ChangeZoneAll` for a group. A transpiler that kept the unscoped API would
   * write a script that moves the targeted *player* into exile, which Forge
   * would either refuse or do something unrecognizable with.
   */
  it('exiles a whole board as a ChangeZoneAll over the targeted player', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'tst-void-reckoning',
      name: 'Void Reckoning',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 2 },
      manaCost: mana({ generic: 5, B: 2, R: 1 }),
      colors: ['B', 'R'],
      effects: [
        {
          kind: 'exileTarget',
          scope: 'creaturesThatPlayerControls',
          target: { kind: 'targetOpponent' },
        },
      ],
    });
    expect(renderOracleText(card)).toBe('Exile all creatures target opponent controls.');

    const result = transpileCard(card);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.rejections)).toBe(true);
    const script = result.ok ? result.script.text : '';
    expect(script).toContain('ChangeZoneAll');
    // Unqualified, not `Creature.TargetedPlayerCtrl`: the ability carries its own
    // `ValidTgts$` and Forge reads the two together. 2.0.14's `res/cardsfolder`
    // settles it — Mogg Infestation, Arms of Hadar, Dawnglare Invoker and
    // Aggravate all print `ValidTgts$ Player | ValidCards$ Creature`.
    expect(script).toContain('ChangeType$ Creature');
    expect(script).not.toContain('TargetedPlayerCtrl');
    expect(script).toContain('ValidTgts$ Player.Opponent');
    expect(script).toContain('Destination$ Exile');
  });

  /**
   * A quantity counted at resolution is refused rather than approximated.
   *
   * Forge can say it — `RememberChanged$ True` on the ability that exiles, an
   * `SVar:` the next ability reads — but that is one ability referring to
   * another, and this transpiler writes each effect on its own. A script that
   * dropped the clause would transpile clean and deal zero damage, which is the
   * silent disagreement the rejection vocabulary exists to prevent.
   */
  it('refuses a quantity it would have to invent a number for', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'tst-counted-strike',
      name: 'Counted Strike',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 3 },
      manaCost: mana({ generic: 3, R: 1 }),
      colors: ['R'],
      effects: [
        {
          kind: 'dealDamage',
          amount: { kind: 'exiledThisResolution' },
          target: { kind: 'targetOpponent' },
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok).toBe(false);
    const codes = result.ok ? [] : result.rejections.map((entry) => entry.code);
    expect(codes).toContain('UNMAPPED_COMPUTED_AMOUNT');
  });

  /**
   * A scope that reaches into a hand takes the same `ChangeZoneAll` with a
   * different `Origin$`, which is the export's version of the sentence the
   * vocabulary makes: a scope says where as well as which, and Forge spells the
   * where out where the DSL folds it into the word.
   */
  it('exiles out of a hand as the same ChangeZoneAll with a different origin', () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'tst-void-strip',
      name: 'Void Strip',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 4 },
      manaCost: mana({ generic: 2, B: 1 }),
      colors: ['B'],
      effects: [
        { kind: 'revealHand', target: { kind: 'targetOpponent' } },
        {
          kind: 'exileTarget',
          scope: 'creatureCardsInPlayerHand',
          target: { kind: 'targetOpponent' },
        },
      ],
    });
    const result = transpileCard(card);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.rejections)).toBe(true);
    const script = result.ok ? result.script.text : '';
    expect(script).toContain('RevealHand');
    expect(script).toContain('ChangeZoneAll');
    expect(script).toContain('Origin$ Hand');
    expect(script).toContain('Destination$ Exile');
  });

  /**
   * Reanimation is the same `ChangeZoneAll` with the origin and the destination
   * swapped, which is the whole reason it is a scope on a kind rather than a
   * kind of its own. What the script must not say is anything about control:
   * Forge's default for this API puts a card onto the battlefield under its
   * owner's control, the DSL primitive means exactly that, and a `GainControl$`
   * would be a card that reads one way and plays another.
   */
  it("returns a graveyard's creatures with ChangeZoneAll", () => {
    const card = parseCard({
      kind: 'sorcery',
      id: 'tst-blood-moon-rite',
      name: 'Blood Moon Rite',
      rarity: 'rare',
      set: { code: 'TST', collectorNumber: 5 },
      manaCost: mana({ generic: 4, B: 2 }),
      colors: ['B'],
      effects: [
        {
          kind: 'returnFromGraveyard',
          scope: 'creatureCardsInPlayerGraveyard',
          target: { kind: 'targetPlayer' },
        },
      ],
    });
    expect(renderOracleText(card)).toBe(
      "Return all creature cards from target player's graveyard to the battlefield under their owner's control.",
    );

    const result = transpileCard(card);
    expect(result.ok, result.ok ? '' : JSON.stringify(result.rejections)).toBe(true);
    const script = result.ok ? result.script.text : '';
    expect(script).toContain('ChangeZoneAll');
    expect(script).toContain('ChangeType$ Creature');
    expect(script).toContain('Origin$ Graveyard');
    expect(script).toContain('Destination$ Battlefield');
    expect(script).not.toContain('GainControl$');
  });
});

describe('fixture set', () => {
  it('transpiles every DSL example card', () => {
    for (const card of EXAMPLE_SET) {
      const result = transpileCard(card);
      expect(result.ok, `${card.name}: ${result.ok ? '' : JSON.stringify(result.rejections)}`).toBe(true);
    }
  });

  it('exports the whole example set without rejections', () => {
    const result = transpileSet(EXAMPLE_SET, { name: 'Slice Toy Set', date: '2026-08-09' });
    expect(result.ok ? [] : result.rejections).toEqual([]);
  });

  /**
   * `EXAMPLE_SET` is `@mtg/dsl`'s shipped fixture library and its bytes are
   * pinned in five other places — a fingerprint corpus, a Draftmancer golden
   * file, a replay recording — so what it covers moves only when a card is
   * worth moving all of them for. It used to cover exactly the priced half,
   * and `mtg-q5yg` broke that identity by pricing three primitives without
   * printing a fixture card for any of them.
   *
   * The list is written out rather than derived, because the derivation is the
   * thing that went stale: "priced" and "in the fixture library" were the same
   * set by coincidence of history, and a test that says so in one expression
   * cannot say which of the two moved. Each absence names the test that covers
   * that primitive instead, and a fourth absence appearing without one is what
   * this fails on.
   */
  it('covers every priced effect primitive except the three with their own tests', () => {
    const covered = new Set(EXAMPLE_SET.flatMap((card) => card.effects.map((effect) => effect.kind)));
    const elsewhere: readonly EffectKind[] = [
      // 'exiles a creature as a ChangeZone into Exile', above.
      'exileTarget',
      // 'scries to the depth the effect names, as Forge spells it', above.
      'scry',
      // 'returns a graveyard's creatures with ChangeZoneAll', in the scoped
      // arm's own describe block.
      'returnFromGraveyard',
    ];
    expect([...covered].sort()).toEqual([...EFFECT_KINDS].filter((kind) => !elsewhere.includes(kind)).sort());
    for (const kind of elsewhere) {
      expect(covered.has(kind), `${kind} is in the fixture library after all`).toBe(false);
    }
  });

  it('covers every evergreen keyword across the fixture set', () => {
    const covered = new Set(EXAMPLE_SET.flatMap((card) => card.keywords));
    expect([...covered].sort()).toEqual([...KEYWORDS].sort());
  });
});
