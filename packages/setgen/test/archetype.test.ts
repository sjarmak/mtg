import { describe, expect, it } from 'vitest';
import {
  COLORS,
  isSourceBodyEffect,
  isSourceBodyOnlyTarget,
  legalTargetsFor,
  parseCard,
  UNPRICED_EFFECT_KINDS,
} from '@mtg/dsl';
import type { AnyEffectKind } from '@mtg/dsl';
import { COLOR_PAIRS } from '@mtg/deckbuild';
import { classify, SKELETON_LITE } from '@mtg/design-data';
import {
  allocateSlots,
  assessArchetypes,
  assignArchetypes,
  BATTLEFIELD_INERT_EFFECTS,
  cardContribution,
  DEFAULT_ARCHETYPE_FLOORS,
  inertCapPerColor,
  isInertRole,
  pairCapacity,
  parseBrief,
  planArchetypes,
  plansHostedBy,
  reserveArchetypes,
  SIGNPOSTS_PER_COLOR,
  signpostHosts,
  slotContribution,
} from '@mtg/setgen';
import type { SetBriefInput, Slot } from '@mtg/setgen';
import { TEST_BRIEF } from './helpers';

const brief = parseBrief({ ...TEST_BRIEF, targetSize: 90 });
const plans = planArchetypes(brief);
const allocation = allocateSlots(brief);

describe('archetype plans', () => {
  it('plans all ten color pairs, once each', () => {
    expect(plans.map((plan) => plan.pair)).toHaveLength(COLOR_PAIRS.length);
    expect(new Set(plans.map((plan) => plan.pair)).size).toBe(COLOR_PAIRS.length);
  });

  it('spreads signpost hosting evenly, and only over a pair’s own colors', () => {
    const hosts = signpostHosts();
    for (const color of COLORS) {
      const hosted = [...hosts.values()].filter((item) => item === color);
      expect(hosted, `${color} hosts ${hosted.length} signposts`).toHaveLength(SIGNPOSTS_PER_COLOR);
    }
    for (const plan of plans) expect(plan.colors).toContain(plan.host);
  });

  it('keeps a payoff off the pair’s plan when the pie rules it off-pie there', () => {
    // The test brief puts deathtouch in B and R; the pie has no deathtouch in
    // white, so WU must not advertise it.
    const wu = plans.find((plan) => plan.pair === 'WU');
    expect(wu?.payoffKeywords).not.toContain('deathtouch');
  });

  it('is a pure function of the brief', () => {
    expect(JSON.stringify(planArchetypes(brief))).toBe(JSON.stringify(plans));
  });
});

describe('inert roles', () => {
  it('calls a role inert exactly when every effect it may print leaves the board alone', () => {
    expect(isInertRole('counterspell', 'U')).toBe(true);
    expect(isInertRole('libraryTopBottom', 'U')).toBe(true);
    expect(isInertRole('cantrip', 'U')).toBe(true);
    expect(isInertRole('protectiveInstant', 'U')).toBe(false);
    expect(isInertRole('burnTwo', 'R')).toBe(false);
    expect(isInertRole('removalUnconditional', 'B')).toBe(false);
  });
});

describe('reservation', () => {
  const reservation = reserveArchetypes(SKELETON_LITE);

  it('leaves no color over the inert cap', () => {
    const cap = inertCapPerColor();
    for (const color of COLORS) {
      const inert = (['common', 'uncommon'] as const).flatMap((rarity) =>
        reservation.profile.colors[color][rarity].spellRoles.filter((role) => isInertRole(role, color)),
      );
      expect(inert.length, `${color} keeps ${inert.join(', ')}`).toBeLessThanOrEqual(cap);
    }
  });

  it('buys bodies without changing any group’s card count', () => {
    for (const color of COLORS) {
      for (const rarity of ['common', 'uncommon'] as const) {
        const before = SKELETON_LITE.colors[color][rarity];
        const after = reservation.profile.colors[color][rarity];
        expect(after.cards).toBe(before.cards);
        expect(after.creatures + after.spells).toBe(before.cards);
        expect(after.spellRoles).toHaveLength(after.spells);
        const curveTotal = after.creatureCurve.reduce((sum, bucket) => sum + bucket.count, 0);
        expect(curveTotal).toBe(after.creatures);
      }
    }
  });

  it('keeps the keyword budget inside the creature count it was rescaled to', () => {
    for (const color of COLORS) {
      for (const rarity of ['common', 'uncommon'] as const) {
        const plan = reservation.profile.colors[color][rarity];
        const keywords = plan.keywords.reduce((sum, entry) => sum + entry.count, 0);
        expect(keywords).toBeLessThanOrEqual(plan.creatures);
      }
    }
  });

  it('is idempotent: reserving a reserved profile changes nothing', () => {
    const again = reserveArchetypes(reservation.profile);
    expect(again.notes).toStrictEqual([]);
    expect(JSON.stringify(again.profile)).toBe(JSON.stringify(reservation.profile));
  });

  it('records one note per conversion, naming the role it spent', () => {
    expect(reservation.notes.length).toBe(reservation.support.length);
    for (const note of reservation.notes) expect(note).toContain('became a creature');
  });
});

