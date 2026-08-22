/**
 * The gate on the slot rather than on the card.
 *
 * Every other check under `validate/` judges a card against the slot it filled.
 * This one judges the slot, and it is the only one that can run before a model
 * call, because it reads nothing but the allocation. A slot with no keyword, no
 * effect kind and no ability kind permits exactly one card, a mana cost with
 * nothing under it, and `checkSlotConformance` passes that card because both of
 * its allowlist checks return early on an empty list.
 *
 * The hole used to be reachable from a shipped brief, and this file was written
 * to pin that. `fillTextlessPermanents` (`allocate.ts`) is gated on the pool
 * having a brief mechanic with an ability kind, deliberately, so a brief naming
 * none builds the prompt and schema bytes it has always built. A brief whose
 * every mechanic names colors therefore reached the colorless pool with nothing,
 * and the Play Booster profile's colorless commons are `manaArtifact` and
 * `landFixing`, roles DSL v0 has no vocabulary for at all. Tideglass Reach
 * allocated at 249 produced five such slots, each a mana cost with nothing under
 * it and no retry able to change it.
 *
 * `rescueUnfillablePermanents` closes it, and `mtg-dkgd` is why it had to be
 * closed rather than left as a documented edge: paying the colorless pool the
 * share the profile states, instead of the remainder five equal color pools left
 * behind, makes the rotation reach those roles at sizes real briefs are built
 * at. The rescue hands exactly this population — a noncreature permanent with no
 * keyword, no effect and no ability — a static ability, which is the one remedy
 * the finding's own message says the slot has left. It is deliberately narrower
 * than the gate above it: a colorless *creature* with no keyword is a vanilla
 * common, a real card the fixtures recorded, and rescuing those too moves 36
 * recorded assertions.
 *
 * So the gate below is now a backstop rather than a live defect, and the tests
 * are written that way: no brief reaches it, a hand-built slot still does, and
 * `mtg-g84u` stays open because the card printed is an artifact with a static
 * ability rather than the mana rock the role names.
 *
 * The numbers this correction re-derived are measured off the flagship brief, so
 * they are in the sibling file that states that brief rather than here.
 */
import { describe, expect, it } from 'vitest';
import { unlimitedBudget } from '@mtg/llm';
import type { LlmProvider } from '@mtg/llm';
import {
  allocateSlots,
  checkSlotFillability,
  errors,
  failingSlotIds,
  generateSet,
  printsNoText,
  UnfillableSlotsError,
  unfillableSlots,
} from '@mtg/setgen';
import { briefFromFile, shippedBriefNames } from './helpers';

/**
 * Large enough that the profile allocates a colorless noncreature pool at all;
 * below about a hundred cards it does not, which is why no committed brief trips
 * this gate at the size it is actually run at.
 */
const CENSUS_SIZE = 249;

/** Every mechanic in this brief names colors, so no mechanic reaches the colorless pool. */
const colorBound = allocateSlots(briefFromFile('tideglass-reach.json', CENSUS_SIZE)).slots;

