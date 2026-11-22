/**
 * The member list a search filter spells, and the two positions that refuse it.
 *
 * `ChangeType$` and `ValidCard$` read a comma as "or": 285 of the 2,616
 * `ChangeType$` lines in Forge 2.0.15's `res/cardsfolder` write one, and 834 of
 * the `ValidCard$` lines do. `ChangeType$ Instant.YouOwn,Sorcery.YouOwn` is
 * shipped twelve times and `ValidCard$ Instant,Sorcery` 264 times, so the
 * spelling below is read off the corpus rather than assembled from a grammar
 * guess.
 *
 * That the comma means any-of and not once-per-member comes from the Java:
 * `AbilityUtils.filterListByType` passes the whole string to
 * `CardLists.getValidCards`, which splits on commas and filters with
 * `isValid(String[])`, and that returns on the first member a card matches.
 *
 * An activation cost is the position that must keep refusing. Forge spells the
 * OR there with a semicolon — `Discard<1/Enchantment;Instant;Sorcery/...>` and
 * `Sac<1/Artifact;Creature;Land/...>` — and both shipped forms also carry a
 * third human-readable field this transpiler does not write, so a union in a
 * cost would be a guess and not a spelling.
 */
import { describe, expect, it } from 'vitest';
import { forgeSearchType, forgeSearchTypeUnion } from '../src/vocabulary-map';
import { transpileCard } from '../src/index';
import { creature, mustTranspile, spell } from './helpers';

describe('the members a filter spells', () => {
  it('writes one member per card type', () => {
    expect(forgeSearchTypeUnion({ cardTypes: ['instant', 'sorcery'] })).toBe('Instant,Sorcery');
  });

  it('carries a shared qualifier onto every member', () => {
    expect(forgeSearchTypeUnion({ cardTypes: ['instant', 'sorcery'] }, 'YouOwn')).toBe(
      'Instant.YouOwn,Sorcery.YouOwn',
    );
  });

  it('distributes across two lists rather than concatenating them', () => {
    expect(forgeSearchTypeUnion({ cardTypes: ['creature', 'artifact'], subtypes: ['Monster', 'Vorn'] })).toBe(
      'Creature.Monster,Creature.Vorn,Artifact.Monster,Artifact.Vorn',
    );
  });

  /**
   * A keyword is a qualifier and joins with `+`, which the corpus is explicit
   * about: `Creature.YouCtrl+withFlying` is shipped 21 times and a second dot
   * in that position appears never.
   */
  it('joins a keyword to the qualifiers rather than opening a second dot', () => {
    expect(forgeSearchTypeUnion({ cardTypes: ['creature'], colors: ['G'], keywords: ['flying'] })).toBe(
      'Creature.Green+withFlying',
    );
  });

  it('still refuses a filter that names a card, since a name may contain the separator', () => {
    expect(forgeSearchTypeUnion({ names: ['Baru, Fist of Krosa'] })).toBeNull();
    expect(forgeSearchType({ names: ['Baru, Fist of Krosa'] })).toBeNull();
  });
});

describe('the single-member spelling a cost and a quota need', () => {
  it('refuses what the union spells', () => {
    expect(forgeSearchType({ cardTypes: ['instant', 'sorcery'] })).toBeNull();
    expect(forgeSearchType({ cardTypes: ['instant'] })).toBe('Instant');
  });

  it('refuses a discard cost over two card types rather than writing a comma into it', () => {
    const result = transpileCard(
      creature('Pitch Two Ways', {
        abilities: [
          {
            kind: 'activated',
            cost: {
              mana: {},
              tapSelf: true,
              discard: 1,
              discardFilter: { cardTypes: ['instant', 'sorcery'] },
            },
            effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections.map((r) => r.code)).toContain('UNMAPPED_ACTIVATION_COST_FILTER');
  });
});

/**
 * The flagship card that was the last of 371 the set could not export, and the
 * line it now writes is `inspiration_from_beyond.txt`'s, which prints the same
 * rules text.
 */
describe('Ancient Shrine Recall', () => {
  it('returns an instant or sorcery from your own graveyard', () => {
    const script = mustTranspile(
      spell(
        'Ancient Shrine Recall',
        [
          {
            kind: 'chooseFromGraveyard',
            whose: 'you',
            filter: { cardTypes: ['instant', 'sorcery'] },
            destination: 'hand',
          },
        ],
        { colors: ['U'], manaCost: { generic: 1, U: 1 } },
      ),
    );
    expect(script).toContain(
      'A:SP$ ChangeZone | Origin$ Graveyard | Destination$ Hand | ' +
        'ChangeType$ Instant.YouOwn,Sorcery.YouOwn | ChangeNum$ 1 | Hidden$ True | Chooser$ You',
    );
  });
});