describe('allocation with reservation', () => {
  it('reserves a signpost for every pair, in one of the pair’s own colors', () => {
    for (const plan of plans) {
      const signposts = allocation.slots.filter(
        (slot) => slot.signpost && slot.archetypes.includes(plan.pair),
      );
      expect(signposts, `${plan.pair} has no signpost`).toHaveLength(1);
      const [slot] = signposts;
      expect(slot?.rarity).toBe('uncommon');
      expect(slot?.color).toBe(plan.host);
    }
  });

  it('gives a signpost exactly one archetype to advertise', () => {
    for (const slot of allocation.slots.filter((item) => item.signpost)) {
      expect(slot.archetypes).toHaveLength(1);
    }
  });

  it('keeps a slot’s mechanic tags backed by the keywords it actually carries', () => {
    // Stamping a signpost with its payoff keyword replaces the keyword the
    // skeleton had put there. A slot left advertising the old keyword's mechanic
    // would tell the model to design for a mechanic its card cannot express.
    for (const slot of allocation.slots) {
      for (const name of slot.mechanics) {
        const mechanic = brief.mechanics.find((item) => item.name === name);
        expect(mechanic, `${slot.id} supports unknown mechanic ${name}`).toBeDefined();
        const backed =
          (mechanic?.keywords.some((keyword) => slot.keywords.includes(keyword)) ?? false) ||
          (mechanic?.effectKinds.some((kind) => slot.effectKinds.includes(kind)) ?? false);
        expect(
          backed,
          `${slot.id} claims ${name} but carries [${slot.keywords.join(', ')}] / [${slot.effectKinds.join(', ')}]`,
        ).toBe(true);
      }
    }
  });

  it('does not spend one keyword on both signposts a color hosts', () => {
    for (const color of COLORS) {
      const hosted = allocation.slots.filter(
        (slot) => slot.signpost && slot.color === color && slot.cardKind === 'creature',
      );
      const keywords = hosted.flatMap((slot) => slot.keywords);
      // Only meaningful when the color can legally print more than one payoff:
      // the plans it hosts have to offer at least as many on-pie keywords.
      const available = new Set(
        plansHostedBy(plans, color).flatMap((plan) =>
          plan.payoffKeywords.filter((keyword) => classify(keyword, color).verdict !== 'fail'),
        ),
      );
      if (available.size < hosted.length) continue;
      expect(new Set(keywords).size, `${color} signposts carry [${keywords.join(', ')}]`).toBe(
        keywords.length,
      );
    }
  });

  it('tags the bodies it bought with the archetypes that paid for them', () => {
    const support = allocation.slots.filter((slot) => !slot.signpost && slot.archetypes.length > 0);
    expect(support.length).toBeGreaterThan(0);
    for (const slot of support) {
      expect(slot.cardKind).toBe('creature');
      // A body is playable in all four pairs its color appears in.
      expect(slot.archetypes).toHaveLength(4);
    }
  });

  it('leaves every pair structurally viable at the plan level', () => {
    const contributions = allocation.slots.map(slotContribution);
    const reports = assessArchetypes(contributions, allocation.archetypes, DEFAULT_ARCHETYPE_FLOORS);
    expect(reports).toHaveLength(COLOR_PAIRS.length);
    const broken = reports.filter((report) => !report.ok);
    expect(
      broken.map((report) => `${report.pair}: ${report.shortfalls.map((item) => item.detail).join('; ')}`),
    ).toStrictEqual([]);
  });

  it('is deterministic, tags and all', () => {
    expect(JSON.stringify(allocateSlots(brief).slots)).toBe(JSON.stringify(allocation.slots));
  });
});

/**
 * A pair whose payoff is an effect, and the slot that has to advertise it.
 *
 * The brief below is the flagship's shape: its mechanic names an effect kind and
 * the ability kinds that carry it, and no keyword at all. So every pair's
 * `payoffKeywords` is empty and `payoffEffects` is the whole plan, and
 * `assignSignposts` — which stamps a keyword and nothing else — has nothing to
 * stamp.
 *
 * That leaves a contradiction the retry loop cannot get out of. A creature
 * prints an effect only inside an ability; `checkAbilityKinds` refuses an
 * ability on a slot the allocator gave no ability kinds; and
 * `ARCHETYPE_SIGNPOST_OFF_PLAN` then fails the pair because its signpost carries
 * none of its payoff vocabulary. No card satisfies both rules, so regenerating
 * the slot is spent effort — which is what the 2026-08-13 flagship set run
 * measured: round 2 targeted the three off-plan signposts and repaired none of
 * them.
 */
