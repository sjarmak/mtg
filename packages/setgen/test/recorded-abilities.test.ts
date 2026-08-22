/**
 * The recorded Hearthglass Vigil run, replayed and then *played*.
 *
 * This is the end-to-end form of the invariant the whole lab rests on: the set
 * generator's output space stays inside the engine's enforceable space. Every other
 * test in this package checks one hop of it — the allocator reserves a slot, the
 * prompt explains an ability, the schema offers one, the validators read it
 * back. None of them shows that what came out of a model is a card the kernel
 * can run, because none of them puts a generated card on a battlefield.
 *
 * So this file does. `fixtures/llm-hearthglass/` holds every request/response
 * pair from one live `claude-cli` run of a brief whose mechanics are stated as
 * ability kinds; the run replays for free, and every ability it produced is
 * driven through `@mtg/kernel` by the condition or cost it was printed with. A
 * static has to change what `powerOf` and `hasKeyword` report, a trigger has to
 * reach the stack when its condition happens, and an activation has to be
 * offered, paid for and resolved.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createFixtureProvider } from '@mtg/llm';
import {
  assertNever,
  BASIC_LAND_FOR_COLOR,
  cardManaValue,
  manaValue,
  parseCard,
  validateCard,
} from '@mtg/dsl';
import type { Ability, Card, Color, StaticAbility, TriggerCondition } from '@mtg/dsl';
import { SLICE_PROFILE_VERSION } from '@mtg/design-data';
import type { SkeletonLiteProfile } from '@mtg/design-data';
import { generateSet, parseBrief } from '@mtg/setgen';
import type { GameState, ObjectId, PlayerId } from '@mtg/kernel';
import {
  getObject,
  hasGrantableKeyword,
  legalActions,
  playerOf,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
} from '@mtg/kernel';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(PACKAGE_ROOT, 'fixtures', 'llm-hearthglass');
const BRIEF_PATH = join(PACKAGE_ROOT, 'briefs', 'hearthglass-vigil.json');
const BRIEF = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);

/**
 * The skeleton this run was recorded against, committed under `fixtures/skeletons/`.
 *
 * A fixture key is a hash of the request, the request is built from the
 * allocation, and the allocation comes out of `deriveSkeletonLite`. So a
 * correction to the derivation moves every key in this directory at once, and
 * the run stops replaying for a reason that has nothing to do with what it is
 * testing. That is not hypothetical: `mtg-dkgd` corrected the order the
 * colorless and colored shares are taken in, size 20 moved from three commons a
 * color and no colorless card to two and five, and all twenty-one keys here
 * went stale. Re-recording costs a live model run.
 *
 * A recording that depends on a derivation should say so. `generateSet` already
 * takes the profile as an option, for exactly the case where the caller has one
 * in hand, so this run hands it the profile it was recorded under instead of
 * silently accepting whatever today's derivation produces. The pin is the same
 * discipline as a pinned pool digest: the measurement declares the bytes it was
 * taken on. Future corrections to the split are free to move; this run is
 * pinned to 2026-08-12 and replays until somebody pays to record it again.
 *
 * It lives one directory over rather than in `llm-hearthglass/` because every
 * file in there is a recorded call keyed by the hash of its own request, and
 * `recorded-set.test.ts` asserts exactly that over `fixtures/llm*`. A skeleton
 * is not a call.
 */
const SKELETON_PATH = join(PACKAGE_ROOT, 'fixtures', 'skeletons', 'hearthglass-vigil-at-20.json');
const SKELETON = loadSkeleton();

/**
 * Reads the pinned skeleton, refusing one that is not the shape this replay needs.
 *
 * Two things about it are load-bearing and neither is enforced by a type
 * assertion on parsed JSON: the size the brief builds at, and the profile
 * version the rest of the package's readers expect. A pin that drifts from
 * either would replay against a skeleton nobody derived.
 */
function loadSkeleton(): SkeletonLiteProfile {
  const parsed = JSON.parse(readFileSync(SKELETON_PATH, 'utf8')) as SkeletonLiteProfile;
  if (parsed.version !== SLICE_PROFILE_VERSION) {
    throw new Error(
      `${SKELETON_PATH}: pinned skeleton is version ${String(parsed.version)}, ` +
        `this checkout reads ${SLICE_PROFILE_VERSION}`,
    );
  }
  if (parsed.setSize !== BRIEF.targetSize) {
    throw new Error(
      `${SKELETON_PATH}: pinned skeleton is for ${String(parsed.setSize)} cards, ` +
        `the brief builds ${BRIEF.targetSize}`,
    );
  }
  return parsed;
}

