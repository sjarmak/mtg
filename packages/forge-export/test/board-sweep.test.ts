/**
 * What an untargeted sweep exports as, and the two shapes it refuses by name.
 *
 * `sweepers.test.ts` is the targeted half, where the group is named by an
 * unqualified `ValidCards$` beside the ability's own `ValidTgts$`. A board sweep
 * has no target slot at all (CR 115.1), and that absence is the whole
 * difference: 2.0.14's `res/cardsfolder` writes these cards with a `ValidCards$`
 * and no `ValidTgts$` anywhere on the line, and passing this transpiler's
 * `noTarget` mapping through instead would write `Defined$ You` and aim a wrath
 * at its own caster.
 *
 * The lines these assertions are read off, verbatim from `res/cardsfolder`:
 *
 *   Day of Judgment    SP$ DestroyAll | ValidCards$ Creature
 *   Back to Nature     SP$ DestroyAll | ValidCards$ Enchantment
 *   Planar Cleansing   SP$ DestroyAll | ValidCards$ Permanent.nonLand
 *   Pyroclasm          SP$ DamageAll  | NumDmg$ 2 | ValidCards$ Creature
 *   Rain of Blades     SP$ DamageAll  | NumDmg$ 1 | ValidCards$ Creature.attacking
 *   Glorious Charge    SP$ PumpAll    | ValidCards$ Creature.YouCtrl | NumAtt$ +1 | NumDef$ +1
 *   Cower in Fear      SP$ PumpAll    | ValidCards$ Creature.OppCtrl | NumAtt$ -1 | NumDef$ -1
 *   Trumpet Blast      SP$ PumpAll    | ValidCards$ Creature.attacking | NumAtt$ +2
 *   Cleaver Riot       SP$ PumpAll    | ValidCards$ Creature.YouCtrl | KW$ Double Strike
 *   Temple Bell        AB$ Draw       | Cost$ T | NumCards$ 1 | Defined$ Player
 *
 * The qualifier order is corpus-attested too: `Creature.YouCtrl` appears 666
 * times, `Creature.OppCtrl` 90, and `Creature.attacking+YouCtrl` 11 — the dot
 * before the first qualifier and the plus before every one after it, which is
 * `appendQualifier`'s rule and not a guess.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, Effect, EffectInput } from '@mtg/dsl';
import { transpileEffect } from '@mtg/forge-export';
import { mustTranspile, spell } from './helpers';

function abilityLine(card: Card): string {
  const line = mustTranspile(card)
    .split('\n')
    .find((text) => text.startsWith('A:'));
  if (line === undefined) throw new Error('no A: line');
  return line;
}

function lineFor(name: string, effect: EffectInput): string {
  return abilityLine(spell(name, [effect]));
}

const NOWHERE = { kind: 'noTarget' } as const;

describe('a sweep over a region of the board', () => {
  /**
   * The card type comes from the `scopeFilter` and the API comes from the
   * scope, which is the split the vocabulary made: one scope word, three
   * printed cards, three selectors.
   */
  it('writes the filter as the ValidCards selector and picks the All API', () => {
    expect(
      lineFor('Day of Judgment', {
        kind: 'destroyPermanent',
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'] },
        target: NOWHERE,
      }),
    ).toContain('SP$ DestroyAll | ValidCards$ Creature');
    expect(
      lineFor('Back to Nature', {
        kind: 'destroyPermanent',
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['enchantment'] },
        target: NOWHERE,
      }),
    ).toContain('SP$ DestroyAll | ValidCards$ Enchantment');
    expect(
      lineFor('Planar Cleansing', {
        kind: 'destroyPermanent',
        scope: 'allPermanents',
        scopeFilter: { excludeCardTypes: ['land'] },
        target: NOWHERE,
      }),
    ).toContain('ValidCards$ Permanent.nonLand');
  });

  /**
   * The absence is the assertion. A `noTarget` slot maps to `Defined$ You`
   * everywhere else in this transpiler, and a wrath carrying that clause is a
   * card that destroys its caster's board and nothing else.
   */
  it('writes no target clause at all, because the card chooses nothing', () => {
    const line = lineFor('Pyroclasm', {
      kind: 'dealDamage',
      amount: 2,
      scope: 'allPermanents',
      scopeFilter: { cardTypes: ['creature'] },
      target: NOWHERE,
    });
    expect(line).toContain('SP$ DamageAll');
    expect(line).toContain('ValidCards$ Creature');
    expect(line).toContain('NumDmg$ 2');
    expect(line).not.toContain('ValidTgts$');
    expect(line).not.toContain('Defined$');
  });

  it('appends the controller qualifier for a one-sided sweep', () => {
    expect(
      lineFor('Glorious Charge', {
        kind: 'pumpUntilEndOfTurn',
        power: 1,
        toughness: 1,
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: NOWHERE,
      }),
    ).toContain('SP$ PumpAll | ValidCards$ Creature.YouCtrl | NumAtt$ +1 | NumDef$ +1');
    expect(
      lineFor('Cower in Fear', {
        kind: 'pumpUntilEndOfTurn',
        power: -1,
        toughness: -1,
        scope: 'permanentsOpponentsControl',
        scopeFilter: { cardTypes: ['creature'] },
        target: NOWHERE,
      }),
    ).toContain('SP$ PumpAll | ValidCards$ Creature.OppCtrl | NumAtt$ -1 | NumDef$ -1');
  });

  /**
   * Two qualifiers on one selector, which is where the dot-then-plus rule
   * actually bites. `Creature.attacking` alone is Trumpet Blast; the same
   * filter on a one-sided scope is the eleven-card `Creature.attacking+YouCtrl`
   * spelling, and getting the separator backwards would write a selector Forge
   * reads as a different set.
   */
  it('joins a second qualifier with a plus rather than a second dot', () => {
    expect(
      lineFor('Trumpet Blast', {
        kind: 'pumpUntilEndOfTurn',
        power: 2,
        toughness: 0,
        scope: 'allPermanents',
        scopeFilter: { cardTypes: ['creature'], combat: 'attacking' },
        target: NOWHERE,
      }),
    ).toContain('ValidCards$ Creature.attacking');
    expect(
      lineFor('Charge of the Line', {
        kind: 'pumpUntilEndOfTurn',
        power: 2,
        toughness: 0,
        scope: 'permanentsYouControl',
        scopeFilter: { cardTypes: ['creature'], combat: 'attacking' },
        target: NOWHERE,
      }),
    ).toContain('ValidCards$ Creature.attacking+YouCtrl');
  });

  /**
   * The counter placement reached this shape with `mtg-hfex` (Steel Overseer,
   * M11 214), and it arrives already carrying the two things the qualifier rule
   * needs: the scope picks the side and the filter picks the members, so the
   * selector is the one `PumpAll` has been writing, under `PutCounterAll`.
   *
   * `CounterNum$` rides along, which is the parameter that distinguishes this
   * from the pump: the sweep API changes and the counter arguments do not.
   */
  it('places a counter over a one-sided sweep with PutCounterAll', () => {
    const line = lineFor('Forge Overseer', {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['artifact'] },
      target: NOWHERE,
    });
    expect(line).toContain('SP$ PutCounterAll | ValidCards$ Artifact.YouCtrl');
    expect(line).toContain('CounterType$ P1P1');
    expect(line).toContain('CounterNum$ 1');
    expect(line).not.toContain('ValidTgts$');
    expect(line).not.toContain('Defined$');
  });

  /**
   * The group keyword grant (`mtg-nhyv.15`), which shares Forge's pump API
   * rather than getting one of its own: Cleaver Riot's whole line is
   * `PumpAll` with a `KW$` and no deltas, and Overwhelming Stampede is the
   * same line with the deltas added back. So the mass grant is not a new
   * script — it is the sweep this file has been writing since Glorious Charge,
   * carrying the parameter the targeted grant already writes beside `Pump`.
   *
   * The keyword is the card's own since `mtg-nhyv.63`. It read `trample` while
   * `grantKeywordUntilEndOfTurn` was typed against the evergreen nine, so the
   * assertion was Overwhelming Stampede's word under Cleaver Riot's name;
   * `KW$ Double Strike` is what the docblock above quotes off `res/cardsfolder`
   * and now what this writes. `FORGE_GRANTABLE_KEYWORDS` is the table it comes
   * from, and that name is spelled identically on the 129 printed
   * `K:Double Strike` lines in the same corpus, which is why the grant map
   * extends the printed one instead of standing beside it.
   */
  it('writes the mass keyword grant as Cleaver Riot writes it', () => {
    const line = lineFor('Cleaver Riot', {
      kind: 'grantKeywordUntilEndOfTurn',
      keyword: 'doubleStrike',
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: NOWHERE,
    });
    expect(line).toContain('SP$ PumpAll | ValidCards$ Creature.YouCtrl | KW$ Double Strike');
    expect(line).not.toContain('NumAtt$');
    expect(line).not.toContain('ValidTgts$');
    expect(line).not.toContain('Defined$');
  });

  /**
   * Overwhelming Stampede's word, kept as the control the line above used to
   * be: an evergreen keyword and a keyword ability come out of one table and
   * one script, so the only thing that moves between these two lines is the
   * name.
   */
  it('writes an evergreen keyword through the same script', () => {
    const line = lineFor('Overwhelming Stampede', {
      kind: 'grantKeywordUntilEndOfTurn',
      keyword: 'trample',
      scope: 'permanentsYouControl',
      scopeFilter: { cardTypes: ['creature'] },
      target: NOWHERE,
    });
    expect(line).toContain('SP$ PumpAll | ValidCards$ Creature.YouCtrl | KW$ Trample');
  });

  /**
   * The targeted form is the control on that: one word of the script changes,
   * and it is the API rather than the parameter.
   */
  it('keeps the single-target grant on Pump with the same KW parameter', () => {
    const line = lineFor('Sudden Updraft', {
      kind: 'grantKeywordUntilEndOfTurn',
      keyword: 'flying',
      target: { kind: 'targetCreature' },
    });
    expect(line).toContain('SP$ Pump');
    expect(line).not.toContain('SP$ PumpAll');
    expect(line).toContain('KW$ Flying');
  });

  /**
   * The refusal the neighboring two carry, now reachable on this kind: the DSL
   * refuses a space scope with no filter beside it, and the transpiler refuses
   * it a second time rather than defaulting to `ValidCards$ Permanent`, which is
   * a Forge script that puts a +1/+1 counter on its caster's lands.
   */
  it('refuses a space-scoped counter placement that names no permanents', () => {
    const effect = {
      kind: 'putCounters',
      counter: 'plusOnePlusOne',
      count: 1,
      scope: 'permanentsYouControl',
      target: { kind: 'noTarget' },
    } as unknown as Effect;
    const result = transpileEffect(effect, 'tst-space-counter', 'effects[0]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.path).toBe('effects[0].scopeFilter');
    expect(result.rejections[0]?.message).toContain('permanentsYouControl');
  });
});