describe('a signpost whose payoff is an effect', () => {
  const mechanics = [
    {
      name: 'Fuse',
      description: 'A monster dies and leaves a part behind; the part fuses onto a creature.',
      effectKinds: ['createToken'],
      abilityKinds: ['triggered', 'activated'],
      colors: [],
    },
  ] satisfies SetBriefInput['mechanics'];
  const effectBrief = parseBrief({ ...TEST_BRIEF, seed: 'effect-payoff-1', targetSize: 75, mechanics });
  const effectPlans = planArchetypes(effectBrief);
  const effectSlots = allocateSlots(effectBrief).slots;

  it('states the premise: every pair’s payoff is an effect and no keyword', () => {
    for (const plan of effectPlans) {
      expect(plan.payoffKeywords, `${plan.pair} payoff keywords`).toStrictEqual([]);
      expect(plan.payoffEffects, `${plan.pair} payoff effects`).toContain('createToken');
    }
  });

  it('reserves a way for every signpost to print its pair’s payoff', () => {
    const mute = effectPlans.flatMap((plan) => {
      const signpost = effectSlots.find((slot) => slot.signpost && slot.archetypes.includes(plan.pair));
      if (signpost === undefined) return [`${plan.pair}: no signpost`];
      const byKeyword = plan.payoffKeywords.some((keyword) => signpost.keywords.includes(keyword));
      const byEffect = plan.payoffEffects.some((kind) => signpost.effectKinds.includes(kind));
      const byAbility = signpost.abilityKinds.length > 0;
      return byKeyword || byEffect || byAbility ? [] : [`${plan.pair}: ${signpost.id}`];
    });
    expect(mute).toStrictEqual([]);
  });

  it('reserves nothing on a set too small for the gate to judge', () => {
    // The same brief at a size where no pair can fill a deck. The validator
    // abstains there with ARCHETYPE_UNDERSIZED, so a reservation would only
    // rewrite the prompt of a set nothing reads it back on — and rewriting a
    // prompt re-keys every recorded fixture the brief ever produced.
    const small = parseBrief({ ...TEST_BRIEF, seed: 'effect-payoff-1', targetSize: 20, mechanics });
    const allocated = allocateSlots(small);
    expect(pairCapacity(allocated.profile)).toBeLessThan(DEFAULT_ARCHETYPE_FLOORS.playables);
    const stamped = allocated.notes.filter((note) => note.includes('signpost can print'));
    expect(stamped).toStrictEqual([]);
  });

  /**
   * The claim every balance attribution against this pass rests on.
   *
   * `mtg-x1s` traced the flagship's `balance.spread` widening to
   * `reserveSignpostAbilities`, and that attribution is only worth anything
   * because the pass moves a slot's vocabulary and nothing else: same count,
   * same color, same rarity, same card kind, same cost window, same role, same
   * required-card seating. A pool that kept its shape and changed what three
   * uncommons are allowed to say is a pool whose win rates moved because of what
   * the model then said. A pass that also moved a slot's color or its curve
   * would make the same numbers a statement about a different pool, and the
   * commit that let it would break the reasoning silently — the sweep would keep
   * reporting a number and the docblock would keep explaining the wrong one.
   *
   * Every field is reset first so the reservation fires on all ten signposts
   * rather than the three the flagship happened to leave mute. That is the
   * widest opportunity the pass ever gets to move something it should not.
   */
  it('moves the vocabulary and the tags, and no other field of any slot', () => {
    const blank: readonly Slot[] = effectSlots.map((slot) => ({
      ...slot,
      abilityKinds: [],
      archetypes: [],
      signpost: false,
    }));
    const assigned = assignArchetypes({
      slots: blank,
      plans: effectPlans,
      support: [],
      profile: allocateSlots(effectBrief).profile,
      mechanicsFor: (_keywords, _color) => [],
    });

    // The pass is supposed to have something to do on this brief, or the
    // comparison below is a tautology over a pass that ran and returned.
    expect(assigned.notes.filter((note) => note.includes('signpost can print')).length).toBeGreaterThan(0);

    const owned = new Set(['abilityKinds', 'archetypes', 'signpost']);
    const moved = assigned.slots.flatMap((slot, index) => {
      const before = blank[index];
      if (before === undefined) return [`${slot.id}: no input slot at ${String(index)}`];
      return Object.keys(before)
        .filter((field) => !owned.has(field))
        .filter((field) => {
          const a = before[field as keyof Slot];
          const b = slot[field as keyof Slot];
          return JSON.stringify(a) !== JSON.stringify(b);
        })
        .map((field) => `${slot.id}.${field}`);
    });
    expect(moved).toStrictEqual([]);
  });
});

