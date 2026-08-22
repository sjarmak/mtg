/**
 * The answer schemas the recorded fixtures are keyed to, pinned by digest.
 *
 * A fixture key is `sha256(system, prompt, schema)`, so the JSON Schema a batch
 * is shown is not an implementation detail: it is half the address of 172
 * recorded model calls that cost money to make. `filled.ts` is written around
 * that fact and states the rule in prose — every tier below the one a batch
 * needs stays byte-identical — but prose is not a gate, and the failure it
 * prevents is invisible until a live run reports a cache miss.
 *
 * So the bytes are pinned. Each digest below is `canonicalJson(toJsonSchema(…))`
 * hashed the way `fixtureKey` hashes it, recorded while the corresponding
 * fixtures were replaying. A change that moves one of them is not necessarily
 * wrong — a tier can be deliberately re-recorded — but it is never incidental,
 * and this test is where it has to be said out loud.
 *
 * What this does *not* pin is the prompt, which is the other half of the key and
 * varies per batch by design. `recorded-set.test.ts` and
 * `recorded-abilities.test.ts` cover that end by replaying whole runs; between
 * them and this file both halves of the address are held.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { canonicalJson } from '@mtg/dsl';
import { toJsonSchema } from '@mtg/llm';
import * as setgen from '../src/index';
import {
  FILL_SYSTEM,
  FillBatchSchema,
  FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema,
  FillBatchWithAbilitiesAndSpellPermanentsSchema,
  FillBatchWithAbilitiesAndZoneReachSchema,
  FillBatchWithAbilitiesSchema,
  FillBatchWithEquipAndMechanicsSchema,
  FillBatchWithEquipSchema,
  FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema,
  FillBatchWithMechanicsAndSpellPermanentsSchema,
  FillBatchWithMechanicsAndZoneReachSchema,
  FillBatchWithMechanicsSchema,
  FillBatchWithSpellPermanentsAndZoneReachSchema,
  FillBatchWithSpellPermanentsSchema,
  FillBatchWithZoneReachSchema,
} from '../src/index';

/**
 * The same canonicalization `fixtureKey` applies, truncated to the same width
 * the fixture filenames use. Truncation is fine here for the same reason it is
 * fine there: this is a collision-resistant identity check, not a signature.
 */
function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function schemaDigest(schema: ZodType<unknown>): string {
  return digest(canonicalJson(toJsonSchema(schema)));
}

/**
 * Recorded 2026-08-18, with `fixtures/llm/` (151 calls) and
 * `fixtures/llm-hearthglass/` (21) both replaying clean.
 *
 * Fourteen entries, one per tier `fillSchemaFor` can return. A fifteenth tier
 * added without an entry here fails the completeness check below rather than
 * sliding in unpinned, because a tier nobody pinned is a tier whose bytes
 * nobody is watching. A tier that has never been recorded against is pinned
 * from the commit that adds it, so the run that records it is not the first
 * thing to notice that its bytes moved in between.
 *
 * The six zone-reaching tiers are the second kind: `mtg-q5yg` added them and no
 * recorded call has ever been made against one. Their value here is the eight
 * above them staying exactly as they were, which is the claim the whole tier
 * split rests on and which this file is now the proof of — the widening that
 * added six schemas moved none of the eight digits it must not move.
 *
 * Six digests re-pinned 2026-08-18, and the shape of the move is the reason it
 * is safe: `AuraModificationSchema` gained a `gainControl` member, so every
 * tier whose schema embeds an Aura clause moved and no tier without one did.
 * The six that moved are exactly the six spell-permanent tiers; the other
 * eight, which are the ones 172 recorded calls are addressed to, are
 * byte-identical. `recorded-set.test.ts` and `recorded-abilities.test.ts`
 * replay clean against these bytes, which is what says no recorded call was
 * ever keyed to a spell-permanent tier and that this re-pin bought nothing
 * with money.
 *
 * Five digests re-pinned 2026-08-20, and the shape of that move is the same
 * argument one paragraph up. `CounterKindSchema` gained a `trisigil` member
 * (`mtg-rji`), so every tier whose schema embeds a counter clause moved and no
 * tier without one did: the five that moved are exactly the five mechanics
 * tiers. What says this bought nothing with money is a count rather than a
 * hope. Of the 172 recorded calls in `fixtures/llm/` and
 * `fixtures/llm-hearthglass/`, 87 are keyed to `FillBatchSchema` and 64 to
 * `FillBatchWithAbilitiesSchema`; not one is keyed to any mechanics tier, and
 * the only two fixtures whose recorded schema embeds a counter enum at all
 * still spell it `saberHorn`, so they were staled by the 2026-08-16 rename
 * (7d47f6e) rather than by this. `recorded-set.test.ts` and
 * `recorded-abilities.test.ts` replay clean across the move, which is the same
 * evidence the 2026-08-18 re-pin rested on.
 *
 * The same five re-pinned again on 2026-08-20, for the same reason one layer
 * down. Retiring the Key mechanic in favor of tiered Monster Parts (`mtg-glha`)
 * gave `CounterKindSchema` four keyword-granting members — `wing`, `talon`,
 * `hide`, `fang` — so a rare part can offer a choice of two counters instead of
 * one, and every tier whose schema embeds a counter clause moved. The five that
 * moved are the five mechanics tiers and the other nine are byte-identical,
 * which is the same partition the `trisigil` move produced and is the check that
 * this was the widening it was meant to be rather than a schema drifting. The
 * money argument is unchanged and still a count rather than a hope: no recorded
 * call in either fixture directory is keyed to a mechanics tier, and
 * `recorded-set.test.ts` and `recorded-abilities.test.ts` replay clean across
 * this move too.
 */
