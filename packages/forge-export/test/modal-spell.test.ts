/**
 * A modal spell, against the shape `res/cardsfolder` writes one in.
 *
 * `res/cardsfolder/a/abzan_charm.txt` is the whole grammar: `A:SP$ Charm |
 * Choices$ DBExile,DBDraw,DBCounters`, one SVar per mode, each an ordinary
 * `DB$` sub-ability carrying its own `SpellDescription$` — the bullet a player
 * reads when choosing — and a mode whose second sentence rides on a
 * `SubAbility$` of its own. 523 shipped scripts write `SP$ Charm`.
 *
 * No `CharmNum$` on any card this transpiler writes. `CharmEffect.java` reads
 * it with a default of `1`, 348 of the 523 leave it off, and `ModesSchema` is a
 * list of modes with no choose-count beside it, so choose-one is not a subset
 * of what the DSL can say here — it is all of it.
 *
 * Until `mtg-xcjg` the transpiler refused every modal card outright, because
 * `abilityBlock` built its chain from `card.effects` and `checkEffects` requires
 * that to be empty on a modal card: a script built from it would have printed a
 * card with no ability lines at all. The refusal was right about that and wrong
 * about the corpus.
 */
import { describe, expect, it } from 'vitest';
import type { CardInput } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import { transpileCard, transpileCardScript } from '@mtg/forge-export';

const modalCard = (id: string, modes: readonly unknown[]): ReturnType<typeof parseCard> =>
  parseCard({
    kind: 'instant',
    id,
    name: 'Fork in the Road',
    rarity: 'uncommon',
    set: { code: 'TST', collectorNumber: 1 },
    colors: ['G'],
    manaCost: { generic: 1, G: 1 },
    modes,
  } as unknown as CardInput);

const linesOf = (card: ReturnType<typeof parseCard>): readonly string[] => {
  const result = transpileCard(card);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.rejections)}`);
  return result.script.text.split('\n');
};

const codesOf = (card: ReturnType<typeof parseCard>): readonly string[] => {
  const result = transpileCardScript(card);
  if (result.ok) throw new Error('exported; expected a refusal');
  return result.rejections.map((found) => found.code);
};

describe('a modal spell in Forge', () => {
  it("names one SVar per mode on a Charm line, with no CharmNum$ and Abzan Charm's shape", () => {
    const lines = linesOf(
      modalCard('tst-fork-in-the-road', [
        { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }] },
        { effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }] },
      ]),
    );
    expect(lines).toContain('A:SP$ Charm | Choices$ Mode1,Mode2');
    expect(lines).toContain(
      'SVar:Mode1:DB$ DealDamage | ValidTgts$ Creature | NumDmg$ 3 | SpellDescription$ CARDNAME deals 3 damage to target creature.',
    );
    expect(lines).toContain(
      'SVar:Mode2:DB$ Destroy | ValidTgts$ Creature | SpellDescription$ Destroy target creature.',
    );
    expect(lines.join('\n')).not.toContain('CharmNum$');
  });

  /**
   * Every mode's bullet is on the mode, not on the Charm line: Forge builds the
   * choice prompt out of the sub-abilities' own descriptions, and a
   * `SpellDescription$` on the Charm would print the whole card twice.
   */
  it('prints the printed bullets on the Oracle line and nowhere else on the Charm', () => {
    const lines = linesOf(
      modalCard('tst-fork-oracle', [
        { effects: [{ kind: 'dealDamage', amount: 3, target: { kind: 'targetCreature' } }] },
        { effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }] },
      ]),
    );
    const charm = lines.find((line) => line.startsWith('A:SP$ Charm'));
    expect(charm).not.toContain('SpellDescription$');
    expect(lines).toContain(
      'Oracle:Choose one —\\n• Fork in the Road deals 3 damage to target creature.\\n• Destroy target creature.',
    );
  });

  /**
   * A mode is an effect list, so it chains the way a non-modal card's does. The
   * link is named under its own mode because two modes may each want a first
   * one, which is the whole reason the names carry a mode number at all.
   */
  it('chains a multi-effect mode under a link named for its mode', () => {
    const lines = linesOf(
      modalCard('tst-fork-chained', [
        {
          effects: [
            { kind: 'drawCards', count: 2, target: { kind: 'targetPlayer' } },
            { kind: 'loseLife', amount: 2, target: { kind: 'targetPlayer' } },
          ],
        },
        { effects: [{ kind: 'gainLife', amount: 3, target: { kind: 'targetPlayer' } }] },
      ]),
    );
    expect(lines).toContain(
      'SVar:Mode1:DB$ Draw | ValidTgts$ Player | NumCards$ 2 | SubAbility$ Mode1Effect1 | SpellDescription$ Target player draws two cards. Target player loses 2 life.',
    );
    expect(lines).toContain('SVar:Mode1Effect1:DB$ LoseLife | ValidTgts$ Player | LifeAmount$ 2');
  });

  /**
   * `RPrevent` is the corpus's own name for a prevention replacement and three
   * rows here define it. Two modes that want the identical definition get one
   * line, because the modes share the supporting-line list that
   * `appendAbilityLines` deduplicates.
   */
  it('writes one supporting SVar when two modes want the same definition', () => {
    const lines = linesOf(
      modalCard('tst-fork-shared-svar', [
        { effects: [{ kind: 'preventCombatDamageToYou' }] },
        {
          effects: [
            { kind: 'preventCombatDamageToYou' },
            { kind: 'gainLife', amount: 2, target: { kind: 'targetPlayer' } },
          ],
        },
      ]),
    );
    expect(lines.filter((line) => line.startsWith('SVar:RPrevent:'))).toHaveLength(1);
  });

  /**
   * Two modes wanting one name to mean different things is the hazard
   * `mtg-9111` wrote the guard for, and modes are where it is easiest to reach:
   * nothing about "prevent combat damage to you" and "prevent all damage to you
   * and your creatures" says they cannot be printed as two bullets of one card.
   */
  it('refuses two modes that define one supporting SVar differently', () => {
    expect(
      codesOf(
        modalCard('tst-fork-colliding-svar', [
          { effects: [{ kind: 'preventCombatDamageToYou' }] },
          { effects: [{ kind: 'preventAllDamageToYouAndCreaturesYouControl' }] },
        ]),
      ),
    ).toEqual(['COLLIDING_SVAR_DEFINITION']);
  });

  it('names the mode and the effect when one mode is unwritable', () => {
    const result = transpileCardScript(
      modalCard('tst-fork-unwritable', [
        { effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }] },
        {
          effects: [
            {
              kind: 'dealDamage',
              amount: { kind: 'countMatching', filter: { cardTypes: ['instant'] } },
              target: { kind: 'targetCreature' },
            },
          ],
        },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejections).toEqual([
      expect.objectContaining({
        code: 'UNMAPPED_COMPUTED_AMOUNT',
        cardId: 'tst-fork-unwritable',
        path: 'modes[1].effects[0].amount',
      }),
    ]);
  });
});
