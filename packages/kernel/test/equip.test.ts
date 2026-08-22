/**
 * Attachment, played end to end: cast a weapon, equip it, keep it through the
 * death of what it was equipping, and equip it again.
 *
 * Decision 12 of the set design document is "attachment is for the
 * named weapons only, roughly eight cards. No twenty-Equipment support
 * structure, no durability mechanic." So this slice is four rules and no
 * subsystem: CR 702.6b's equip ability, CR 613's layers 6 and 7c for what being
 * equipped does, and CR 704.5m / 301.5c for when the attachment ends.
 *
 * Nothing here is an attachment-shaped special case in the layer walk. The
 * bonus is one record in `state.continuous` whose `affects` names the equipped
 * creature, which is the record a lord registers and the record a pump resolves
 * into, and `effectsApplyingTo` below is the assertion that the layer system
 * rather than this file did the arithmetic.
 *
 * `fuse.test.ts`, `monster-drop.test.ts` and `chest-and-keys.test.ts` are the
 * three vertical slices this one is written to read like.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '@mtg/dsl';
import { parseCard } from '@mtg/dsl';
import type { Action, GameEvent, GameState, ObjectId, Target } from '@mtg/kernel';
import {
  attachmentOf,
  deriveLayers,
  effectsApplyingTo,
  getObject,
  hasKeyword,
  IllegalActionError,
  legalActions,
  objectFilter,
  powerOf,
  reduce,
  reduceAll,
  scenario,
  toughnessOf,
  validateAction,
} from '@mtg/kernel';
import { creature, FOREST, instant, lands } from './cards';
import { abilities as abilityChange, pump, retype, setPt, withContinuous } from './continuous-helpers';

/**
 * "Fifteen named weapons" is what the design document lists and this is the one
 * at the top of it. One printed clause, two printed lines: `Equipped creature
 * gets +2/+0.` and `Equip {2}`.
 */
const MOONBLADE: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-moonblade',
  name: 'Moonblade',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 1 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 2 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
  ],
});

/** The other half of the vocabulary: a weapon that grants a keyword. */
const SCIMITAR_OF_THE_DUNES: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-scimitar-of-the-dunes',
  name: 'Scimitar of the Dunes',
  rarity: 'rare',
  set: { code: 'XMP', collectorNumber: 2 },
  manaCost: { generic: 2 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'grantKeyword', keyword: 'firstStrike' }] },
      effects: [],
    },
  ],
});

/**
 * A weapon that can leave the battlefield under its own power.
 *
 * No DSL v1 effect can point at a noncreature permanent — `destroyPermanent`
 * and `returnToHand` are both `targetCreature` in `LEGAL_TARGETS` — so a test
 * that needs an Equipment gone while it is attached has to be handed a card
 * that spends itself. The second ability is an ordinary sacrifice activation,
 * not a durability mechanic: the equip clause itself is refused a sacrifice
 * cost, because CR 601.2h would pay it before the attachment happened.
 */
const BRIGAND_ARM: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-brigand-arm',
  name: 'Brigand Arm',
  rarity: 'common',
  set: { code: 'XMP', collectorNumber: 3 },
  manaCost: { generic: 1 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: { modifications: [{ kind: 'statBonus', power: 2, toughness: 0 }] },
      effects: [],
    },
    {
      kind: 'activated',
      cost: { mana: { generic: 1 }, sacrificeSelf: true },
      effects: [{ kind: 'gainLife', amount: 2, target: { kind: 'noTarget' } }],
    },
  ],
});

/**
 * The weapon that carries two modifications, printed in the order that would be
 * wrong if the array decided: the layer-7c stat bonus first, the layer-6
 * keyword grant second.
 *
 * Last-Blow Obliterator is the card, and `+99/-3` and deathtouch is what
 * The playtester asked it to print. The numbers are the card's, not a test's
 * convenience: a weapon that can only be spelled once the clause holds a list
 * is the whole reason the list exists.
 */
const LAST_BLOW_OBLITERATOR: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-last-blow-obliterator',
  name: 'Last-Blow Obliterator',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 4 },
  supertypes: ['legendary'],
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: {
        modifications: [
          { kind: 'statBonus', power: 99, toughness: -3 },
          { kind: 'grantKeyword', keyword: 'deathtouch' },
        ],
      },
      effects: [],
    },
  ],
});

