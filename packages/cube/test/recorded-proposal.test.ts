/**
 * One live model call, recorded, replayed.
 *
 * Every other test in this package scripts the model, which is right for the
 * repair loop and wrong for the question of whether a real model, given this
 * prompt, returns something the gate can use. This one answers that question
 * against output a person did not write: `claude-fable-5` was asked for
 * eighteen cards over the thirty-nine-card stand-in pool in
 * `support/recorded-pool.ts`, and the pair is committed under `fixtures/llm/`.
 * Replaying costs nothing and reaches no network, which is why `fixture` is the
 * only provider tests may use.
 *
 * Re-record with `npx tsx packages/cube/tools/record-proposal.ts` — required
 * whenever the prompt changes, because half the fixture key is the prompt.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '@mtg/llm';
import { createFixtureProvider, keyForRequest } from '@mtg/llm';
import { normalizeName } from '@mtg/decklab';
import { proposeCubeCards, verifyCubeProposals } from '../src/propose';
import { measureCube, validateCube } from '../src/validate';
import {
  DERIVED_EXCLUDED,
  FIXTURE_DIR,
  RECORDED_CRITERIA,
  RECORDED_NEED,
  RECORDED_POOL,
} from './support/recorded-pool';

async function replay() {
  const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });
  const proposal = await proposeCubeCards(provider, RECORDED_CRITERIA, RECORDED_POOL, RECORDED_NEED, [], []);
  return {
    proposal,
    verified: verifyCubeProposals({
      proposals: proposal.cards,
      pool: RECORDED_POOL,
      criteria: RECORDED_CRITERIA,
      accepted: [],
      room: RECORDED_NEED,
    }),
  };
}

describe('the recorded live round', () => {
  it('returns the eighteen cards it was asked for, under the schema', async () => {
    expect(existsSync(FIXTURE_DIR), `no recorded fixture at ${FIXTURE_DIR}`).toBe(true);
    const { proposal } = await replay();
    expect(proposal.cards).toHaveLength(RECORDED_NEED);
    expect(proposal.plan.length).toBeGreaterThan(0);
    for (const card of proposal.cards) expect(card.archetypes.length).toBeGreaterThan(0);
  });

  it('is separated into what the cube may hold and what it may not', async () => {
    const { verified } = await replay();
    expect(verified.inclusions).toHaveLength(13);
    // The five cards outside the stand-in pool are real Modern cards — three
    // boros staples (Skyclave Apparition, Adeline, Bonecrusher Giant) and two
    // black control staples (Damnation, Liliana of the Veil) — so the gate owes
    // the model "those are not available here", not "you made them up". Which
    // cards those are comes from the store rather than from this file: it is
    // the excluded list `tools/record-proposal.ts` derived from this very
    // answer.
    expect(verified.rejections.map((rejection) => rejection.name)).toStrictEqual(DERIVED_EXCLUDED.names);
    expect(verified.rejections.map((rejection) => rejection.code)).toStrictEqual(
      DERIVED_EXCLUDED.names.map(() => 'not-in-universe'),
    );
  });

  it('accepts nothing it cannot cast in the archetype it was tagged with', async () => {
    const { verified } = await replay();
    const byName = new Map(RECORDED_CRITERIA.archetypes.map((entry) => [entry.name, entry]));
    for (const inclusion of verified.inclusions) {
      for (const tag of inclusion.archetypes) {
        const archetype = byName.get(tag);
        expect(archetype, `${inclusion.card.name} cited an archetype nobody stated`).toBeDefined();
        for (const letter of inclusion.card.colorIdentity) {
          expect(archetype?.colors, `${inclusion.card.name} is ${tag} but {${letter}}`).toContain(letter);
        }
      }
    }
  });

  it('leaves both archetypes a card short, and the measurement says which', async () => {
    const { verified } = await replay();
    const measurement = measureCube(verified.inclusions, RECORDED_CRITERIA);
    expect(measurement.archetypes).toStrictEqual([
      { name: 'boros aggro', playable: 6, required: 9 },
      { name: 'dimir control', playable: 7, required: 9 },
    ]);

    // Six boros cards landed and seven dimir, because three of the eighteen
    // cards the model named for boros and two of the ones it named for dimir
    // were outside the pool. That is the whole point of measuring rather than
    // trusting: the round looked complete and was not.
    const findings = validateCube(verified.inclusions, RECORDED_CRITERIA).findings;
    expect(findings.filter((finding) => finding.code === 'archetype-support')).toStrictEqual([
      {
        code: 'archetype-support',
        subject: 'boros aggro',
        measured: 6,
        required: 9,
        detail: 'boros aggro has 6 playable cards against 9 required',
      },
      {
        code: 'archetype-support',
        subject: 'dimir control',
        measured: 7,
        required: 9,
        detail: 'dimir control has 7 playable cards against 9 required',
      },
    ]);
  });
});

describe('the excluded list beside the recording', () => {
  /**
   * The list used to be a literal holding the one name the recorded model
   * happened to say, which made the assertion above partly constructed after
   * seeing the answer (mtg-bc2.125). It is now written by
   * `tools/record-proposal.ts` from the store, and these are the two properties
   * that make it a derivation rather than a hand-list — both checkable with no
   * store, which is what CI has.
   */
  it('holds only names the recorded answer actually used', async () => {
    const { proposal } = await replay();
    const said = new Set(proposal.cards.map((card) => normalizeName(card.name)));
    for (const name of DERIVED_EXCLUDED.names) {
      expect(said.has(normalizeName(name)), `${name} is not a name the recording used`).toBe(true);
    }
    expect(DERIVED_EXCLUDED.names.length).toBeGreaterThan(0);
  });

  it('holds nothing the stand-in pool already has, and names the recording it came from', () => {
    for (const name of DERIVED_EXCLUDED.names) {
      expect(RECORDED_POOL.universe.byName.has(normalizeName(name)), `${name} is in the pool`).toBe(false);
    }
    const [file] = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
    expect(DERIVED_EXCLUDED.fixtureKey).toBe((file ?? '').replace(/\.json$/, ''));
  });
});

interface StoredFixture {
  readonly key: string;
  readonly request: { readonly system: string; readonly prompt: string; readonly schema: JsonSchema };
}

describe('the fixture on disk', () => {
  it('is keyed by the request it stores', () => {
    const files = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(1);
    for (const name of files) {
      const stored = JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as StoredFixture;
      const key = keyForRequest({
        system: stored.request.system,
        prompt: stored.request.prompt,
        jsonSchema: stored.request.schema,
      });
      expect(key, `${name} stores a request that hashes to ${key}`).toBe(name.replace(/\.json$/, ''));
      expect(stored.key).toBe(key);
    }
  });

  it('was recorded from a live provider, not written by hand', () => {
    const [name] = readdirSync(FIXTURE_DIR).filter((file) => file.endsWith('.json'));
    expect(name).toBeDefined();
    const stored = JSON.parse(readFileSync(join(FIXTURE_DIR, name ?? ''), 'utf8')) as {
      readonly provider: string;
      readonly model: string;
    };
    expect(stored.provider).toBe('claude-cli');
    expect(stored.model).not.toBe('fixture');
  });
});