describe('viability floors', () => {
  it('fails a pair whose playables cannot touch the battlefield', () => {
    const contributions = allocation.slots.map(slotContribution);
    const blanked = contributions.map((item) =>
      item.colors.includes('U') ? { ...item, inert: true, creature: false, removal: false } : item,
    );
    const reports = assessArchetypes(blanked, allocation.archetypes);
    const ur = reports.find((report) => report.pair === 'UR');
    expect(ur?.ok).toBe(false);
    expect(ur?.shortfalls.map((item) => item.kind)).toContain('inert');
  });

  it('fails a pair with no signpost', () => {
    const contributions = allocation.slots.map(slotContribution).map((item) => ({
      ...item,
      signpost: false,
      archetypes: [] as readonly string[],
    }));
    const reports = assessArchetypes(contributions, allocation.archetypes);
    for (const report of reports) {
      expect(report.shortfalls.map((item) => item.kind)).toContain('signpost');
    }
  });
});

/**
 * The two questions the card pass asks about a permanent, both of which it used
 * to get wrong in the same direction: it read `card.effects` and nothing else.
 *
 * A permanent has no effect list. Everything it does is printed inside an
 * ability, so a reader that walks only `card.effects` sees an empty array on
 * every creature and every artifact in a set, and then draws two conclusions
 * from it. That this card resolves without touching the battlefield, because
 * `[].every()` is vacuously true. And that it carries no payoff vocabulary,
 * because there is nothing to map over.
 *
 * the flagship set is where both surfaced at once, on the same run: ten
 * `ARCHETYPE_INERT_GLUT` errors naming every artifact slot in the set including
 * a Moonblade that grants +4/+4, and ten `ARCHETYPE_SIGNPOST_OFF_PLAN`
 * errors against signposts nine of which print `createToken` inside a triggered
 * ability, which is exactly what their archetypes asked for. Nineteen of the
 * twenty went away with the fix these tests pin, and the twentieth was a real
 * miss by the model.
 */