/** The same card with the clause written the other way round. */
const OBLITERATOR_REVERSED: Card = parseCard({
  kind: 'artifact',
  id: 'xmp-last-blow-obliterator-reversed',
  name: 'Last-Blow Obliterator Reversed',
  rarity: 'uncommon',
  set: { code: 'XMP', collectorNumber: 5 },
  manaCost: { generic: 3 },
  subtypes: ['Equipment'],
  abilities: [
    {
      kind: 'activated',
      cost: { mana: { generic: 1 } },
      attach: {
        modifications: [
          { kind: 'grantKeyword', keyword: 'deathtouch' },
          { kind: 'statBonus', power: 99, toughness: -3 },
        ],
      },
      effects: [],
    },
  ],
});

const KAELEN = creature('Kaelen', 2, 2, { cost: { generic: 1 } });
const SERAPHINE = creature('Seraphine', 1, 3, { cost: { generic: 1 } });
const ANCIENT_BLADE = instant('Ancient Blade', [
  { kind: 'destroyPermanent', target: { kind: 'targetCreature' } },
]);

const PASS: readonly Action[] = [
  { type: 'passPriority', player: 0 },
  { type: 'passPriority', player: 1 },
];

function named(state: GameState, name: string): ObjectId {
  const found = state.battlefield.find((oid) => state.objects[oid]?.card.name === name);
  if (found === undefined) throw new Error(`no battlefield object named ${name}`);
  return found;
}

function board(spec: { readonly weapon?: Card; readonly hand?: readonly Card[] } = {}): GameState {
  return scenario({
    battlefield: [
      { card: KAELEN, controller: 0 },
      { card: SERAPHINE, controller: 0 },
      ...lands(FOREST, 8).map((card) => ({ card, controller: 0 as const })),
    ],
    hands: [[spec.weapon ?? MOONBLADE, ...(spec.hand ?? [])], []],
  }).state;
}