function basic(color: Color): Card {
  const type = BASIC_LAND_FOR_COLOR[color];
  return parseCard({
    id: `hrt-basic-${color.toLowerCase()}`,
    name: type,
    kind: 'land',
    rarity: 'common',
    set: { code: 'HRT', collectorNumber: 900 },
    supertypes: ['basic'],
    basicLandType: type,
    producesMana: [color],
  });
}

/** A vanilla body for the group statics to modify, of a stated creature type. */
function bystander(subtype: string | null): Card {
  return parseCard({
    id: 'hrt-watch-hound',
    name: 'Watch Hound',
    kind: 'creature',
    rarity: 'common',
    set: { code: 'HRT', collectorNumber: 901 },
    manaCost: { generic: 2 },
    subtypes: subtype === null ? ['Hound'] : [subtype],
    power: 2,
    toughness: 2,
  });
}

/** Kills a creature, so a `selfDies` trigger has something to watch. */
const EXECUTION = parseCard({
  id: 'hrt-last-watch',
  name: 'Last Watch',
  kind: 'instant',
  rarity: 'common',
  set: { code: 'HRT', collectorNumber: 902 },
  colors: ['B'],
  manaCost: { generic: 1, B: 1 },
  effects: [{ kind: 'destroyPermanent', target: { kind: 'targetCreature' } }],
});

const PASS = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
] as const;