const FROZEN_TIERS: Readonly<Record<string, readonly [ZodType<unknown>, string]>> = {
  FillBatchSchema: [FillBatchSchema, '83d93f5a682ec353'],
  FillBatchWithAbilitiesSchema: [FillBatchWithAbilitiesSchema, '6bb604a79195582b'],
  FillBatchWithEquipSchema: [FillBatchWithEquipSchema, '785e7d548aba2b58'],
  FillBatchWithMechanicsSchema: [FillBatchWithMechanicsSchema, '078cca9080c8f3a0'],
  FillBatchWithEquipAndMechanicsSchema: [FillBatchWithEquipAndMechanicsSchema, 'd15da18bdb6d41fa'],
  FillBatchWithSpellPermanentsSchema: [FillBatchWithSpellPermanentsSchema, '8f38a703808c7aac'],
  FillBatchWithAbilitiesAndSpellPermanentsSchema: [
    FillBatchWithAbilitiesAndSpellPermanentsSchema,
    '050ff35398d3cf6f',
  ],
  FillBatchWithMechanicsAndSpellPermanentsSchema: [
    FillBatchWithMechanicsAndSpellPermanentsSchema,
    '6034e32cfb4fccdf',
  ],
  FillBatchWithZoneReachSchema: [FillBatchWithZoneReachSchema, '100294d2d0051380'],
  FillBatchWithAbilitiesAndZoneReachSchema: [FillBatchWithAbilitiesAndZoneReachSchema, '95e985b14e5d6f3b'],
  FillBatchWithMechanicsAndZoneReachSchema: [FillBatchWithMechanicsAndZoneReachSchema, '2f8f053b3bfa581d'],
  FillBatchWithSpellPermanentsAndZoneReachSchema: [
    FillBatchWithSpellPermanentsAndZoneReachSchema,
    'c1a8642273536a3f',
  ],
  FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema: [
    FillBatchWithAbilitiesAndSpellPermanentsAndZoneReachSchema,
    '4fe4508838ec1404',
  ],
  FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema: [
    FillBatchWithMechanicsAndSpellPermanentsAndZoneReachSchema,
    'c75c95b6faf58660',
  ],
};

/** The system prompt is the third component of the key and varies with nothing. */
const FILL_SYSTEM_DIGEST = '88c9fb9f3e0f931d';

describe('the answer schemas recorded fixtures are keyed to', () => {
  for (const [name, [schema, expected]] of Object.entries(FROZEN_TIERS)) {
    it(`${name} still hashes to the bytes its fixtures were recorded against`, () => {
      expect(schemaDigest(schema)).toBe(expected);
    });
  }

  it('holds the fill system prompt to the same standard', () => {
    // Unlike a tier, this one has no per-batch escape: `buildFillPrompt` hands
    // the same system string to every call there has ever been, so a change
    // here orphans all 172 at once rather than the subset that needed a
    // widening.
    expect(digest(FILL_SYSTEM)).toBe(FILL_SYSTEM_DIGEST);
  });

  it('pins every tier the package exports, so a fifteenth cannot arrive unwatched', () => {
    // Read off the module rather than off `fillSchemaFor`, which returns
    // `ZodType<FillBatch>` and so cannot be asked which tiers exist. The naming
    // convention is the whole index: every answer schema a batch is shown is a
    // `FillBatch…Schema`, and nothing else in the package is.
    const exported = Object.keys(setgen)
      .filter((name) => name.startsWith('FillBatch') && name.endsWith('Schema'))
      .sort();
    expect(exported).toStrictEqual(Object.keys(FROZEN_TIERS).sort());
  });

  it('gives every distinct tier its own address', () => {
    // Two tiers hashing alike would mean one of them is not a tier: the whole
    // device is that a batch needing the wider schema is shown different bytes
    // from a batch that does not.
    const digests = Object.values(FROZEN_TIERS).map(([schema]) => schemaDigest(schema));
    expect(new Set(digests).size).toBe(digests.length);
  });
});
