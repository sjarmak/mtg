/**
 * A filtered target slot as Forge writes it.
 *
 * Forge's selector grammar is three separators and nothing else: a dot opens the
 * first qualifier on a base, a plus joins every qualifier after it, and a comma
 * unions whole selectors — which is why an alternative repeats the base
 * (`Creature.attacking,Creature.blocking`) instead of listing two qualifiers.
 * The DSL filter is a conjunction of four dimensions, two of which are lists of
 * alternatives, so translating it is a cross product and not a concatenation,
 * and that is the whole content of `forgeFilteredTargets`.
 *
 * The card types swap sides between a permanent and a spell on the stack, which
 * is the one thing this file argues rather than asserts. On the battlefield the
 * type *is* the base (Demolish is `ValidTgts$ Artifact,Land`); on the stack the
 * base is `Card` and the type is a qualifier (Essence Scatter is
 * `ValidTgts$ Card.Creature`). Writing `Permanent.Artifact` for the first would
 * be a selector nothing in the corpus writes.
 *
 * Everything here is read off `res/cardsfolder` rather than off a booted Forge,
 * which is the standing limit on the whole package (`mtg-17a`).
 */
import { describe, expect, it } from 'vitest';
import type { Card, EffectInput, TargetFilter } from '@mtg/dsl';
import { FORGE_EFFECTS, forgeFilteredTargets, FORGE_VALID_TARGETS } from '@mtg/forge-export';
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

/** The `ValidTgts$` value out of an `A:` line. */
function validTgts(line: string): string {
  const found = /ValidTgts\$ ([^|]*)/.exec(line);
  if (found === null) throw new Error(`no ValidTgts in ${line}`);
  return (found[1] ?? '').trim();
}

function destroy(filter: TargetFilter): EffectInput {
  return { kind: 'destroyPermanent', target: { kind: 'targetPermanent', filter } };
}

describe('the two new target kinds', () => {
  it('spell each base the way the shipped cards spell it', () => {
    expect(FORGE_VALID_TARGETS.targetPermanent).toBe('Permanent');
    expect(FORGE_VALID_TARGETS.targetPlayerOrPlaneswalker).toBe('Player,Planeswalker');
  });

  it('reach the effects the DSL admits them under', () => {
    expect([...FORGE_EFFECTS.destroyPermanent.targets]).toContain('targetPermanent');
    expect([...FORGE_EFFECTS.exileTarget.targets]).toContain('targetPermanent');
    expect([...FORGE_EFFECTS.dealDamage.targets]).toContain('targetPlayerOrPlaneswalker');
  });

  it('writes the unfiltered permanent selector as the one word Forge uses', () => {
    expect(
      validTgts(
        lineFor('Vindicating Light', { kind: 'destroyPermanent', target: { kind: 'targetPermanent' } }),
      ),
    ).toBe('Permanent');
  });

  it('writes Lava Axe’s two-space selector', () => {
    expect(
      validTgts(
        lineFor('Cinder Axe', {
          kind: 'dealDamage',
          amount: 5,
          target: { kind: 'targetPlayerOrPlaneswalker' },
        }),
      ),
    ).toBe('Player,Planeswalker');
  });
});

describe('a card-type filter', () => {
  it('becomes the base itself, the way Smelt and Demolish are written', () => {
    expect(validTgts(lineFor('Smelting', destroy({ cardTypes: ['artifact'] })))).toBe('Artifact');
    expect(validTgts(lineFor('Demolishing', destroy({ cardTypes: ['artifact', 'land'] })))).toBe(
      'Artifact,Land',
    );
  });

  it('negates with the non prefix Bramblecrush is written with', () => {
    expect(validTgts(lineFor('Bramble Crushing', destroy({ excludeCardTypes: ['creature'] })))).toBe(
      'Permanent.nonCreature',
    );
  });
});

describe('a color filter', () => {
  it('unions the alternatives by repeating the base, as Celestial Purge does', () => {
    expect(validTgts(lineFor('Purging Light', destroy({ colors: ['B', 'R'] })))).toBe(
      'Permanent.Black,Permanent.Red',
    );
  });

  it('negates one color the way Doom Blade does', () => {
    const line = lineFor('Blade of Doom', {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { excludeColors: ['B'] } },
    });
    expect(validTgts(line)).toBe('Creature.nonBlack');
  });
});

describe('a combat filter', () => {
  it('writes one qualifier for one role', () => {
    const line = lineFor('Smiting', {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { combat: 'blocking' } },
    });
    expect(validTgts(line)).toBe('Creature.blocking');
  });

  it('writes Divine Verdict’s union, because the roles are alternatives', () => {
    const line = lineFor('Verdict of the Divine', {
      kind: 'destroyPermanent',
      target: { kind: 'targetCreature', filter: { combat: 'attackingOrBlocking' } },
    });
    expect(validTgts(line)).toBe('Creature.attacking,Creature.blocking');
  });
});

describe('a filter that meets a restriction', () => {
  /**
   * The restriction attaches to the selector the filter already narrowed, with
   * Forge's plus rather than a second dot. The clause is one string and there
   * is nowhere else to put half of it.
   */
  it('joins them on one selector', () => {
    const line = lineFor('Withering Smite', {
      kind: 'destroyPermanent',
      target: {
        kind: 'targetCreature',
        filter: { combat: 'attacking' },
        restriction: { kind: 'maxPower', power: 3 },
      },
    });
    expect(validTgts(line)).toBe('Creature.attacking+powerLE3');
  });
});

describe('the spell filter on a counter', () => {
  it('qualifies Card rather than replacing it, as Essence Scatter does', () => {
    const line = lineFor('Scattering Essence', {
      kind: 'counterSpell',
      spellFilter: { cardTypes: ['creature'] },
    });
    expect(validTgts(line)).toBe('Card.Creature');
    expect(line).toContain('TargetType$ Spell');
  });

  it('negates the same way Negate does, and unions the way Flashfreeze does', () => {
    expect(
      validTgts(
        lineFor('Negation', { kind: 'counterSpell', spellFilter: { excludeCardTypes: ['creature'] } }),
      ),
    ).toBe('Card.nonCreature');
    expect(
      validTgts(lineFor('Freezing Flash', { kind: 'counterSpell', spellFilter: { colors: ['R', 'G'] } })),
    ).toBe('Card.Red,Card.Green');
  });

  it('leaves the unfiltered counter exactly as it was', () => {
    expect(validTgts(lineFor('Canceling', { kind: 'counterSpell' }))).toBe('Card');
  });
});

describe('the selector builder itself', () => {
  it('crosses the two alternative dimensions rather than concatenating them', () => {
    expect(
      forgeFilteredTargets('Permanent', { cardTypes: ['artifact'], colors: ['B', 'R'] }, 'base'),
    ).toEqual(['Artifact.Black', 'Artifact.Red']);
  });

  it('appends every conjunctive qualifier with a plus', () => {
    expect(
      forgeFilteredTargets(
        'Creature',
        { excludeColors: ['B', 'R'], excludeCardTypes: ['artifact'], combat: 'attacking' },
        'base',
      ),
    ).toEqual(['Creature.attacking+nonArtifact+nonBlack+nonRed']);
  });

  it('distributes over a base that is already a union', () => {
    expect(forgeFilteredTargets('Artifact,Enchantment', { colors: ['W'] }, 'base')).toEqual([
      'Artifact.White',
      'Enchantment.White',
    ]);
  });
});