function oidOf(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

/** Enough basics to pay a cost of this mana value, in the colors it names. */
function landsFor(
  card: Card,
  controller: PlayerId,
): { readonly card: Card; readonly controller: PlayerId }[] {
  const colors: Color[] =
    card.kind === 'land'
      ? []
      : (['W', 'U', 'B', 'R', 'G'] as const).flatMap((color) =>
          Array.from({ length: card.manaCost[color] }, () => color),
        );
  const total = Math.max(cardManaValue(card) + 4, colors.length + 4);
  const filler = colors.length > 0 ? (colors[0] ?? 'W') : 'W';
  const spread = [...colors, ...Array.from({ length: total - colors.length }, () => filler)];
  return spread.map((color) => ({ card: basic(color), controller }));
}

/** Stack entries the kernel put there as abilities rather than spells. */
function abilitiesOnStack(state: GameState): number {
  return state.stack.filter((entry) => entry.ability !== null).length;
}

interface Played {
  readonly card: Card;
  readonly ability: Ability;
  /** One line naming what the kernel did, printed when the assertion fails. */
  readonly what: string;
}

/** A static's modification, read back off the board the kernel resolved. */
function playStatic(card: Card, ability: StaticAbility): string {
  const other = bystander(ability.subtype);
  const start = scenario({
    battlefield: [
      { card, controller: 0 },
      ...(ability.scope === 'self' ? [] : [{ card: other, controller: 0 as PlayerId }]),
    ],
  }).state;
  const subject = ability.scope === 'self' ? oidOf(start, card.name) : oidOf(start, other.name);
  const printedPower = ability.scope === 'self' ? (card.power ?? 0) : 2;
  const printedToughness = ability.scope === 'self' ? (card.toughness ?? 0) : 2;

  if (ability.modification.kind === 'statBonus') {
    expect(powerOf(start, subject), `${card.name}: power`).toBe(printedPower + ability.modification.power);
    expect(toughnessOf(start, subject), `${card.name}: toughness`).toBe(
      printedToughness + ability.modification.toughness,
    );
    return `${card.name}: ${String(printedPower)}/${String(printedToughness)} became ${String(powerOf(start, subject))}/${String(toughnessOf(start, subject))}`;
  }
  if (ability.modification.kind === 'grantKeyword') {
    // `hasGrantableKeyword` rather than `hasKeyword`: the printed modification
    // reaches the keyword abilities as well as the evergreen nine, and a
    // recorded fixture can only carry the nine (`ModelStaticModificationSchema`
    // stays narrow), so the wider reader answers the same question here and
    // keeps answering it if the model tier ever widens.
    const keyword = ability.modification.keyword;
    expect(hasGrantableKeyword(start, subject, keyword), `${card.name}: ${keyword}`).toBe(true);
    return `${card.name}: granted ${keyword}`;
  }
  // `definePt` is off the generator's schema (`ModelStaticModificationSchema`,
  // `ability-shape.ts`), so a recorded fixture never carries one — but
  // `StaticAbility.modification` is typed over the engine's full
  // `StaticModification`, so this branch still has to exist for `assertNever`
  // below to see an exhaustively narrowed `never`. The two CR 614 doublers are
  // off the generator's schema for the same reason and join it here: what this
  // helper does is *play* the modification and read the board afterward, and
  // neither doubler changes a board — it changes the next damage or life-gain
  // event, which is a thing that has not happened yet. The seven CR 508/509
  // combat modifications join them for the same containment reason
  // (`static-modification-class.ts`'s `'combat'` class is entirely
  // hand-authored-only) — playing one is a fact about attacking and blocking,
  // not about the board state this helper reads afterward, and would need
  // `combat.ts`'s legality machinery rather than this fixture-replay harness.
  if (
    ability.modification.kind === 'definePt' ||
    ability.modification.kind === 'doubleDamage' ||
    ability.modification.kind === 'doubleLifeGain' ||
    ability.modification.kind === 'cantAttack' ||
    ability.modification.kind === 'cantBlock' ||
    ability.modification.kind === 'cantBeBlocked' ||
    ability.modification.kind === 'attacksEachCombatIfAble' ||
    ability.modification.kind === 'mustBeBlockedIfAble' ||
    ability.modification.kind === 'blockOnlyCreaturesWithKeyword' ||
    ability.modification.kind === 'cantBeBlockedBySubtype' ||
    ability.modification.kind === 'statBonusPer'
  ) {
    throw new Error(
      `${card.name}: ${ability.modification.kind} is off the generator's schema and should never reach a recorded fixture`,
    );
  }
  return assertNever(ability.modification, 'playStatic');
}

/** A trigger's condition, made to happen. */
function playTriggered(card: Card, condition: TriggerCondition): string {
  if (condition === 'selfEnters') {
    const start = scenario({
      battlefield: landsFor(card, 0),
      hands: [[card], []],
    }).state;
    const oid = playerOf(start, 0).hand[0];
    if (oid === undefined) throw new Error(`${card.name} is not in hand`);
    const cast = reduce(start, { type: 'castSpell', player: 0, oid, targets: [] });
    const resolved = reduceAll(cast.state, [...PASS]).state;
    expect(abilitiesOnStack(resolved), `${card.name}: no enters trigger reached the stack`).toBe(1);
    const settled = reduceAll(resolved, [...PASS]).state;
    expect(abilitiesOnStack(settled)).toBe(0);
    return `${card.name}: entered, its trigger reached the stack and resolved`;
  }

  if (condition === 'selfAttacks' || condition === 'controlledCreatureAttacksAlone') {
    const start = scenario({
      battlefield: [{ card, controller: 0 }, ...landsFor(card, 0)],
      active: 0,
      step: 'declareAttackers',
    }).state;
    const attacker = oidOf(start, card.name);
    const declared = reduce(start, {
      type: 'declareAttackers',
      player: 0,
      attackers: [{ oid: attacker, defender: 1 }],
    });
    expect(abilitiesOnStack(declared.state), `${card.name}: no attack trigger reached the stack`).toBe(1);
    return `${card.name}: attacked alone and its trigger reached the stack`;
  }

  const start = scenario({
    battlefield: [{ card, controller: 0 }, ...landsFor(EXECUTION, 0)],
    hands: [[EXECUTION], []],
  }).state;
  const victim = oidOf(start, card.name);
  const removal = playerOf(start, 0).hand[0];
  if (removal === undefined) throw new Error('Last Watch is not in hand');
  const cast = reduce(start, {
    type: 'castSpell',
    player: 0,
    oid: removal,
    targets: [{ kind: 'permanent', oid: victim }],
  });
  const dead = reduceAll(cast.state, [...PASS]).state;
  expect(getObject(dead, victim).zone).toBe('graveyard');
  expect(abilitiesOnStack(dead), `${card.name}: no death trigger reached the stack`).toBe(1);
  return `${card.name}: died and its trigger reached the stack`;
}

/** An activation, offered by the kernel and paid through it. */
function playActivated(card: Card, ability: Extract<Ability, { kind: 'activated' }>): string {
  const start = scenario({
    battlefield: [
      { card, controller: 0 },
      { card: bystander(null), controller: 0 },
      ...landsFor(card, 0),
      ...Array.from({ length: manaValue(ability.cost.mana) + 2 }, () => ({
        card: basic('W'),
        controller: 0 as PlayerId,
      })),
    ],
  }).state;
  const source = oidOf(start, card.name);
  const activation = legalActions(start).find(
    (action) => action.type === 'activateAbility' && action.oid === source,
  );
  if (activation === undefined) throw new Error(`${card.name}: the kernel offered no activation`);

  const activated = reduce(start, activation);
  expect(abilitiesOnStack(activated.state), `${card.name}: the activation did not reach the stack`).toBe(1);
  if (ability.cost.sacrificeSelf) {
    expect(getObject(activated.state, source).zone).not.toBe('battlefield');
  }
  if (ability.cost.tapSelf) expect(getObject(activated.state, source).tapped).toBe(true);
  const settled = reduceAll(activated.state, [...PASS]).state;
  expect(abilitiesOnStack(settled), `${card.name}: the activation never resolved`).toBe(0);
  return `${card.name}: activation offered, paid and resolved`;
}

function play(card: Card, ability: Ability): Played {
  switch (ability.kind) {
    case 'static':
      return { card, ability, what: playStatic(card, ability) };
    case 'triggered':
      return { card, ability, what: playTriggered(card, ability.condition) };
    case 'activated':
      return { card, ability, what: playActivated(card, ability) };
  }
}

describe('the recorded Hearthglass Vigil run', () => {
  let cards: readonly Card[] = [];
  let report: Awaited<ReturnType<typeof generateSet>>['report'] | undefined;
  let nwo: Awaited<ReturnType<typeof generateSet>>['validation']['nwo'] | undefined;

  beforeAll(async () => {
    expect(existsSync(FIXTURE_DIR), `no recorded fixtures at ${FIXTURE_DIR}`).toBe(true);
    const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });
    const result = await generateSet({ provider, brief: BRIEF, profile: SKELETON });
    cards = result.cards;
    report = result.report;
    nwo = result.validation.nwo;
  }, 60_000);

  it('replays to an enforceable set whose mechanics are printed as abilities', () => {
    expect(cards).toHaveLength(20);
    expect(report?.findings.filter((item) => item.severity === 'error')).toStrictEqual([]);
    expect(report?.enforceable).toBe(true);
    expect(report?.legalCards).toBe(20);
  });

  /**
   * The New World Order allowance, spent to the last card.
   *
   * A trigger or an activation on a common is a red flag, so the three commons
   * this run prints an ability on are the three flagged cards, and at fifteen
   * commons the profile's 20% budget is three. The set is on the line, not under
   * it: one more ability-bearing common at this size fails the set. That is a
   * design fact worth failing on if it moves - either the abilities come down or
   * the common pool goes up - and it was invisible while nothing asserted it.
   */
  it('spends the whole New World Order allowance and stays inside it', () => {
    expect(nwo?.commons).toBe(15);
    expect(nwo?.flagged.map((flag) => flag.rules)).toStrictEqual([
      ['trackedAbility'],
      ['trackedAbility'],
      ['trackedAbility'],
    ]);
    expect(nwo?.budget).toBe(3);
    expect(nwo?.findings).toStrictEqual([]);
  });

  it('printed the abilities on permanents the DSL calls enforceable', () => {
    const withAbilities = cards.filter((card) => card.abilities.length > 0);
    expect(withAbilities.length).toBeGreaterThan(0);
    for (const card of withAbilities) {
      expect(['creature', 'artifact']).toContain(card.kind);
      expect(validateCard(card), `${card.name} is not enforceable`).toStrictEqual([]);
      expect(card.oracleText ?? '').not.toBe('');
    }
  });

  /**
   * Not one of each kind. Vigil names two kinds and a card prints one of them,
   * so a run that never reaches for a static is a run the brief allows, and
   * this one is: every Vigil card came back as a trigger. What the brief does
   * promise is that no card prints a kind no mechanic asked for, and that every
   * mechanic naming kinds is printed in one of the kinds it named. The kinds
   * this run actually reached are pinned at the end, so a re-record that drops
   * one fails here rather than passing on a weaker claim.
   */
  it('printed a kind for every mechanic that named one, and no kind none of them named', () => {
    const printed = new Set(cards.flatMap((card) => card.abilities.map((ability) => ability.kind)));
    const asked = BRIEF.mechanics.filter((mechanic) => mechanic.abilityKinds.length > 0);
    expect(asked.length).toBeGreaterThan(0);
    for (const mechanic of asked) {
      expect(
        mechanic.abilityKinds.some((kind) => printed.has(kind)),
        `${mechanic.name} asked for ${mechanic.abilityKinds.join(' or ')} and got none of them`,
      ).toBe(true);
    }
    const anyAsked = asked.flatMap((mechanic) => [...mechanic.abilityKinds]);
    for (const kind of printed) expect(anyAsked).toContain(kind);
    expect([...printed].sort()).toStrictEqual(['activated', 'triggered']);
  });

  /**
   * The claim this file exists for. Nothing here is a fixture the test wrote:
   * every card is model output, replayed, and every ability is driven by the
   * condition or cost it was printed with.
   */
  it('plays every generated ability in a kernel game', () => {
    const played = cards.flatMap((card) => card.abilities.map((ability) => play(card, ability)));
    expect(played.length).toBe(6);
    for (const item of played) expect(item.what).not.toBe('');
  });

  /**
   * One card, spelled out, because a loop over six cards can pass while saying
   * nothing about any of them. Lampwick Stoker is what the generator made of
   * "a permanent pays itself away, or taps its own heat, for a burst of fire".
   * It pays itself away: the cost is the card, so the board it leaves behind is
   * part of what has to be right.
   */
  it('offers Lampwick Stoker its own line, and the damage lands where it points', () => {
    const stoker = cards.find((card) => card.name === 'Lampwick Stoker');
    if (stoker === undefined) throw new Error('the recorded set has no Lampwick Stoker');
    expect(stoker.oracleText).toBe(
      'Sacrifice Lampwick Stoker: Lampwick Stoker deals 2 damage to any target.',
    );

    const start = scenario({
      battlefield: [{ card: stoker, controller: 0 }, ...landsFor(stoker, 0)],
    }).state;
    const source = oidOf(start, stoker.name);
    const atOpponent = legalActions(start).find(
      (action) =>
        action.type === 'activateAbility' &&
        action.oid === source &&
        action.targets.some((target) => target?.kind === 'player' && target.player === 1),
    );
    if (atOpponent === undefined) throw new Error('the stoker offered no activation aimed at the opponent');

    const activated = reduce(start, atOpponent);
    expect(getObject(activated.state, source).zone).toBe('graveyard');
    const settled = reduceAll(activated.state, [...PASS]).state;
    expect(playerOf(settled, 1).life).toBe(playerOf(start, 1).life - 2);
  });
});

