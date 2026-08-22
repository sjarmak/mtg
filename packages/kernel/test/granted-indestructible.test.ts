/**
 * A static ability that hands another creature indestructible (`mtg-nhyv.74`).
 *
 * `grantKeyword.keyword` typed against the nine evergreen `KEYWORDS` until this
 * lane, and indestructible is not one of them — it is a keyword *ability*, the
 * wider family a card could only print on itself. So M11's Knight Exemplar was
 * refusable on one enum member: the +1/+1 half of its second paragraph already
 * ran, and the half after the "and" had no word.
 *
 * Widening a schema is the cheap half and the dangerous one. A card that
 * validates and a kernel that ignores the grant is worse than a refusal,
 * because the refusal is visible and the silence is not: `destroyPermanent` and
 * the CR 704.5g sweep both ask `hasKeywordAbility`, which reads
 * `Characteristics.keywordAbilities`, and a grant written into
 * `Characteristics.keywords` beside haste would have been accepted, rendered,
 * exported to Forge and then quietly disregarded by every rule that consumes
 * it. That is why the assertions below are all deaths and survivals rather than
 * characteristic reads.
 *
 * ## What each claim is a control for
 *
 * The Bear is the negative control on every one of them. A kernel that had
 * stopped destroying anything, or that granted the keyword to the whole board
 * rather than to Knights, passes a file with one creature in it.
 *
 * The last claim is the control on the *other* failure: indestructible granted
 * as immortality rather than as a continuous effect. The grant belongs to the
 * Exemplar's static ability in layer 6, so it is gone the instant the Exemplar
 * is, and the Knight that survived a destroy two lines earlier dies to the same
 * call. A kernel that stamped the keyword onto the object when the ability
 * first applied passes every claim above this one and fails this one.
 *
 * `-N/-N` to zero toughness is deliberately absent from the survivals:
 * CR 704.5f puts a creature with toughness 0 into the graveyard as a
 * state-based action rather than destroying it, and `destroyPermanent` reads
 * `zeroToughness` past the indestructible guard for exactly that reason.
 */
import { parseCard, validateCards, type Card } from '@mtg/dsl';
import {
  applyDamage,
  beginTrace,
  checkStateBasedActions,
  destroyPermanent,
  eventsOfType,
  powerOf,
  sacrificePermanent,
  scenario,
  toughnessOf,
  type Trace,
} from '@mtg/kernel';
import { describe, expect, it } from 'vitest';
import { oidOf } from './helpers';

/**
 * M11 #20, printed in full: the first-strike line, and both halves of the
 * second paragraph as the two statics one printed "and" is.
 *
 * One ability carries exactly one modification — `StaticModificationSchema` is
 * a discriminated union — so the conjunction is two abilities over one scope,
 * which is Goblin Chieftain's shape and reaches the same permanents because the
 * kernel walks every static independently.
 */
const KNIGHT_EXEMPLAR: Card = parseCard({
  kind: 'creature',
  id: 'ref-knight-exemplar',
  name: 'Knight Exemplar',
  rarity: 'rare',
  set: { code: 'REF', collectorNumber: 20 },
  manaCost: { generic: 1, W: 2 },
  colors: ['W'],
  subtypes: ['Human', 'Knight'],
  keywords: ['firstStrike'],
  abilities: [
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Knight',
      modification: { kind: 'statBonus', power: 1, toughness: 1 },
    },
    {
      kind: 'static',
      scope: 'otherCreaturesYouControl',
      subtype: 'Knight',
      modification: { kind: 'grantKeyword', keyword: 'indestructible' },
    },
  ],
  power: 2,
  toughness: 2,
});

/** A plain Knight, so the grant has somewhere to land that did not print it. */
const SQUIRE: Card = parseCard({
  kind: 'creature',
  id: 'ref-knight-squire',
  name: 'Reference Squire',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 21 },
  manaCost: { generic: 2 },
  colors: [],
  subtypes: ['Human', 'Knight'],
  power: 2,
  toughness: 2,
});