interface Played {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** Casts the card in hand at `index` and lets it resolve. */
function castFromHand(state: GameState, index: number, targets: readonly (Target | null)[] = []): Played {
  const oid = state.players[0].hand[index];
  if (oid === undefined) throw new Error(`nothing in hand at index ${index}`);
  const cast = reduce(state, { type: 'castSpell', player: 0, oid, targets });
  const settled = reduceAll(cast.state, PASS);
  return { state: settled.state, events: [...cast.events, ...settled.events] };
}

/** The equip activation aimed at one creature, or `undefined` when none is offered. */
function equipAction(state: GameState, weapon: ObjectId, host: ObjectId): Action | undefined {
  return legalActions(state).find(
    (action) =>
      action.type === 'activateAbility' &&
      action.oid === weapon &&
      action.targets.some((target) => target?.kind === 'permanent' && target.oid === host),
  );
}

/** Pays for an equip and lets it resolve. */
function equip(state: GameState, weapon: ObjectId, host: ObjectId): Played {
  const action = equipAction(state, weapon, host);
  if (action === undefined) throw new Error(`no equip was offered for ${weapon} onto ${host}`);
  const activated = reduce(state, action);
  const settled = reduceAll(activated.state, PASS);
  return { state: settled.state, events: [...activated.events, ...settled.events] };
}

/** Casts the weapon in hand and returns the board with it on the battlefield. */
function armed(spec: { readonly weapon?: Card; readonly hand?: readonly Card[] } = {}): {
  readonly state: GameState;
  readonly weapon: ObjectId;
} {
  const card = spec.weapon ?? MOONBLADE;
  const state = castFromHand(board(spec), 0).state;
  return { state, weapon: named(state, card.name) };
}

describe('a named weapon', () => {
  it('is cast, equipped through the menu, and paid for by the layer system', () => {
    const start = board();
    const link = named(start, 'Kaelen');
    const trace: string[] = [];

    const summoned = castFromHand(start, 0);
    trace.push(...summoned.events.map((event) => event.type));
    const sword = named(summoned.state, 'Moonblade');

    expect(powerOf(summoned.state, link)).toBe(2);
    expect(attachmentOf(summoned.state, sword)).toBeUndefined();

    const equipped = equip(summoned.state, sword, link);
    trace.push(...equipped.events.map((event) => event.type));

    // The object says what it is attached to, and the layer walk says what that
    // is worth: `effectsApplyingTo` is the derivation's own record of which
    // effects caught this permanent, so a `ptMod` in it is the layer system
    // answering rather than this test adding two.
    expect(attachmentOf(equipped.state, sword)).toBe(link);
    const applying = effectsApplyingTo(equipped.state, link);
    expect(applying.map((effect) => effect.kind)).toStrictEqual(['ptMod']);
    expect(applying[0]?.sourceOid).toBe(sword);
    expect(applying[0]?.layer).toBe('7c');
    expect(powerOf(equipped.state, link)).toBe(4);
    expect(toughnessOf(equipped.state, link)).toBe(2);

    // The whole run, and two things about it are the assertion rather than the
    // length. The equip half is `abilityActivated` through `resolutionBegan`,
    // which is the same five lines a Fuse or a Chest writes: the mana is paid
    // on activation (CR 601.2h), the ability waits on the stack, and both
    // players pass before it resolves. And there is no attachment event in it,
    // which is deliberate — `attach.ts` says why the record appearing is not a
    // game event, and the `abilityActivated` above carries the chosen target a
    // replay needs.
    expect(trace).toStrictEqual([
      'permanentTapped',
      'manaProduced',
      'permanentTapped',
      'manaProduced',
      'manaPaid',
      'zoneChanged',
      'spellCast',
      'priorityPassed',
      'priorityGained',
      'priorityPassed',
      'resolutionBegan',
      'zoneChanged',
      'permanentEntered',
      'priorityGained',
      'permanentTapped',
      'manaProduced',
      'permanentTapped',
      'manaProduced',
      'manaPaid',
      'abilityActivated',
      'priorityPassed',
      'priorityGained',
      'priorityPassed',
      'resolutionBegan',
      'priorityGained',
    ]);
  });

  it('survives the creature it equipped, unattached and on the battlefield', () => {
    const { state, weapon } = armed({ hand: [ANCIENT_BLADE] });
    const link = named(state, 'Kaelen');
    const seraphine = named(state, 'Seraphine');
    const equipped = equip(state, weapon, link).state;
    expect(powerOf(equipped, link)).toBe(4);

    // CR 704.5m: the creature dies, the Equipment does not go with it.
    const killed = castFromHand(equipped, 0, [{ kind: 'permanent', oid: link }]).state;
    expect(getObject(killed, link).zone).toBe('graveyard');
    expect(getObject(killed, weapon).zone).toBe('battlefield');
    expect(attachmentOf(killed, weapon)).toBeUndefined();
    // The bonus went with the attachment rather than outliving it as a record
    // pointing at a dead creature.
    expect(killed.continuous.filter((effect) => effect.sourceOid === weapon)).toStrictEqual([]);

    const again = equip(killed, weapon, seraphine).state;
    expect(attachmentOf(again, weapon)).toBe(seraphine);
    expect(powerOf(again, seraphine)).toBe(3);
    expect(toughnessOf(again, seraphine)).toBe(3);
  });

  it('moves the bonus with it when it is equipped to a second creature', () => {
    const { state, weapon } = armed();
    const link = named(state, 'Kaelen');
    const seraphine = named(state, 'Seraphine');

    const first = equip(state, weapon, link).state;
    expect(powerOf(first, link)).toBe(4);

    // CR 702.6b attaches it to the new creature, and CR 301.5c takes it off the
    // old one. The bonus is one record, so it follows rather than doubling.
    const second = equip(first, weapon, seraphine).state;
    expect(attachmentOf(second, weapon)).toBe(seraphine);
    expect(powerOf(second, link)).toBe(2);
    expect(powerOf(second, seraphine)).toBe(3);
    expect(second.continuous.filter((effect) => effect.sourceOid === weapon)).toHaveLength(1);
  });

  it('grants a keyword through layer 6 when that is what it says', () => {
    const { state, weapon } = armed({ weapon: SCIMITAR_OF_THE_DUNES });
    const link = named(state, 'Kaelen');

    expect(hasKeyword(state, link, 'firstStrike')).toBe(false);
    const equipped = equip(state, weapon, link).state;
    expect(hasKeyword(equipped, link, 'firstStrike')).toBe(true);
    expect(effectsApplyingTo(equipped, link).map((effect) => effect.layer)).toStrictEqual(['6']);
  });
});

/**
 * CR 613.7d: an Equipment receives a new timestamp each time it becomes
 * attached.
 *
 * The only board that can see the difference is layer 6, where order decides
 * whether a grant survives a "loses all abilities": the two P/T modifications
 * DSL v1 can express are additive, so within layer 7c a wrong timestamp
 * produces the same number. This is the board that sees it.
 */
describe('the timestamp an attachment takes', () => {
  it('is minted when the weapon becomes attached, not when it entered', () => {
    const { state, weapon } = armed({ weapon: SCIMITAR_OF_THE_DUNES });
    const link = named(state, 'Kaelen');
    // Stamped at 1, which is earlier than anything this game can mint, so the
    // grant survives it only by being newer.
    const stripped = withContinuous(state, [
      abilityChange(objectFilter({ oids: [link] }), { removeAll: true }, { source: link, ts: 1 }),
    ]);

    const equipped = equip(stripped, weapon, link).state;
    expect(hasKeyword(equipped, link, 'firstStrike')).toBe(true);
  });
});

describe('the equip ability', () => {
  /** CR 702.6b: activate only as a sorcery, which needs a stack with nothing on it. */
  it('is not offered while something is on the stack', () => {
    const { state, weapon } = armed({ hand: [ANCIENT_BLADE] });
    const link = named(state, 'Kaelen');
    const blade = state.players[0].hand[0];
    if (blade === undefined) throw new Error('Ancient Blade is not in hand');
    const held = reduce(state, {
      type: 'castSpell',
      player: 0,
      oid: blade,
      targets: [{ kind: 'permanent', oid: link }],
    });
    expect(held.state.stack).toHaveLength(1);
    expect(equipAction(held.state, weapon, link)).toBeUndefined();
  });

  it('is not offered on the opponent turn, and is refused if submitted anyway', () => {
    const start = scenario({
      battlefield: [
        { card: KAELEN, controller: 0 },
        { card: MOONBLADE, controller: 0 },
        ...lands(FOREST, 8).map((card) => ({ card, controller: 0 as const })),
      ],
      active: 1,
    }).state;
    // Priority reaches the non-active player with the stack still empty, which
    // is the window an instant-speed ability would be offered in.
    const state = reduce(start, { type: 'passPriority', player: 1 }).state;
    expect(state.turn.priority).toBe(0);
    const sword = named(state, 'Moonblade');
    const link = named(state, 'Kaelen');
    expect(equipAction(state, sword, link)).toBeUndefined();

    const submitted: Action = {
      type: 'activateAbility',
      player: 0,
      oid: sword,
      abilityIndex: 0,
      targets: [{ kind: 'permanent', oid: link }],
      sacrifices: [],
    };
    expect(validateAction(state, submitted)).toBe('equip is activated only as a sorcery');
    expect(() => reduce(state, submitted)).toThrow(IllegalActionError);
  });

  /**
   * CR 702.6b targets a creature *you* control, and that restriction belongs to
   * the keyword rather than to `TARGET_KINDS`. `targetCreatureYouControl` has
   * since landed for Fuse and does not change that: a target kind is a field on
   * an effect, and an equip ability has no effect to carry one. The two spaces
   * are computed by two functions and `equip.test.ts` and `monster-drop.test.ts`
   * hold each of them to the same answer.
   */
  it('offers only creatures its controller controls, and refuses the others', () => {
    const state = scenario({
      battlefield: [
        { card: KAELEN, controller: 0 },
        { card: MOONBLADE, controller: 0 },
        ...lands(FOREST, 8).map((card) => ({ card, controller: 0 as const })),
        { card: SERAPHINE, controller: 1 },
      ],
    }).state;
    const sword = named(state, 'Moonblade');
    const theirs = named(state, 'Seraphine');
    expect(getObject(state, theirs).controller).toBe(1);

    const offered = legalActions(state).filter(
      (action) => action.type === 'activateAbility' && action.oid === sword,
    );
    expect(offered).toHaveLength(1);
    expect(equipAction(state, sword, theirs)).toBeUndefined();
    expect(
      validateAction(state, {
        type: 'activateAbility',
        player: 0,
        oid: sword,
        abilityIndex: 0,
        targets: [{ kind: 'permanent', oid: theirs }],
        sacrifices: [],
      }),
    ).toBe('equip targets a creature you control');
  });

  /**
   * An equip ability chooses one target and prints no effect, so the tuple it
   * carries is one slot rather than one per effect. A hand-built action is the
   * only way to reach a tuple of another length, and it is refused for saying
   * so rather than for what is in it.
   */
  it('refuses an action carrying anything but one target', () => {
    const { state, weapon } = armed();
    const link = named(state, 'Kaelen');
    const submitted = (targets: readonly (Target | null)[]): Action => ({
      type: 'activateAbility',
      player: 0,
      oid: weapon,
      abilityIndex: 0,
      targets,
      sacrifices: [],
    });
    expect(validateAction(state, submitted([]))).toBe('equip chooses exactly one target');
    expect(
      validateAction(
        state,
        submitted([
          { kind: 'permanent', oid: link },
          { kind: 'permanent', oid: link },
        ]),
      ),
    ).toBe('equip chooses exactly one target');
    expect(validateAction(state, submitted([{ kind: 'permanent', oid: link }]))).toBeNull();
  });

  /** CR 301.5e: an Equipment that is also a creature cannot equip a creature. */
  it('is not offered by a weapon a layer-4 effect animated', () => {
    const { state, weapon } = armed();
    const link = named(state, 'Kaelen');
    const animated = withContinuous(state, [
      retype(objectFilter({ oids: [weapon] }), { addTypes: ['creature'] }, { source: weapon }),
    ]);
    expect(equipAction(animated, weapon, link)).toBeUndefined();
    expect(
      validateAction(animated, {
        type: 'activateAbility',
        player: 0,
        oid: weapon,
        abilityIndex: 0,
        targets: [{ kind: 'permanent', oid: link }],
        sacrifices: [],
      }),
    ).toBe('an Equipment that is a creature cannot equip a creature');
  });
});

describe('an equip on the stack', () => {
  /**
   * CR 608.2b: an ability whose targets have all become illegal does not
   * resolve. The equip is the whole ability, so killing the creature it named
   * leaves a weapon on the battlefield attached to nothing.
   */
  it('does not attach when its target died in response', () => {
    const { state, weapon } = armed({ hand: [ANCIENT_BLADE] });
    const link = named(state, 'Kaelen');
    const action = equipAction(state, weapon, link);
    if (action === undefined) throw new Error('no equip was offered');
    const activated = reduce(state, action);
    expect(activated.state.stack).toHaveLength(1);

    const blade = activated.state.players[0].hand[0];
    if (blade === undefined) throw new Error('Ancient Blade is not in hand');
    const responded = reduce(activated.state, {
      type: 'castSpell',
      player: 0,
      oid: blade,
      targets: [{ kind: 'permanent', oid: link }],
    });
    // Both spells resolve: the blade first, then the equip with nothing to
    // attach to.
    const settled = reduceAll(responded.state, [...PASS, ...PASS]);

    expect(getObject(settled.state, link).zone).toBe('graveyard');
    expect(attachmentOf(settled.state, weapon)).toBeUndefined();
    expect(settled.state.continuous.filter((effect) => effect.sourceOid === weapon)).toStrictEqual([]);
    expect(settled.events.filter((event) => event.type === 'effectSkipped')).toHaveLength(1);
  });

  /**
   * CR 701.3a attaches a *permanent*, so a weapon that left the battlefield in
   * response attaches nothing.
   *
   * Without the check the attachment would land on an object in a graveyard,
   * and nothing would ever take it off: `illegalAttachments` walks the
   * battlefield, so a stale record there is a creature that keeps a bonus for
   * the rest of the game.
   */
  it('does not attach when the weapon itself was spent in response', () => {
    const { state, weapon } = armed({ weapon: BRIGAND_ARM });
    const link = named(state, 'Kaelen');
    const action = equipAction(state, weapon, link);
    if (action === undefined) throw new Error('no equip was offered');
    const activated = reduce(state, action);

    // The second ability sacrifices the arm as its cost (CR 601.2h), so the
    // weapon is in the graveyard while its own equip is still on the stack.
    const spent = reduce(activated.state, {
      type: 'activateAbility',
      player: 0,
      oid: weapon,
      abilityIndex: 1,
      targets: [null],
      sacrifices: [],
    });
    expect(getObject(spent.state, weapon).zone).toBe('graveyard');
    expect(spent.state.stack).toHaveLength(2);

    const settled = reduceAll(spent.state, [...PASS, ...PASS]);
    expect(attachmentOf(settled.state, weapon)).toBeUndefined();
    expect(powerOf(settled.state, link)).toBe(2);
    expect(settled.state.continuous.filter((effect) => effect.sourceOid === weapon)).toStrictEqual([]);
    expect(settled.events.filter((event) => event.type === 'effectSkipped')).toHaveLength(1);
  });
});

describe('an attachment that has become illegal', () => {
  /**
   * CR 301.5c: an Equipment attached to a permanent that stops being a creature
   * becomes unattached and stays on the battlefield. The check is one predicate
   * with CR 704.5m's, because "no longer a creature" and "no longer there" are
   * the same question asked of the host.
   */
  it('unattaches when its host stops being a creature', () => {
    const { state, weapon } = armed();
    const link = named(state, 'Kaelen');
    const equipped = equip(state, weapon, link).state;
    expect(powerOf(equipped, link)).toBe(4);

    const stripped = reduce(
      withContinuous(equipped, [
        retype(objectFilter({ oids: [link] }), { removeTypes: ['creature'] }, { source: link, ts: 99 }),
      ]),
      { type: 'passPriority', player: 0 },
    ).state;

    expect(attachmentOf(stripped, weapon)).toBeUndefined();
    expect(getObject(stripped, weapon).zone).toBe('battlefield');
    expect(stripped.continuous.filter((effect) => effect.sourceOid === weapon)).toStrictEqual([]);

    // Unattached is the *absence* of the field rather than an `undefined` in
    // it, which is what keeps a state written before attachment existed
    // byte-identical under `canonicalJson` — `detached` owns that, and this is
    // the assertion that stops a plain spread from quietly reintroducing the
    // key. `toBeUndefined` above cannot tell the two apart.
    expect('attachedTo' in getObject(stripped, weapon)).toBe(false);
    expect('attachedTo' in getObject(stripped, link)).toBe(false);
  });

  /**
   * CR 301.5e: an Equipment that is also a creature cannot equip a creature, so
   * one that becomes a creature while it is attached comes off.
   *
   * The activation check refuses the same board (`the equip ability` above) and
   * cannot reach this one: nothing is activated here, the weapon was already
   * attached when a layer-4 effect animated it, and only a state-based action
   * looks at a board nobody acted on.
   */
  it('unattaches when the weapon itself becomes a creature', () => {
    const { state, weapon } = armed();
    const link = named(state, 'Kaelen');
    const equipped = equip(state, weapon, link).state;
    expect(powerOf(equipped, link)).toBe(4);

    // The body comes with the animation, because an artifact's printed power
    // and toughness are zero and a 0/0 creature dies to CR 704.5f before this
    // rule gets a look at it.
    const animated = reduce(
      withContinuous(equipped, [
        retype(objectFilter({ oids: [weapon] }), { addTypes: ['creature'] }, { source: weapon, ts: 99 }),
        setPt(objectFilter({ oids: [weapon] }), 2, 2, { source: weapon, ts: 100 }),
      ]),
      { type: 'passPriority', player: 0 },
    ).state;

    expect(attachmentOf(animated, weapon)).toBeUndefined();
    expect(getObject(animated, weapon).zone).toBe('battlefield');
    expect(powerOf(animated, link)).toBe(2);
  });

  /** An Equipment that leaves the battlefield takes its attachment with it. */
  it('is forgotten when the weapon itself leaves the battlefield', () => {
    const { state, weapon } = armed({ weapon: BRIGAND_ARM });
    const link = named(state, 'Kaelen');
    const equipped = equip(state, weapon, link).state;
    expect(powerOf(equipped, link)).toBe(4);

    const spent = reduce(equipped, {
      type: 'activateAbility',
      player: 0,
      oid: weapon,
      abilityIndex: 1,
      targets: [null],
      sacrifices: [],
    });
    const settled = reduceAll(spent.state, PASS).state;

    expect(getObject(settled, weapon).zone).toBe('graveyard');
    expect(attachmentOf(settled, weapon)).toBeUndefined();
    expect(powerOf(settled, link)).toBe(2);
    expect(settled.continuous.filter((effect) => effect.sourceOid === weapon)).toStrictEqual([]);
  });
});

/**
 * CR 613: what a two-modification weapon does is decided by the layers, not by
 * the order the card lists them in.
 *
 * `grantKeyword` compiles to layer 6 and `statBonus` to layer 7c
 * (`abilities.ts`'s `effectForModification`), and `computeAll` walks
 * `LAYER_ORDER` rather than `state.continuous`, so the keyword lands first on
 * both of the cards below even though one prints the bonus first and the other
 * prints the keyword first. Each assertion here fails if the array index is
 * what decides: the applications would come out in registration order on one of
 * the two boards, and the 7c effect that selects on the granted keyword would
 * catch nothing.
 */
describe('a weapon that grants two modifications', () => {
  /**
   * A host that survives the weapon. `-3` toughness buries Kaelen and Seraphine as a
   * state-based action the instant the clause lands, which would unattach the
   * weapon and leave nothing to measure — the card is a drawback as well as a
   * bonus, and the board has to be able to pay it.
   */
  const TALUS = creature('Stone Talus', 2, 6, { cost: { generic: 1 } });

  const equipped = (weapon: Card): { state: GameState; host: ObjectId } => {
    const start = scenario({
      battlefield: [
        { card: TALUS, controller: 0 },
        ...lands(FOREST, 8).map((card) => ({ card, controller: 0 as const })),
      ],
      hands: [[weapon], []],
    }).state;
    const cast = castFromHand(start, 0).state;
    const host = named(cast, 'Stone Talus');
    return { state: equip(cast, named(cast, weapon.name), host).state, host };
  };

  it('registers one record per modification, each in the layer its kind names', () => {
    const { state, host } = equipped(LAST_BLOW_OBLITERATOR);
    const applying = effectsApplyingTo(state, host);
    expect(applying.map((effect) => effect.kind)).toStrictEqual(['abilityChange', 'ptMod']);
    expect(applying.map((effect) => effect.layer)).toStrictEqual(['6', '7c']);
    expect(powerOf(state, host)).toBe(101);
    expect(toughnessOf(state, host)).toBe(3);
    expect(hasKeyword(state, host, 'deathtouch')).toBe(true);
  });

  it('applies layer 6 before layer 7c whichever order the card prints them in', () => {
    const printedOrder = equipped(LAST_BLOW_OBLITERATOR);
    const reversedOrder = equipped(OBLITERATOR_REVERSED);
    for (const board of [printedOrder, reversedOrder]) {
      // `deriveLayers` records every effect that caught a permanent, in
      // application order. Layer 6 first on both boards is the assertion; on a
      // walk driven by the array it would be layer 6 first on one and layer 7c
      // first on the other.
      const applied = deriveLayers(board.state)
        .applications.filter((application) => application.affected.includes(board.host))
        .map((application) => application.effect.layer);
      expect(applied).toStrictEqual(['6', '7c']);
      expect(powerOf(board.state, board.host)).toBe(101);
      expect(toughnessOf(board.state, board.host)).toBe(3);
      expect(hasKeyword(board.state, board.host, 'deathtouch')).toBe(true);
    }
  });

  /**
   * The order made visible in the arithmetic rather than only in the trace.
   *
   * A layer-7c effect that selects on `deathtouch` catches the equipped
   * creature only because the weapon's layer-6 grant has already been applied
   * when layer 7c runs. It carries timestamp 0, which is *earlier* than either
   * of the weapon's records and earlier than everything else on the board, so a
   * walk ordered by timestamp or by insertion would run it before the grant
   * existed and it would catch nothing: 101 rather than 106. CR 613.1 is what
   * makes the number right, and this is the arithmetic that says so.
   */
  it('grants the keyword early enough for a later layer to select on it', () => {
    for (const weapon of [LAST_BLOW_OBLITERATOR, OBLITERATOR_REVERSED]) {
      const { state, host } = equipped(weapon);
      const withBounty = withContinuous(state, [
        pump(objectFilter({ keywords: ['deathtouch'] }), 5, 0, { ts: 0 }),
      ]);
      expect(powerOf(withBounty, host)).toBe(106);
    }
  });
});
