/**
 * The gate between what the model said and what the cube may hold.
 *
 * Every branch here is a different message back to the model, and getting the
 * message wrong trains the next round in the wrong direction: "you invented
 * that card" and "that card is real but illegal here" ask for different fixes,
 * and so do "that archetype does not exist in this cube" and "that card cannot
 * be cast in it".
 */
import { describe, expect, it } from 'vitest';
import { fixtureCard, fixtureEntry, fixturePool } from './support/fixture-cube';
import { CubeCriteriaSchema } from '../src/criteria';
import type { CubeCardProposal } from '../src/propose';
import { buildCubePrompt, cubeProposalSchema, cubeSystem, verifyCubeProposals } from '../src/propose';

const WHITE_ONE = fixtureCard({ name: 'White One', manaCost: '{W}', manaValue: 1, colorIdentity: 'W' });
const WHITE_TWO = fixtureCard({ name: 'White Two', manaCost: '{1}{W}', manaValue: 2, colorIdentity: 'W' });
const RED_ONE = fixtureCard({ name: 'Red One', manaCost: '{R}', manaValue: 1, colorIdentity: 'R' });
const BLUE_ONE = fixtureCard({ name: 'Blue One', manaCost: '{1}{U}', manaValue: 2, colorIdentity: 'U' });
const GEAR = fixtureCard({
  name: 'Plain Gear',
  manaCost: '{2}',
  manaValue: 2,
  typeLine: 'Artifact',
  colorIdentity: '',
});

const POOL = fixturePool([WHITE_ONE, WHITE_TWO, RED_ONE, BLUE_ONE, GEAR], ['Banished Staple']);

const CRITERIA = CubeCriteriaSchema.parse({
  prompt: 'a small test cube',
  format: 'modern',
  size: 45,
  seats: 3,
  cardsPerSeat: 15,
  archetypes: [{ name: 'boros aggro', colors: ['W', 'R'], minPlayable: 2 }],
});

function proposal(overrides: Partial<CubeCardProposal> & { readonly name: string }): CubeCardProposal {
  return { count: 1, archetypes: ['boros aggro'], reason: 'it is a card', ...overrides };
}

function verify(proposals: readonly CubeCardProposal[], accepted = [] as ReturnType<typeof fixtureEntry>[]) {
  return verifyCubeProposals({ proposals, pool: POOL, criteria: CRITERIA, accepted, room: 5 });
}

describe('a proposal the cube can take', () => {
  it('becomes an entry carrying the model’s tags and its reason', () => {
    const result = verify([proposal({ name: 'white one', reason: 'cheap white body' })]);
    expect(result.rejections).toStrictEqual([]);
    expect(result.inclusions).toHaveLength(1);
    expect(result.inclusions[0]?.card.name).toBe('White One');
    expect(result.inclusions[0]?.archetypes).toStrictEqual(['boros aggro']);
    expect(result.inclusions[0]?.reason).toBe('cheap white body');
  });

  it('may be colorless, which every archetype can cast', () => {
    expect(verify([proposal({ name: 'Plain Gear' })]).inclusions).toHaveLength(1);
  });
});

describe('a proposal the cube cannot take', () => {
  it('tells an invented card apart from a real one the restrictions exclude', () => {
    const result = verify([proposal({ name: 'Wurmcoil Nonesuch' }), proposal({ name: 'Banished Staple' })]);
    expect(result.inclusions).toStrictEqual([]);
    expect(result.rejections.map((rejection) => rejection.code)).toStrictEqual([
      'unknown-card',
      'not-in-universe',
    ]);
    expect(result.rejections[0]?.detail).toContain('no card named Wurmcoil Nonesuch exists');
    expect(result.rejections[1]?.detail).toContain("the cube's restrictions exclude it");
  });

  it('rejects a card tagged with an archetype whose colors cannot cast it', () => {
    const result = verify([proposal({ name: 'Blue One' })]);
    expect(result.rejections[0]).toMatchObject({ code: 'off-color' });
    expect(result.rejections[0]?.detail).toContain('colour identity {U}');
    expect(result.rejections[0]?.detail).toContain('boros aggro ({WR})');
  });

  it('rejects a tag the cube never stated, listing the ones it did', () => {
    const result = verify([proposal({ name: 'Red One', archetypes: ['dimir control'] })]);
    expect(result.rejections[0]).toMatchObject({ code: 'unstated-archetype' });
    expect(result.rejections[0]?.detail).toContain('tag only from: boros aggro');
  });

  it('rejects a second copy in a singleton cube', () => {
    const result = verify([proposal({ name: 'Red One', count: 2 })]);
    expect(result.rejections[0]).toMatchObject({ code: 'too-many-copies' });
    expect(result.rejections[0]?.detail).toContain('the limit here is 1');
  });

  it('rejects a repeat, whether inside one answer or against what is already in', () => {
    const twice = verify([proposal({ name: 'Red One' }), proposal({ name: 'red one' })]);
    expect(twice.inclusions).toHaveLength(1);
    expect(twice.rejections[0]).toMatchObject({ code: 'duplicate' });

    const again = verify([proposal({ name: 'Red One' })], [fixtureEntry(RED_ONE, ['boros aggro'])]);
    expect(again.inclusions).toStrictEqual([]);
    expect(again.rejections[0]).toMatchObject({ code: 'duplicate' });
  });

  it('rejects what does not fit once the room runs out, and says how much is left', () => {
    const result = verifyCubeProposals({
      proposals: [proposal({ name: 'White One' }), proposal({ name: 'Red One' })],
      pool: POOL,
      criteria: CRITERIA,
      accepted: [],
      room: 1,
    });
    expect(result.inclusions).toHaveLength(1);
    expect(result.rejections[0]).toMatchObject({ code: 'over-size' });
    expect(result.rejections[0]?.detail).toContain('room for 0 more card(s)');
  });
});

