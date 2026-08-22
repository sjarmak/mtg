/**
 * What a retained referent exports as.
 *
 * `triggeringCreature` is not a target the caster chooses; it is the object the
 * event kept, and Forge spells that as `Defined$ TriggeredTarget` rather than
 * as a `ValidTgts$` clause. Which object it refers to is decided entirely by
 * the enclosing trigger, so the mapping is only sound because the DSL admits
 * the kind under exactly two triggers and one of them never reaches the effect
 * writer:
 *
 *   - the canonical exalted ability, which `ability-script.ts` answers with
 *     `K:Exalted` before any effect is written, and whose non-canonical
 *     envelopes it rejects there;
 *   - `selfDealsCombatDamageToCreature`, whose Forge mode is `DamageDone` with
 *     `ValidTarget$ Creature`, and `TriggeredTarget` is that mode's name for
 *     the creature that was damaged.
 *
 * Both arms are asserted here rather than only the new one. The transpiler used
 * to refuse the kind outright, and the two commons in the flagship that print it
 * kept the whole 261-card set at zero exported files long after the token-name
 * collisions in front of them were fixed.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { legalTargetsFor, parseCard } from '@mtg/dsl';
import { FORGE_EFFECTS } from '../src/effect-script';
import { mustTranspile, slugId } from './helpers';

/** A creature whose combat damage leaves a counter on what it hit. */
function stalker(name: string): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['B'],
    power: 2,
    toughness: 2,
    manaCost: { generic: 2, W: 0, U: 0, B: 1, R: 0, G: 0 },
    keywords: [],
    effects: [],
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfDealsCombatDamageToCreature',
        effects: [
          { kind: 'putCounters', counter: 'gloom', count: 1, target: { kind: 'triggeringCreature' } },
        ],
      },
    ],
  });
}

/** The exact mandatory envelope the DSL reserves for exalted. */
function exalted(name: string): Card {
  return parseCard({
    kind: 'creature',
    id: slugId(name),
    name,
    rarity: 'common',
    set: { code: 'TST', collectorNumber: 2 },
    colors: ['W'],
    power: 1,
    toughness: 3,
    manaCost: { generic: 1, W: 1, U: 0, B: 0, R: 0, G: 0 },
    keywords: [],
    effects: [],
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
  });
}

describe('a combat-damage trigger that acts on what it damaged', () => {
  const script = mustTranspile(stalker('Gloom Stalker'));

  it('names the damaged creature with Defined$ TriggeredTarget, not a ValidTgts clause', () => {
    expect(script).toContain('Defined$ TriggeredTarget');
    expect(script).not.toContain('ValidTgts$');
  });

  it('hangs it off the DamageDone trigger the mapping table writes', () => {
    expect(script).toContain('Mode$ DamageDone');
    expect(script).toContain('ValidSource$ Card.Self');
    expect(script).toContain('ValidTarget$ Creature');
    expect(script).toContain('CombatDamage$ True');
  });

  /**
   * The payload is a counter, so the referent has to survive into the `SVar:`
   * body rather than staying on the `T:` line. A `Defined$` on the trigger line
   * would transpile clean and do nothing.
   */
  it('carries the referent on the sub-ability that puts the counter', () => {
    const svar = script.split('\n').find((line) => line.startsWith('SVar:') && line.includes('PutCounter'));
    expect(svar).toBeDefined();
    expect(svar).toContain('Defined$ TriggeredTarget');
  });
});

/**
 * The kind is deliberately absent from every row of `FORGE_EFFECTS[..].targets`,
 * and `conformance.test.ts` fails if it is added: those rows must equal the
 * DSL's own `legalTargetsFor`, and the DSL keeps `triggeringCreature` out of
 * that table too (`dsl/src/targets.ts` maps it to the empty list). Legality for
 * a retained referent is a property of the enclosing trigger, which the ability
 * validator enforces, not of the effect that spends it. `targetParams` answers
 * the kind before it consults the row for the same reason.
 */
describe('the two legality tables, which must keep disagreeing about this kind', () => {
  it('leaves the retained referent out of the per-effect target rows', () => {
    expect([...FORGE_EFFECTS.putCounters.targets]).not.toContain('triggeringCreature');
    expect([...legalTargetsFor('putCounters')]).not.toContain('triggeringCreature');
  });
});

describe('the exalted arm, which must not have moved', () => {
  it('is still the native keyword and never an effect script', () => {
    const script = mustTranspile(exalted('Gate Sentinel'));
    expect(script).toContain('K:Exalted');
    expect(script).not.toContain('TriggeredTarget');
    expect(script).not.toContain('Pump');
  });
});