describe('the sweep over the players', () => {
  /**
   * `Defined$ Player` is every seat at the table, which is why it replaces the
   * target clause rather than sitting beside it: the `noTarget` slot the card
   * carries maps to `Defined$ You`, and two `Defined$` keys on one line is a
   * script with two answers to one question.
   */
  it('writes Temple Bell as Defined$ Player rather than Defined$ You', () => {
    const line = lineFor('Temple Toll', {
      kind: 'drawCards',
      count: 1,
      players: 'eachPlayer',
      target: NOWHERE,
    });
    expect(line).toContain('SP$ Draw');
    expect(line).toContain('Defined$ Player');
    expect(line).not.toContain('Defined$ You');
  });

  it('leaves the ordinary draw exactly as it was', () => {
    const line = lineFor('Careful Study', { kind: 'drawCards', count: 2, target: NOWHERE });
    expect(line).toContain('NumCards$ 2');
    expect(line).not.toContain('Defined$ Player');
  });
});

/**
 * The two combinations this transpiler refuses by name.
 *
 * Both are already refused by `@mtg/dsl`, so no valid card reaches either arm —
 * and both are here anyway, because a parity oracle that quietly widened a card
 * would report a mismatch as agreement, which is worse than the gap it reports.
 * `transpileEffect` is the entry point rather than `transpileCard`, because a
 * card carrying either shape fails DSL validation before the transpiler is
 * reached and the assertion would be about the validator instead. The two zone
 * moves keep a real target slot for the same reason: `noTarget` is not on their
 * Forge rows either, so the target mapping would refuse them first and the
 * scope guard under test would never run.
 */
