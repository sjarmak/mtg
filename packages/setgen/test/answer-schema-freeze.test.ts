/**
 * The compatibility contract between capability-addressed answer schemas and
 * paid recordings.
 *
 * A fixture's exact address still includes its JSON Schema, so unrelated
 * requests cannot collide. On an exact miss, however, the fixture transport may
 * reuse an older answer when the requested schema differs only by added enum
 * members or union arms and that answer validates against its recorded schema.
 * This file exercises that rule for every registered capability. A new flag
 * cannot arrive unwatched, and an additive effect kind no longer requires a raw
 * digest re-pin or a paid re-recording.
 *
 * The invariant deliberately remains asymmetric: narrowing or changing a
 * constraint is incompatible. Whole-run replay tests hold the varying prompts;
 * the one shared system prompt remains pinned below because changing it changes
 * the meaning of every recorded call rather than widening its answer space.
 */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ZodType } from 'zod';
import {
  createFixtureTransport,
  fixtureKey,
  isStrictlyAdditiveSchemaWidening,
  readFixture,
  toJsonSchema,
} from '@mtg/llm';
import { FILL_CAPABILITIES, FILL_SYSTEM, fillSchemaForCapabilities } from '../src/index';
import type { FillCapability } from '../src/index';

/**
 * The same canonicalization `fixtureKey` applies, truncated to the same width
 * the fixture filenames use. Truncation is fine here for the same reason it is
 * fine there: this is a collision-resistant identity check, not a signature.
 */
function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function addressFor(flag: FillCapability): readonly FillCapability[] {
  return flag === 'controlledCreatureCounterOnEntry' || flag === 'fightOpposingCreature'
    ? ['abilities', flag]
    : [flag];
}

const FLAG_SCHEMAS: Readonly<Record<FillCapability, ZodType<unknown>>> = Object.fromEntries(
  FILL_CAPABILITIES.map((flag) => [flag, fillSchemaForCapabilities(addressFor(flag))]),
) as Readonly<Record<FillCapability, ZodType<unknown>>>;

function withAddedUnionArm(schema: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const copy = structuredClone(schema);
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    const union = record['oneOf'];
    if (
      Array.isArray(union) &&
      union.some((arm) => {
        if (typeof arm !== 'object' || arm === null || Array.isArray(arm)) return false;
        const properties = (arm as Record<string, unknown>)['properties'];
        if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
          return false;
        }
        const kind = (properties as Record<string, unknown>)['kind'];
        return (
          typeof kind === 'object' &&
          kind !== null &&
          !Array.isArray(kind) &&
          (kind as Record<string, unknown>)['const'] === 'dealDamage'
        );
      })
    ) {
      union.push({ type: 'object', properties: { kind: { const: 'testOnlyEffect' } } });
      return true;
    }
    return Object.values(record).some(visit);
  };
  if (!visit(copy)) throw new Error('test tier has no model-effect union to widen');
  return copy;
}

/** The system prompt is the third component of the key and varies with nothing. */
const FILL_SYSTEM_DIGEST = '88c9fb9f3e0f931d';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIRS = ['llm', 'llm-hearthglass'].map((name) => join(PACKAGE_ROOT, 'fixtures', name));

describe('the answer schemas recorded fixtures are keyed to', () => {
  for (const [name, schema] of Object.entries(FLAG_SCHEMAS)) {
    it(`${name} treats an added union arm as compatible with its old recordings`, () => {
      const before = toJsonSchema(schema);
      const after = withAddedUnionArm(before);
      expect(isStrictlyAdditiveSchemaWidening(before, after)).toBe(true);
      expect(fixtureKey({ system: FILL_SYSTEM, prompt: 'one batch', jsonSchema: before })).not.toBe(
        fixtureKey({ system: FILL_SYSTEM, prompt: 'one batch', jsonSchema: after }),
      );
    });
  }

  it('holds the fill system prompt to the same standard', () => {
    // Unlike a tier, this one has no per-batch escape: `buildFillPrompt` hands
    // the same system string to every call there has ever been, so a change
    // here orphans all 172 at once rather than the subset that needed a
    // widening.
    expect(digest(FILL_SYSTEM)).toBe(FILL_SYSTEM_DIGEST);
  });

  it('enumerates every capability flag, so a new switch cannot arrive unwatched', () => {
    expect(Object.keys(FLAG_SCHEMAS)).toStrictEqual([...FILL_CAPABILITIES]);
  });

  it('gives every distinct tier its own address', () => {
    // Two tiers hashing alike would mean one of them is not a tier: the whole
    // device is that a batch needing the wider schema is shown different bytes
    // from a batch that does not.
    const keys = Object.values(FLAG_SCHEMAS).map((schema) =>
      fixtureKey({ system: FILL_SYSTEM, prompt: 'one batch', jsonSchema: toJsonSchema(schema) }),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it(
    'replays every old-tier recording after an additive effect-kind widening',
    // Budgeted at 70s rather than the 30s this test carried before. Measured
    // alone, MTG_TEST_WORKERS=1, three runs at host load 11.5 to 11.8 on 16
    // cores: 11.96s, 13.88s and 15.59s, so 70s is about 4.5x the worst run.
    // The 30s budget was already too tight at that load (under 2x the worst
    // run) and timed out under the heavier load a review gate runs at. Scoped
    // to this test rather than the file: it is the only slow test here, and
    // the other 14 finish in single-digit milliseconds (mtg-mitcn).
    { timeout: 70_000 },
    async () => {
      const expected: string[] = [];
      const served: string[] = [];

      for (const dir of FIXTURE_DIRS) {
        const transport = createFixtureTransport({
          dir,
          record: false,
          env: {},
          onCall: (key) => served.push(key),
        });
        for (const name of readdirSync(dir).filter((entry) => /^[0-9a-f]{32}\.json$/.test(entry))) {
          const fixture = readFixture(join(dir, name));
          let after: Readonly<Record<string, unknown>>;
          try {
            after = withAddedUnionArm(fixture.request.schema);
          } catch (error) {
            if (error instanceof Error && error.message === 'test tier has no model-effect union to widen') {
              continue;
            }
            throw error;
          }
          const oldAnswer = z.fromJSONSchema(fixture.request.schema);
          if (!oldAnswer.safeParse(fixture.response.structured).success) continue;

          expected.push(fixture.key);
          await transport.send({
            system: fixture.request.system,
            prompt: fixture.request.prompt,
            jsonSchema: after,
            maxTokens: 1,
          });
        }
      }

      expect(expected.length, 'no paid recording exercised this tier').toBeGreaterThan(0);
      expect(served).toStrictEqual(expected);
    },
  );
});