/**
 * The drivers above, run over hand-written cards.
 *
 * Every branch of `play` has to be a branch something enters, and the recorded
 * run reaches only some of them: all three trigger conditions, one activation
 * cost, and no static at all. These six cards enter the rest, so a driver that
 * would silently pass a future re-record fails here instead. They are the only
 * cards in this file a person wrote, and they assert nothing about the
 * generator.
 */
describe('the drivers themselves', () => {
  const permanent = (name: string, abilities: readonly Ability[], subtypes: readonly string[] = []): Card =>
    parseCard({
      id: `hrt-driver-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      kind: 'creature',
      rarity: 'common',
      set: { code: 'HRT', collectorNumber: 903 },
      manaCost: { generic: 2 },
      subtypes,
      power: 2,
      toughness: 2,
      abilities,
    });

  it('reads a self static back off the layer system', () => {
    const card = permanent('Driver Selfbonus', [
      {
        kind: 'static',
        scope: 'self',
        subtype: null,
        modification: { kind: 'statBonus', power: 2, toughness: 0 },
      },
    ]);
    expect(playStatic(card, card.abilities[0] as StaticAbility)).toContain('2/2 became 4/2');
  });

  it('reads a granted keyword back off the layer system', () => {
    const card = permanent('Driver Grant', [
      {
        kind: 'static',
        scope: 'creaturesYouControl',
        subtype: 'Hound',
        modification: { kind: 'grantKeyword', keyword: 'flying' },
      },
    ]);
    expect(playStatic(card, card.abilities[0] as StaticAbility)).toContain('granted flying');
  });

  it('drives an enters trigger by casting the card', () => {
    const card = permanent('Driver Enters', [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(playTriggered(card, 'selfEnters')).toContain('entered');
  });

  it('drives an attack trigger by declaring attackers', () => {
    const card = permanent('Driver Attacks', [
      {
        kind: 'triggered',
        condition: 'selfAttacks',
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(playTriggered(card, 'selfAttacks')).toContain('attacked');
  });

  it('drives a death trigger by killing the card', () => {
    const card = permanent('Driver Dies', [
      {
        kind: 'triggered',
        condition: 'selfDies',
        effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    expect(playTriggered(card, 'selfDies')).toContain('died');
  });

  it('drives an activation whose only cost is mana', () => {
    const card = permanent('Driver Mana', [
      {
        kind: 'activated',
        cost: {
          mana: { generic: 2, W: 0, U: 0, B: 0, R: 0, G: 0, hasX: false },
          tapSelf: false,
          sacrificeSelf: false,
        },
        effects: [{ kind: 'gainLife', amount: 1, target: { kind: 'noTarget' } }],
      },
    ]);
    const ability = card.abilities[0];
    if (ability?.kind !== 'activated') throw new Error('the driver card lost its activation');
    expect(playActivated(card, ability)).toContain('resolved');
  });
});