describe('what the transpiler refuses', () => {
  /**
   * `ValidCards$ Permanent` is what a defaulted empty filter would emit, and
   * that is a Forge script that destroys the lands too.
   */
  it('refuses a region scope carrying no filter, naming the scope', () => {
    const effect = {
      kind: 'destroyPermanent',
      scope: 'allPermanents',
      target: NOWHERE,
    } as unknown as Effect;
    const result = transpileEffect(effect, 'tst-unfiltered', 'effects[0]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.path).toBe('effects[0].scopeFilter');
    expect(result.rejections[0]?.message).toContain('allPermanents');
  });

  /**
   * `ChangeZoneAll` needs an `Origin$` and a region of the board is not a zone
   * to read from, which is why `FORGE_SCOPE_ORIGINS` is keyed by the targeted
   * half of the vocabulary and this arm exists instead of a lookup that could
   * not be written.
   */
  it('refuses a zone move whose scope names a region rather than a zone', () => {
    const effect = {
      kind: 'exileTarget',
      scope: 'allPermanents',
      target: { kind: 'targetOpponent' },
    } as unknown as Effect;
    const result = transpileEffect(effect, 'tst-space-exile', 'effects[0]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.path).toBe('effects[0].scope');
    expect(result.rejections[0]?.message).toContain('allPermanents');
    expect(result.rejections[0]?.message).toContain('Origin$');
  });

  it('refuses the same combination on the graveyard return', () => {
    const effect = {
      kind: 'returnFromGraveyard',
      scope: 'permanentsYouControl',
      destination: 'hand',
      target: { kind: 'targetOpponent' },
    } as unknown as Effect;
    const result = transpileEffect(effect, 'tst-space-return', 'effects[0]');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections[0]?.code).toBe('UNMAPPED_EFFECT_KIND');
    expect(result.rejections[0]?.message).toContain('permanentsYouControl');
  });
});