describe('checkSlotFillability', () => {
  it('exempts a vanilla creature slot, because a creature prints a body without a word', () => {
    const vanilla = colorBound.filter((slot) => slot.cardKind === 'creature' && printsNoText(slot));
    expect(vanilla.length).toBeGreaterThan(0);
    const blamed = new Set(unfillableSlots(colorBound).map((slot) => slot.id));
    for (const slot of vanilla) expect(blamed.has(slot.id)).toBe(false);
  });

  /**
   * The five slots this file was written about, named because the point is that
   * these exact ones are the population the rescue covers. They are the roles
   * `mtg-g84u` is open on, they still carry those roles, and what changed is
   * that each now prints a static ability instead of nothing.
   */
  it('leaves the gear roles allocated and printable rather than bodiless', () => {
    const gear = colorBound.filter((slot) => slot.color === null && slot.cardKind === 'artifact');
    expect(gear.map((slot) => `${slot.id}:${slot.role}`)).toEqual([
      'CA08:manaArtifact',
      'CA09:landFixing',
      'CA11:manaArtifact',
      'CA12:landFixing',
      'RA04:manaArtifact',
    ]);
    for (const slot of gear) {
      expect(slot.abilityKinds, slot.id).toEqual(['static']);
      expect(printsNoText(slot), slot.id).toBe(false);
    }
    expect(unfillableSlots(colorBound)).toEqual([]);
    expect(checkSlotFillability(colorBound)).toEqual([]);
  });

  /**
   * The rescue is a claim about every brief, not about the one that exposed it,
   * so it is swept over both axes: every brief the repository ships, at every
   * size the derivation builds one at. A color-bound brief is the hard case,
   * because it is the case where no mechanic reaches the colorless pool to fill
   * it the ordinary way, but which of the shipped briefs is color-bound this
   * month is not something this file should be asserting.
   *
   * The briefs come from the directory rather than a list, for two reasons that
   * point the same way: a named list stops covering the corpus the first time
   * somebody adds a brief, and a public test file that names the flagship brief
   * exports a citation of a filename the export rewrites and nothing carries,
   * which the export lane's own public-boundary gate fails on.
   */
  it('leaves no brief able to reach the gate, at any size it builds at', () => {
    const names = shippedBriefNames();
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      for (const size of [100, 150, 200, 249, 250, 253, 261]) {
        const slots = allocateSlots(briefFromFile(name, size)).slots;
        expect(checkSlotFillability(slots), `${name} at ${String(size)}`).toEqual([]);
      }
    }
  });

  /**
   * The two codes are two remedies, and the difference is the whole value of the
   * message: `manaArtifact` and `landFixing` have no profile and none can be
   * written in DSL v0, so a reader told to "write the allowlist" is being sent to
   * do something impossible (`mtg-g84u`).
   *
   * Both arms are pinned by a hand-built slot now. That is the gate's real
   * subject — it is a rule about slots, not about which slots one allocator
   * happens to emit this month — and it is what keeps the check meaningful after
   * the rescue took away the brief that used to reach it.
   */
  it('tells a profileless role not to write an allowlist, and a profiled one to', () => {
    const gear = colorBound.find((slot) => slot.role === 'manaArtifact');
    if (gear === undefined) throw new Error('the color-bound brief allocated no gear slot');
    const bodiless = { ...gear, abilityKinds: [] };

    const profileless = checkSlotFillability([bodiless]);
    expect(profileless.map((item) => item.code)).toEqual(['SLOT_ROLE_UNFILLABLE']);
    expect(profileless[0]?.message).toContain('do not ask for an allowlist here');
    expect(profileless[0]?.message).toContain('mtg-g84u');
    expect(profileless[0]?.message).toContain('manaArtifact');

    const profiled = checkSlotFillability([{ ...bodiless, role: 'removalExile' }]);
    expect(profiled.map((item) => item.code)).toEqual(['SLOT_UNFILLABLE']);
    expect(profiled[0]?.message).toContain('has an effect vocabulary in ROLE_PROFILES');
  });

  /**
   * `TEMPLATE_OVER_CYCLE`, `BLANK_CARD` and `RATE_ABOVE_CURVE` are warnings
   * because `errors()` builds `failingSlotIds` and none of them names a slot a
   * retry can change. This one names its slots and is still free, because
   * `generateSet` refuses before the first fill: inside a run the list is always
   * empty, since the run stopped when it would not have been.
   */
  it('is an error that names its slots, and still bills no retry round', () => {
    const gear = colorBound.find((slot) => slot.role === 'manaArtifact');
    if (gear === undefined) throw new Error('the color-bound brief allocated no gear slot');
    const findings = checkSlotFillability([{ ...gear, abilityKinds: [] }]);
    expect(errors(findings)).toHaveLength(findings.length);
    expect(failingSlotIds(findings)).toEqual([gear.id]);
  });

  /** The size each brief states for itself, which the sweep above does not visit. */
  it('passes the shipped briefs at the size they state', () => {
    for (const name of shippedBriefNames()) {
      const slots = allocateSlots(briefFromFile(name)).slots;
      expect({ name, unfillable: checkSlotFillability(slots) }).toEqual({ name, unfillable: [] });
    }
  });
});

describe('generateSet', () => {
  /**
   * The refusal is still wired and still free — `UnfillableSlotsError` is thrown
   * from the allocation, before the first fill call, so it never builds a retry
   * list. What changed is that the brief which used to prove it no longer does,
   * and asserting the old rejection would now be asserting a defect. So this
   * measures the pass rather than the refusal: the color-bound brief at the size
   * that produced five bodiless slots now gets past the gate and reaches the
   * model, and the error that comes back is the provider's own.
   */
  it('gets a color-bound brief past the gate and on to the model', async () => {
    let calls = 0;
    const provider: LlmProvider = {
      name: 'fixture',
      model: 'reached',
      budget: unlimitedBudget(),
      complete: () => {
        calls += 1;
        return Promise.reject(new Error('the provider was reached'));
      },
    };
    const run = generateSet({ provider, brief: briefFromFile('tideglass-reach.json', CENSUS_SIZE) });
    await expect(run).rejects.toThrow('the provider was reached');
    await expect(run).rejects.not.toBeInstanceOf(UnfillableSlotsError);
    expect(calls).toBeGreaterThan(0);
  });
});