/** The negative control: a creature you control that is not a Knight. */
const BEAR: Card = parseCard({
  kind: 'creature',
  id: 'ref-bear',
  name: 'Reference Bear',
  rarity: 'common',
  set: { code: 'REF', collectorNumber: 22 },
  manaCost: { generic: 2 },
  colors: [],
  subtypes: ['Bear'],
  power: 2,
  toughness: 2,
});

function board(): Trace {
  return beginTrace(
    scenario({
      battlefield: [
        { card: KNIGHT_EXEMPLAR, controller: 0 },
        { card: SQUIRE, controller: 0 },
        { card: BEAR, controller: 0 },
      ],
    }).state,
  );
}

describe('Knight Exemplar authored in full', () => {
  it('validates with no violations', () => {
    expect(validateCards([KNIGHT_EXEMPLAR])).toEqual([]);
  });

  it('gives its Knights the stats and the keyword its two statics name', () => {
    const trace = board();
    const squire = oidOf(trace.state, 'Reference Squire');
    const bear = oidOf(trace.state, 'Reference Bear');

    expect([powerOf(trace.state, squire), toughnessOf(trace.state, squire)]).toEqual([3, 3]);
    expect([powerOf(trace.state, bear), toughnessOf(trace.state, bear)]).toEqual([2, 2]);
  });
});

describe('a granted indestructible on the kernel', () => {
  it('survives a destroy that takes the non-Knight beside it', () => {
    const trace = board();
    const squire = oidOf(trace.state, 'Reference Squire');
    const bear = oidOf(trace.state, 'Reference Bear');

    const swept = destroyPermanent(destroyPermanent(trace, squire, 'destroyEffect'), bear, 'destroyEffect');

    expect(swept.state.objects[squire]?.zone).toBe('battlefield');
    expect(swept.state.objects[bear]?.zone).toBe('graveyard');
    expect(eventsOfType(swept.events, 'permanentDestroyed').map((event) => event.oid)).toEqual([bear]);
  });

  it('survives lethal damage the state-based sweep kills the non-Knight for', () => {
    const trace = board();
    const exemplar = oidOf(trace.state, 'Knight Exemplar');
    const squire = oidOf(trace.state, 'Reference Squire');
    const bear = oidOf(trace.state, 'Reference Bear');

    const swept = checkStateBasedActions(
      applyDamage(trace, [
        {
          sourceOid: exemplar,
          controller: 0,
          recipient: { kind: 'permanent', oid: squire },
          amount: 5,
          deathtouch: false,
          lifelink: false,
          combat: false,
        },
        {
          sourceOid: exemplar,
          controller: 0,
          recipient: { kind: 'permanent', oid: bear },
          amount: 5,
          deathtouch: false,
          lifelink: false,
          combat: false,
        },
      ]),
    );

    expect(swept.state.objects[squire]?.zone).toBe('battlefield');
    expect(swept.state.objects[squire]?.damage).toBe(5);
    expect(swept.state.objects[bear]?.zone).toBe('graveyard');
  });

  it('does not stop a sacrifice, which is a cost rather than a destruction', () => {
    const trace = board();
    const squire = oidOf(trace.state, 'Reference Squire');

    const sacrificed = sacrificePermanent(trace, squire, 0);

    expect(sacrificed.state.objects[squire]?.zone).toBe('graveyard');
    expect(eventsOfType(sacrificed.events, 'permanentDestroyed')).toHaveLength(0);
  });

  it('is gone the moment the source of the static ability is', () => {
    const trace = board();
    const exemplar = oidOf(trace.state, 'Knight Exemplar');
    const squire = oidOf(trace.state, 'Reference Squire');

    const orphaned = destroyPermanent(trace, exemplar, 'destroyEffect');
    expect(orphaned.state.objects[exemplar]?.zone).toBe('graveyard');
    expect([powerOf(orphaned.state, squire), toughnessOf(orphaned.state, squire)]).toEqual([2, 2]);

    const killed = destroyPermanent(orphaned, squire, 'destroyEffect');
    expect(killed.state.objects[squire]?.zone).toBe('graveyard');
  });
});