describe('a cube that states no archetypes', () => {
  /**
   * The schema, the standing instructions and the gate have to agree about a
   * cube with nothing to tag. When they did not, the criteria schema's own
   * default — `archetypes: []` — could not produce a cube at all: the answer
   * shape demanded a tag, and the gate rejected every card that carried one.
   */
  const BARE = CubeCriteriaSchema.parse({ prompt: 'a cube', format: 'modern', size: 45 });

  const card = (archetypes: readonly string[]) => ({
    plan: 'a plain cube',
    cards: [{ name: 'White One', count: 1, archetypes, reason: 'it is a card' }],
  });

  it('answers under a schema that takes an empty tag list and refuses a tag', () => {
    const schema = cubeProposalSchema(BARE);
    expect(schema.safeParse(card([])).success).toBe(true);
    expect(schema.safeParse(card(['aggro'])).success).toBe(false);
  });

  it('still demands a tag when the cube does state archetypes', () => {
    const schema = cubeProposalSchema(CRITERIA);
    expect(schema.safeParse(card([])).success).toBe(false);
    expect(schema.safeParse(card(['boros aggro'])).success).toBe(true);
  });

  it('drops the tagging rule from the standing instructions', () => {
    expect(cubeSystem(CRITERIA)).toContain('Every card must be tagged');
    expect(cubeSystem(BARE)).not.toContain('Every card must be tagged');
    // The rest of the instructions are the same job either way.
    expect(cubeSystem(BARE)).toContain('You are a Magic: the Gathering cube designer.');
  });

  it('takes an untagged card and says what to do about a tagged one', () => {
    const bare = verifyCubeProposals({
      proposals: [proposal({ name: 'White One', archetypes: [] })],
      pool: POOL,
      criteria: BARE,
      accepted: [],
      room: 5,
    });
    expect(bare.rejections).toStrictEqual([]);
    expect(bare.inclusions[0]?.archetypes).toStrictEqual([]);

    const tagged = verifyCubeProposals({
      proposals: [proposal({ name: 'White One', archetypes: ['aggro'] })],
      pool: POOL,
      criteria: BARE,
      accepted: [],
      room: 5,
    });
    expect(tagged.rejections[0]).toMatchObject({ code: 'unstated-archetype' });
    // Not "tag only from: " with nothing after it, which is an instruction to
    // choose from an empty list.
    expect(tagged.rejections[0]?.detail).toContain('this cube states no archetypes');
    expect(tagged.rejections[0]?.detail).not.toContain('tag only from');
  });
});

describe('the prompt', () => {
  it('states the archetypes, the pod and the pool without naming a single card in it', () => {
    const prompt = buildCubePrompt(CRITERIA, POOL, 5, [], []);
    expect(prompt).toContain('a small test cube');
    expect(prompt).toContain('boros aggro ({WR}) — needs at least 2 playable cards');
    expect(prompt).toContain('3 players taking 15 cards each (45 cards in a pod)');
    expect(prompt).toContain('The pool holds 5 legal cards');
    // The pool is a validation set, never a shortlist: naming its cards would
    // turn "choose from what you know" into "pick from this list".
    for (const card of POOL.universe.cards) expect(prompt).not.toContain(card.name);
  });

  it('hands last round’s problems back verbatim so the next round can repair them', () => {
    const rejected = verify([proposal({ name: 'Blue One' })]).rejections;
    const prompt = buildCubePrompt(CRITERIA, POOL, 4, [fixtureEntry(WHITE_ONE)], rejected);
    expect(prompt).toContain('Already in the cube');
    expect(prompt).toContain('White One');
    expect(prompt).toContain(rejected[0]?.detail ?? 'no rejection');
  });
});

describe('the color-balance line', () => {
  // CRITERIA states one archetype spanning {W, R}: an even share of those two
  // colors is a half, which is also what `validate.ts`'s `colorFindings`
  // measures the finished cube against for this same CRITERIA (mtg-bc2.136 —
  // the line used to say "a fifth" regardless of what was stated).
  it('asks for an even share of the stated archetypes’ colors, not a fixed fraction', () => {
    const prompt = buildCubePrompt(CRITERIA, POOL, 5, [], []);
    expect(prompt).toContain(
      "Colour balance is measured afterwards: each colour should hold about an even share (50.0%) of the slots in the archetypes' colours {WR}, within 5.0 points.",
    );
  });

  it('measures a quarter across two two-color archetypes that share no color', () => {
    const twoArchetypes = CubeCriteriaSchema.parse({
      prompt: 'a two-archetype cube',
      format: 'modern',
      size: 45,
      seats: 3,
      cardsPerSeat: 15,
      archetypes: [
        { name: 'boros aggro', colors: ['W', 'R'], minPlayable: 2 },
        { name: 'dimir control', colors: ['U', 'B'], minPlayable: 2 },
      ],
    });
    const prompt = buildCubePrompt(twoArchetypes, POOL, 5, [], []);
    expect(prompt).toContain(
      "each colour should hold about an even share (25.0%) of the slots in the archetypes' colours {WUBR}",
    );
  });

  it('falls back to an even fifth of the whole pie when the cube states no archetypes', () => {
    const bare = CubeCriteriaSchema.parse({ prompt: 'a cube', format: 'modern', size: 45 });
    const prompt = buildCubePrompt(bare, POOL, 5, [], []);
    expect(prompt).toContain(
      'each colour should hold about an even share (20.0%) of the coloured slots, within 5.0 points.',
    );
  });
});