describe('what the card pass can see on a permanent', () => {
  const SET = { code: 'TST', collectorNumber: 1 };
  const slot = (over: Partial<Slot> = {}): Slot => ({
    ...(allocation.slots[0] as Slot),
    archetypes: [],
    signpost: false,
    ...over,
  });

  const weapon = parseCard({
    id: 'tst-moonblade',
    name: 'Moonblade',
    kind: 'artifact',
    rarity: 'uncommon',
    set: SET,
    subtypes: ['Equipment'],
    manaCost: { generic: 4 },
    abilities: [
      {
        kind: 'activated',
        cost: { mana: { generic: 2 }, tapSelf: false, sacrificeSelf: false },
        effects: [],
        attach: { modifications: [{ kind: 'statBonus', power: 4, toughness: 4 }] },
      },
    ],
  });

  const trinket = parseCard({
    id: 'tst-sylvanok-seed',
    name: 'Sylvanok Seed',
    kind: 'artifact',
    rarity: 'common',
    set: { ...SET, collectorNumber: 2 },
    subtypes: ['Trinket'],
    manaCost: { generic: 1 },
  });

  const signpost = parseCard({
    id: 'tst-forager',
    name: 'Vornite Forager',
    kind: 'creature',
    rarity: 'uncommon',
    set: { ...SET, collectorNumber: 3 },
    colors: ['G'],
    manaCost: { generic: 2, G: 1 },
    power: 2,
    toughness: 3,
    abilities: [
      {
        kind: 'triggered',
        condition: 'selfEnters',
        effects: [
          {
            kind: 'createToken',
            count: 1,
            token: { name: 'Sylvanok', power: 1, toughness: 1, colors: [], subtypes: [], keywords: [] },
          },
        ],
      },
    ],
  });

  const cantrip = parseCard({
    id: 'tst-cantrip',
    name: 'Ashen Reading',
    kind: 'instant',
    rarity: 'common',
    set: { ...SET, collectorNumber: 4 },
    colors: ['U'],
    manaCost: { generic: 1, U: 1 },
    effects: [{ kind: 'drawCards', count: 2, target: { kind: 'noTarget' } }],
  });

  it('does not call a weapon inert, which is the whole of the bug', () => {
    expect(cardContribution(slot(), weapon).inert).toBe(false);
  });

  it('does not call a permanent with no rules text inert either', () => {
    // The vacuous case in its purest form. Sylvanok Seed prints nothing at all,
    // and it is still a permanent that sits on the battlefield.
    expect(trinket.effects).toStrictEqual([]);
    expect(trinket.abilities).toStrictEqual([]);
    expect(cardContribution(slot(), trinket).inert).toBe(false);
  });

  it('does not call a permanent inert even when every effect it prints is', () => {
    // The case that separates the two halves of the fix. Once abilities are
    // read, this artifact's effect list is ['drawCards'] rather than empty, so
    // the non-empty guard no longer saves it and only the permanent rule does.
    // Without that rule this card is inert, and a Chest that draws is not a
    // card that leaves the board as it found it: it is a permanent sitting on
    // the battlefield.
    const drawingChest = parseCard({
      id: 'tst-drawing-chest',
      name: 'Ashen Chest',
      kind: 'artifact',
      rarity: 'common',
      set: { ...SET, collectorNumber: 5 },
      manaCost: { generic: 2 },
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'drawCards', count: 1, target: { kind: 'noTarget' } }],
        },
      ],
    });
    const contribution = cardContribution(slot(), drawingChest);
    expect(contribution.subjects).toStrictEqual(['drawCards']);
    expect(contribution.inert).toBe(false);
  });

  it('still calls a spell that only draws inert, which is the rule the fix kept', () => {
    // The true positive has to survive. A fix that made nothing inert would
    // pass both assertions above and delete the check.
    expect(cardContribution(slot(), cantrip).inert).toBe(true);
  });

  it('does not call a spell inert because its live half was narrowed away', () => {
    // `plannedSubjectsOf` narrows to the priced kinds, which is right for a
    // payoff match and wrong for an `every`: dropping a kind can only make the
    // answer more yes. This card exiles a creature and draws, and while
    // `exileTarget` was unpriced the narrowing deleted the exile and then
    // reported the survivor as a bare cantrip.
    const strike = parseCard({
      id: 'tst-sealing-strike',
      name: 'Sealing Strike',
      kind: 'instant',
      rarity: 'common',
      set: { ...SET, collectorNumber: 6 },
      colors: ['W'],
      manaCost: { generic: 2, W: 1 },
      effects: [
        { kind: 'exileTarget', target: { kind: 'targetCreature' } },
        { kind: 'drawCards', count: 1, target: { kind: 'noTarget' } },
      ],
    });
    const contribution = cardContribution(slot(), strike);
    expect(contribution.inert).toBe(false);
    // `mtg-q5yg` promoted `exileTarget`, so the narrowing keeps it and the two
    // readings agree on this card: a plan can name the exile now, and it is
    // offered as a payoff subject rather than deleted on the way to one. The
    // card stays because the fix does, and the test below says what has to hold
    // for the fix to keep mattering.
    expect(contribution.subjects).toStrictEqual(['exileTarget', 'drawCards']);
  });

  it('sorts every unpriced kind into inert, source-body, or live on a spell', () => {
    // The tripwire, kept as a partition rather than as the claim it used to
    // make. It used to assert that every unpriced kind was inert or confined to
    // a creature's body, which was true while `fight` was the only live one and
    // stopped being true when the library block landed. Asserting the partition
    // instead keeps the alarm — a fourth unpriced live kind fails here and is
    // told where to go — without asserting a thing about the vocabulary that
    // the vocabulary is free to change.
    //
    // The third bucket is asked twice, because a kind reaches a creature's own
    // body two ways. `fight` reads the body without naming it and says so
    // through `SOURCE_BODY_EFFECT_KINDS`; `sacrificeSelf` (`mtg-nhyv.30`) says
    // it through its target row, whose every entry is a retained referent
    // (CR 115.6a), so the validator refuses it on a spell and there is no
    // sorcery for the narrowing to mis-read as a blank. Either answer puts the
    // kind on a permanent, which is the shape the inert question is never
    // asked of.
    const bodyOnly = (kind: AnyEffectKind): boolean => {
      const targets = legalTargetsFor(kind);
      return targets.length > 0 && targets.every(isSourceBodyOnlyTarget);
    };
    const live = UNPRICED_EFFECT_KINDS.filter(
      (kind) => !BATTLEFIELD_INERT_EFFECTS.includes(kind) && !isSourceBodyEffect(kind) && !bodyOnly(kind),
    );
    expect(
      live,
      'a live unpriced kind is narrowed out of `subjects` and must not be narrowed out of `inert`; ' +
        'the two tests below are what pin that, so add one for the new kind',
    ).toStrictEqual([
      'putOnLibrary',
      'searchLibrary',
      'chooseFromGraveyard',
      'untapPermanent',
      'grantKeywordUntilEndOfTurn',
      'cantBeBlockedThisTurn',
      'attacksYouThisTurnIfAble',
      'sacrificePermanent',
      'setBasePtUntilEndOfTurn',
    ]);
  });

  it('reads the inert question off every printed effect, not only the priced ones', () => {
    // This is the tripwire the card above needs, and `mtg-n0to` is what armed
    // it. The bug that card was written for needs a kind that is unpriced and
    // *not* inert: only such a kind is deleted by `plannedSubjectsOf` and can
    // turn an `every` from no into yes. For a while the only unpriced live kind
    // was `fight`, which is a source-body effect legal only on a creature's
    // `selfEnters` trigger -- so the card carrying it is a permanent, and a
    // permanent is never asked the inert question at all.
    //
    // `putOnLibrary` is the first that is neither. It is unpriced, so no plan
    // can name it and `subjects` is empty; it takes a permanent off the
    // battlefield, so the card is the opposite of a blank; and it is printable
    // on a sorcery, which is exactly the shape that can be inert. An `inert`
    // read off the narrowed list would call this spell a blank and count it
    // against the set's inert cap.
    const tuck = parseCard({
      id: 'tst-time-ebb',
      name: 'Send It Back',
      kind: 'sorcery',
      rarity: 'common',
      set: { ...SET, collectorNumber: 7 },
      colors: ['U'],
      manaCost: { generic: 2, U: 1 },
      effects: [{ kind: 'putOnLibrary', position: 'top', target: { kind: 'targetCreature' } }],
    });
    const contribution = cardContribution(slot(), tuck);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads a reanimation as live even though no plan can name it', () => {
    // The third live unpriced kind, pinned for the reason the message above
    // demands one: `chooseFromGraveyard` is unpriced, so `plannedSubjectsOf`
    // deletes it and `subjects` is empty; sending a creature card from a
    // graveyard to the battlefield is the opposite of leaving the board alone;
    // and it is printable on a sorcery, which is the only shape the inert
    // question is ever asked of. Read off the narrowed list this spell would
    // be a blank against the set's inert cap, which is exactly the bug
    // `putOnLibrary` armed this pair of tests for.
    const raise = parseCard({
      id: 'tst-rise-again',
      name: 'Rise Again',
      kind: 'sorcery',
      rarity: 'common',
      set: { ...SET, collectorNumber: 9 },
      colors: ['B'],
      manaCost: { generic: 3, B: 1 },
      effects: [
        {
          kind: 'chooseFromGraveyard',
          whose: 'you',
          filter: { cardTypes: ['creature'] },
          destination: 'battlefield',
        },
      ],
    });
    const contribution = cardContribution(slot(), raise);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads an untap as live even though no plan can name it', () => {
    // The fourth live unpriced kind, pinned because the partition above demands
    // one per kind. `untapPermanent` is unpriced, so `plannedSubjectsOf` deletes
    // it and `subjects` is empty; turning a permanent back the right way up
    // changes the board rather than leaving it as it was found, which is the
    // question `inert` asks; and it is printable on an instant, which is a
    // shape the inert question is asked of. Read off the narrowed list this
    // spell would be a blank against the set's inert cap.
    const wind = parseCard({
      id: 'tst-second-wind',
      name: 'Catch Your Breath',
      kind: 'instant',
      rarity: 'common',
      set: { ...SET, collectorNumber: 10 },
      colors: ['U'],
      manaCost: { generic: 1, U: 1 },
      effects: [{ kind: 'untapPermanent', target: { kind: 'targetCreatureYouControl' } }],
    });
    const contribution = cardContribution(slot(), wind);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads a keyword grant as live even though no plan can name it', () => {
    // The fifth, pinned on the same rule. `grantKeywordUntilEndOfTurn` is
    // unpriced, so `plannedSubjectsOf` deletes it and `subjects` is empty; a
    // creature that could not fly before this resolved and can after is a board
    // that moved, which is the question `inert` asks; and it is printable on an
    // instant, which is the shape the question is asked of. Read off the
    // narrowed list, the whole combat-trick family would count as blanks
    // against the set's inert cap.
    const gust = parseCard({
      id: 'tst-updraft',
      name: 'Sudden Updraft',
      kind: 'instant',
      rarity: 'common',
      set: { ...SET, collectorNumber: 11 },
      colors: ['U'],
      manaCost: { U: 1 },
      effects: [
        { kind: 'grantKeywordUntilEndOfTurn', keyword: 'flying', target: { kind: 'targetCreature' } },
      ],
    });
    const contribution = cardContribution(slot(), gust);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads granted evasion as live even though no plan can name it', () => {
    // The sixth. `cantBeBlockedThisTurn` is unpriced, so `plannedSubjectsOf`
    // deletes it and `subjects` is empty; a creature the defender could have
    // blocked before this resolved and cannot after is a board that moved; and
    // it is printable on an instant. Read off the narrowed list it would count
    // as a blank against the set's inert cap, which is the bug this partition
    // exists to catch.
    const slip = parseCard({
      id: 'tst-slip-past',
      name: 'Slip Past',
      kind: 'instant',
      rarity: 'common',
      set: { ...SET, collectorNumber: 12 },
      colors: ['U'],
      manaCost: { U: 1 },
      effects: [{ kind: 'cantBeBlockedThisTurn', target: { kind: 'targetCreature' } }],
    });
    const contribution = cardContribution(slot(), slip);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads a compelled attack as live even though no plan can name it', () => {
    // The seventh, and the one whose liveness is easiest to argue away: nothing
    // on the board changes when it resolves. What changes is which declarations
    // the kernel will accept for the rest of the turn, and a creature that has
    // to leave its controller's side undefended is the opposite of a card that
    // left the board as it found it.
    const taunt = parseCard({
      id: 'tst-taunting-call',
      name: 'Taunting Call',
      kind: 'instant',
      rarity: 'common',
      set: { ...SET, collectorNumber: 13 },
      colors: ['R'],
      manaCost: { R: 1 },
      effects: [{ kind: 'attacksYouThisTurnIfAble', target: { kind: 'targetCreatureYouDontControl' } }],
    });
    const contribution = cardContribution(slot(), taunt);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads an edict as live even though no plan can name it', () => {
    // The eighth. `sacrificePermanent` (`mtg-4g77`) is unpriced, so
    // `plannedSubjectsOf` deletes it and `subjects` is empty; a board losing a
    // creature is the opposite of a board left as it was found; and it prints
    // on a sorcery, the shape the inert question is asked of. `bodyOnly` does
    // not catch it the way `sacrificeSelf` above is caught: its target row
    // (`targetPlayer`, `targetOpponent`) names another player, not a retained
    // referent, so the effect is legal on a spell at all. Read off the
    // narrowed list this spell would be a blank against the set's inert cap.
    const edict = parseCard({
      id: 'tst-forced-tithe',
      name: 'Forced Tithe',
      kind: 'sorcery',
      rarity: 'common',
      set: { ...SET, collectorNumber: 14 },
      colors: ['B'],
      manaCost: { generic: 1, B: 1 },
      effects: [{ kind: 'sacrificePermanent', target: { kind: 'targetOpponent' } }],
    });
    const contribution = cardContribution(slot(), edict);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads a base power and toughness set as live, because the board it leaves is a different board', () => {
    // The ninth. `setBasePtUntilEndOfTurn` (`mtg-nhyv.72`) is unpriced, so
    // `plannedSubjectsOf` deletes it and `subjects` is empty. It is not inert:
    // the creature it points at is a different size for the rest of the turn,
    // and the size a combat is fought at is the whole of what this kind does.
    // `bodyOnly` does not catch it either, since `targetCreature` names any
    // creature rather than the source's own body.
    const shrink = parseCard({
      id: 'tst-shrink',
      name: 'Test Shrink',
      kind: 'instant',
      rarity: 'common',
      set: { ...SET, collectorNumber: 15 },
      colors: ['U'],
      manaCost: { U: 1 },
      effects: [
        { kind: 'setBasePtUntilEndOfTurn', power: 1, toughness: 1, target: { kind: 'targetCreature' } },
      ],
    });
    const contribution = cardContribution(slot(), shrink);
    expect(contribution.inert).toBe(false);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('calls a spell inert when every kind it prints is, unpriced or not', () => {
    // The other side of the same reading, so neither test can pass by making
    // `inert` constant. A shuffle and a reveal are both unpriced and both
    // genuinely leave the board as they found it, so the narrowing drops them
    // and the unnarrowed reading still answers yes.
    const look = parseCard({
      id: 'tst-shuffle-look',
      name: 'Consult the Deep',
      kind: 'sorcery',
      rarity: 'common',
      set: { ...SET, collectorNumber: 8 },
      colors: ['U'],
      manaCost: { generic: 1, U: 1 },
      effects: [{ kind: 'revealTopCards', count: 3 }, { kind: 'shuffleLibrary' }],
    });
    expect(cardContribution(slot(), look).inert).toBe(true);
  });

  it('reads a fight off the trigger it is printed in, and calls the body live', () => {
    // The narrowing's remaining reach, stated on the kind that reaches it: a
    // fight contributes no *planned* subject, because a plan is built out of a
    // brief's mechanics and a mechanic names a priced kind. That is the
    // narrowing doing its job rather than deleting an answer - the card is a
    // creature, so `inert` never consults the list at all.
    const bramble = parseCard({
      id: 'tst-grasping-bramble',
      name: 'Grasping Bramble',
      kind: 'creature',
      rarity: 'common',
      set: { ...SET, collectorNumber: 7 },
      colors: ['G'],
      manaCost: { generic: 2, G: 1 },
      power: 3,
      toughness: 3,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
        },
      ],
    });
    const contribution = cardContribution(slot(), bramble);

    expect(contribution.inert).toBe(false);
    expect(contribution.creature).toBe(true);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads a fight off the trigger it is printed in, and calls the body live', () => {
    // The narrowing's remaining reach, stated on the kind that reaches it: a
    // fight contributes no *planned* subject, because a plan is built out of a
    // brief's mechanics and a mechanic names a priced kind. That is the
    // narrowing doing its job rather than deleting an answer - the card is a
    // creature, so `inert` never consults the list at all.
    const bramble = parseCard({
      id: 'tst-grasping-bramble',
      name: 'Grasping Bramble',
      kind: 'creature',
      rarity: 'common',
      set: { ...SET, collectorNumber: 7 },
      colors: ['G'],
      manaCost: { generic: 2, G: 1 },
      power: 3,
      toughness: 3,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
        },
      ],
    });
    const contribution = cardContribution(slot(), bramble);

    expect(contribution.inert).toBe(false);
    expect(contribution.creature).toBe(true);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('reads a fight off the trigger it is printed in, and calls the body live', () => {
    // The narrowing's remaining reach, stated on the kind that reaches it: a
    // fight contributes no *planned* subject, because a plan is built out of a
    // brief's mechanics and a mechanic names a priced kind. That is the
    // narrowing doing its job rather than deleting an answer - the card is a
    // creature, so `inert` never consults the list at all.
    const bramble = parseCard({
      id: 'tst-grasping-bramble',
      name: 'Grasping Bramble',
      kind: 'creature',
      rarity: 'common',
      set: { ...SET, collectorNumber: 7 },
      colors: ['G'],
      manaCost: { generic: 2, G: 1 },
      power: 3,
      toughness: 3,
      abilities: [
        {
          kind: 'triggered',
          condition: 'selfEnters',
          effects: [{ kind: 'fight', target: { kind: 'targetCreatureYouDontControl' } }],
        },
      ],
    });
    const contribution = cardContribution(slot(), bramble);

    expect(contribution.inert).toBe(false);
    expect(contribution.creature).toBe(true);
    expect(contribution.subjects).toStrictEqual([]);
  });

  it('calls a scry-only spell inert, because looking is not touching', () => {
    // The other half of the same change, and the case that shows the two lists
    // are independent. Under the old narrowing `scry` was unpriced, so it
    // vanished before the test and a bare scry spell read as having no effects
    // at all. It is priced now and survives the narrowing, and it is still
    // inert: priced is a sentence about what a brief may commission, inert one
    // about what an attack step can see.
    const survey = parseCard({
      id: 'tst-survey',
      name: 'Ashen Survey',
      kind: 'sorcery',
      rarity: 'common',
      set: { ...SET, collectorNumber: 7 },
      colors: ['U'],
      manaCost: { U: 1 },
      effects: [{ kind: 'scry', count: 2 }],
    });
    expect(cardContribution(slot(), survey).inert).toBe(true);
  });

  it('reads a signpost’s payoff out of the ability it is printed in', () => {
    expect(signpost.effects).toStrictEqual([]);
    expect(cardContribution(slot(), signpost).subjects).toContain('createToken');
  });

  it('reads a weapon’s equip clause as no effect, because it prints none', () => {
    // Being visible is not the same as counting for a payoff. An equip ability
    // carries its meaning in `attach`, so it contributes no effect kind, and
    // the assertion is here so that a later change that starts inventing one
    // has to say so out loud.
    expect(cardContribution(slot(), weapon).subjects).toStrictEqual([]);
  });

  it('agrees with the planned view about a permanent slot', () => {
    // The file's own claim is that both passes run the same arithmetic. An
    // artifact slot carries no effect kinds, so it was the same vacuous truth
    // one pass earlier.
    const artifactSlot = slot({ cardKind: 'artifact', effectKinds: [] });
    expect(slotContribution(artifactSlot).inert).toBe(false);
    const cantripSlot = slot({ cardKind: 'instant', effectKinds: ['drawCards'] });
    expect(slotContribution(cantripSlot).inert).toBe(true);
  });
});
