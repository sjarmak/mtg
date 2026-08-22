import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createFixtureProvider,
  keyForRequest,
  listRunManifests,
  readManifestFixtures,
  toJsonSchema,
} from '@mtg/llm';
import type { JsonSchema } from '@mtg/llm';
import { validateCard, validateSetUniqueness } from '@mtg/dsl';
import type { Slot } from '@mtg/setgen';
import {
  allocateSlots,
  buildFillPrompt,
  FillBatchSchema,
  formatReport,
  generateSet,
  parseBrief,
} from '@mtg/setgen';

/**
 * The recorded live run, replayed.
 *
 * `fixtures/llm/` holds every request/response pair from the one real
 * claude-cli generation of Tideglass Reach. Replaying it costs nothing and
 * exercises the whole pipeline over model output that a person did not write:
 * twelve fill batches, two retry rounds, the critique pass and its revisions.
 * If a change to the allocator, the prompts or the validators alters the shape
 * of the run, the replay stops matching the recorded keys and this fails.
 *
 * Six of the twenty-five fixtures were re-keyed on 2026-08-10 under `mtg-bc2.52`
 * and are not byte-identical to the original capture. Read that as a caveat on
 * their provenance, because it is one. A fixture key is
 * `hash(system, prompt, schema)`, and a fill prompt quotes the rendered oracle
 * text of the cards printed before it; when assembly stopped emitting the same
 * effect twice, seven cards lost a repeated sentence, and six prompts that
 * quoted them changed. Only `request.prompt` was recomputed. Every recorded
 * *response* is the untouched model output, and the pairing is mechanical
 * rather than judged: base and fixed runs make the same twenty-five calls, in
 * the same order, over the same slot sets, with identical system prompts, and
 * the six prompt diffs are only the removal of the duplicated sentences. What
 * this costs is real — for those six the replay can no longer act as a canary
 * for prompt drift against the original capture. Restoring that needs a live
 * re-record, which produces a different set and is therefore its own change.
 *
 * Nine were re-keyed the same way under `mtg-bc2.56`, which narrowed the slot
 * spec: eight slots whose vocabulary can express only one effect now read
 * "exactly 1 entry" instead of "1-2 entries", and nine prompts carry one of
 * those slots. Same procedure, same limits — one line per prompt changed,
 * responses untouched, verified by `canonical()` in the re-key script and by
 * `is keyed by the request it stores` below. Two of the nine (the batches
 * holding UA02 and UU04) now pair an "exactly 1" slot line with a response that
 * wrote the entry twice. That is the defect being fixed, recorded before the
 * fix; it is not the model ignoring an instruction, because the model never saw
 * this wording. Only a live re-record can show what it does when it does.
 *
 * Two more were re-keyed the same way, and this one moved on a single sentence.
 * `ROLE_PROFILES.removalExpensive` carried a substitution note
 * saying DSL v0 has no activated or triggered abilities; five ability slices
 * have landed since, so the note was false and was being printed verbatim into
 * every prompt holding a colorless spell slot. The corrected sentence names the
 * limit that is still real - a trigger cannot choose targets - and nothing else
 * about either request moved: same slot, same role, same effect vocabulary,
 * same cost window, same schema, same recorded response. A live re-record was
 * weighed and rejected: `fixtures/sets/tideglass-reach.set.json` is a committed
 * artifact that eight other packages test against, from the balance gate to the
 * sim bench, so regenerating this run is a change to all of them rather than to
 * this file. The cost is the same one the paragraphs above pay, for two more
 * fixtures.
 *
 * And the same sentence moved again, under `mtg-lr0z`. The corrected text of
 * 2026-08-12 named "a trigger cannot choose its targets" as the limit that was
 * still real, and it was not: `triggerChoosesTargets` landed the next day, and
 * an artifact whose `selfEnters` trigger destroys target creature validates
 * clean. The limit that actually keeps the slot a sorcery is the generator's —
 * `RoleProfile.cardKind` has no artifact arm, and a permanent cannot carry a
 * spell's effect list at all — so the note says that now. Ten fixtures across
 * all four recorded runs held the sentence, two of them twice, and this time
 * the move was made by a committed tool (`tools/rekey-fixtures.ts`) rather than
 * by hand, because it is the third time. Same procedure and same limits: one
 * line per prompt changed, every response untouched, and the four run manifests
 * renamed the moved keys in place so they still name files that are here. The
 * ten recordings answer a question one sentence different from the one now
 * being asked; that is what a re-key buys and it is bought again here.
 */
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_ROOT = join(PACKAGE_ROOT, 'fixtures');
const FIXTURE_DIR = join(FIXTURES_ROOT, 'llm');
const RUN_DIR = join(FIXTURES_ROOT, 'runs');
const BRIEF_PATH = join(PACKAGE_ROOT, 'briefs', 'tideglass-reach.json');

/** Every directory of recorded request/response pairs, whichever run wrote it. */
function fixtureDirs(): readonly string[] {
  return readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('llm'))
    .map((entry) => join(FIXTURES_ROOT, entry.name))
    .sort();
}

describe('the recorded Tideglass Reach run', () => {
  it('replays to an enforceable 90-card set', { timeout: 30_000 }, async () => {
    expect(existsSync(FIXTURE_DIR), `no recorded fixtures at ${FIXTURE_DIR}`).toBe(true);
    const brief = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);
    const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });

    const result = await generateSet({ provider, brief });

    expect(result.cards).toHaveLength(90);
    // Twenty-five calls is the shape of this run — twelve fill batches, two
    // retry rounds, the critique pass and its revisions — and it used to be
    // asserted as "the fixture directory holds twenty-five files". It stopped
    // being that the moment a second run was recorded into the same directory.
    // Said about the run, it survives every future recording.
    expect(result.report.usage.calls).toBe(25);
    // Warnings are output, not failure: the archetype pass reports a partial
    // curve gap or thin answers in a color pair the pie cannot arm. Errors are
    // what "enforceable" means, and there must be none.
    const errors = result.report.findings.filter((item) => item.severity === 'error');
    expect(errors).toStrictEqual([]);
    expect(result.report.archetypes.filter((item) => !item.ok)).toStrictEqual([]);
    expect(result.report.enforceable).toBe(true);
    expect(result.report.legalCards).toBe(90);
  });

  it('prints 90 cards the engine can run and no functional reprints', async () => {
    const brief = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);
    const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });
    const result = await generateSet({ provider, brief });

    // Re-checked here against the DSL directly, not through the pipeline's own
    // report: enforceability is the claim the whole package exists to make.
    for (const card of result.cards) {
      expect(validateCard(card), `${card.name} is not enforceable`).toStrictEqual([]);
    }
    expect(validateSetUniqueness(result.cards)).toStrictEqual([]);
    expect(new Set(result.cards.map((card) => card.name)).size).toBe(result.cards.length);
  });

  it('says how many repeated effects it had to drop', async () => {
    const brief = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);
    const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });
    const result = await generateSet({ provider, brief });

    // Seven of the ninety cards proposed the same effect twice. Two came from
    // slots that could not offer a second, different entry, which mtg-bc2.56
    // fixed in the prompt; the other five came from slots that could, where the
    // design note asks for a second *target* the DSL cannot express. The count
    // is reported rather than swallowed so the next live run can be compared.
    expect(result.report.duplicateEffectsDropped).toBe(7);
    expect(formatReport(result.report)).toContain('7 repeated effect(s) dropped before parsing');
  });

  it('needed retries and produced critique revisions, so the loop really ran', async () => {
    const brief = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);
    const provider = createFixtureProvider({ dir: FIXTURE_DIR, record: false });
    const result = await generateSet({ provider, brief });

    const rounds = result.report.retryRounds;
    expect(rounds.length).toBeGreaterThan(0);
    for (const round of rounds) {
      expect(round.slotIds.length).toBeGreaterThan(0);
      // Targeted regeneration: a round never re-asks for the whole set.
      expect(round.slotIds.length).toBeLessThan(result.allocation.slots.length);
    }
    expect(result.report.critique.ran).toBe(true);
    expect(result.report.critique.revisions.length).toBeGreaterThan(0);
    // Revisions that broke their slot were rolled back rather than printed.
    const reverted = result.report.critique.revisions.filter((item) => item.outcome === 'reverted');
    expect(reverted.length).toBeGreaterThan(0);
  });
});

interface StoredFixture {
  readonly key: string;
  readonly request: { readonly system: string; readonly prompt: string; readonly schema: JsonSchema };
}

/** The effect-budget line this slot is offered, from a prompt for that slot alone. */
function budgetLineFor(slot: Slot, brief: ReturnType<typeof parseBrief>): string {
  const allocation = allocateSlots(brief);
  const prompt = buildFillPrompt({
    brief,
    slots: [slot],
    rarityRules: allocation.profile.rarityRules,
    archetypes: allocation.archetypes,
    priorNames: [],
    sameColorCards: [],
    tierCards: [],
    corrections: new Map(),
    revisions: new Map(),
  });
  const line = prompt.split('\n').find((text) => text.startsWith('  effects:'));
  if (line === undefined) throw new Error(`slot ${slot.id} was offered no effect budget`);
  return line;
}

describe('the slot specs the recording was generated from', () => {
  const brief = parseBrief(JSON.parse(readFileSync(BRIEF_PATH, 'utf8')) as unknown);
  const allocation = allocateSlots(brief);
  const spellSlots = allocation.slots.filter((slot) => slot.effectKinds.length > 0);

  it('asks for exactly one entry on every slot with only one to give', () => {
    const oneEntry = spellSlots.filter((slot) => budgetLineFor(slot, brief).includes('exactly 1 entry'));

    // Eight of the twenty-eight spell slots: a lone `destroyPermanent` or
    // `returnToHand`, neither of which carries a parameter or a second legal
    // target. UA02 and UU04 are two of them, and both printed the same effect
    // twice in the recorded run.
    expect(oneEntry.map((slot) => slot.id)).toStrictEqual([
      'CW12',
      'CU11',
      'CB10',
      'CB13',
      'CA03',
      'UU04',
      'UB03',
      'UA02',
    ]);
    for (const slot of oneEntry) expect(slot.effectKinds).toHaveLength(1);
  });

  it('keeps the 1-2 budget wherever a second entry could differ', () => {
    const twoEntries = spellSlots.filter((slot) => budgetLineFor(slot, brief).includes('1-2 entries'));
    expect(twoEntries.length).toBe(spellSlots.length - 8);

    // CW11 offers two kinds and CR09 a parameter, so both keep the choice: the
    // repeats they produced are a design the vocabulary cannot hold, not a
    // budget the prompt got wrong.
    expect(twoEntries.map((slot) => slot.id)).toContain('CW11');
    expect(twoEntries.map((slot) => slot.id)).toContain('CR09');
  });
});

describe('the recorded fixtures themselves', () => {
  /**
   * Over every recorded fixture there is, rather than over a pinned count.
   *
   * This used to assert the directory held twenty-five files, which was true
   * only while one run had ever been recorded into it. the flagship set
   * recording landed in the same flat cache and the assertion became a headcount
   * of the corpus, which is not a property of anything. The keying is: a fixture
   * whose name does not match its own request is unreachable, and the more
   * recordings share a directory the more that matters. So it runs over every
   * `fixtures/llm*` directory and grows with the corpus instead of fighting it.
   * How many calls one run makes is a fact about that run, and is asserted where
   * the run is replayed, at the top of this file.
   */
  it('are each keyed by the request they store', () => {
    const dirs = fixtureDirs();
    expect(dirs.length).toBeGreaterThan(0);

    // Re-keying a fixture by hand (mtg-bc2.52, mtg-bc2.56) rewrites a prompt and
    // renames the file. The replay only ever looks the file up by name, so a
    // recomputed prompt that did not land in the file it was named for would go
    // unnoticed there. Here it does not.
    let checked = 0;
    for (const dir of dirs) {
      const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
      expect(files.length, `${dir} holds no fixtures`).toBeGreaterThan(0);
      for (const name of files) {
        const stored = JSON.parse(readFileSync(join(dir, name), 'utf8')) as StoredFixture;
        const key = keyForRequest({
          system: stored.request.system,
          prompt: stored.request.prompt,
          jsonSchema: stored.request.schema,
        });
        expect(key, `${join(dir, name)} stores a request that hashes to ${key}`).toBe(
          name.replace(/\.json$/, ''),
        );
        expect(stored.key).toBe(key);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(25);
  });

  it('offers the model no targeting field the prompt has not taught', () => {
    // Half of every fixture key is the JSON Schema of this request, so widening
    // what the model may emit renames all twelve fill fixtures at once. That is
    // why `FilledCardSchema` carries `ModelEffectSchema` rather than the
    // engine's `EffectSchema`: `target.distinct` exists in the DSL and the
    // kernel (mtg-bc2.79) and the prompt says nothing about it yet, so offering
    // it here would ask the model to guess. Teaching it and re-recording is one
    // change (mtg-bc2.80); if this assertion fails, that is the change you are
    // making, and the fixtures have to move with it.
    expect(JSON.stringify(toJsonSchema(FillBatchSchema))).not.toContain('distinct');
  });
});

/**
 * The manifests, against the corpus they index.
 *
 * A manifest is the disk half of a bill, so the ways it can quietly stop being
 * true are the ways a dollar figure quietly stops being true. Three are checked
 * here because only the real corpus can check them: a manifest that answers to
 * a different name than its file, a manifest dated before a file it names, and
 * two runs of one brief filed under one name — the last being how a live
 * regeneration of the flagship erased the record of the run an hour before it.
 */
describe('the run manifests', () => {
  const manifests = listRunManifests(RUN_DIR);

  it('gives every run its own file, so a second recording cannot replace a first', () => {
    expect(manifests.length).toBeGreaterThan(0);

    const ids = manifests.map((manifest) => manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names only fixtures that are here, and none of them twice', () => {
    for (const manifest of manifests) {
      const fixtures = readManifestFixtures(FIXTURE_DIR, manifest);
      expect(fixtures.map((fixture) => fixture.key)).toStrictEqual(manifest.keys);
      expect(manifest.calls).toBeGreaterThanOrEqual(manifest.keys.length);
    }
  });

  it('never claims to have finished before a file it names was written', () => {
    // A manifest that predates its own fixtures is a manifest whose date was
    // guessed. One was: the first flagship run's was reconstructed by hand and
    // set 67 seconds early, which is how this assertion came to exist.
    for (const manifest of manifests) {
      const newest = readManifestFixtures(FIXTURE_DIR, manifest)
        .map((fixture) => fixture.recordedAt)
        .sort()
        .at(-1);
      expect(newest, `${manifest.id} names no fixtures`).toBeDefined();
      expect(
        manifest.recordedAt >= (newest ?? ''),
        `${manifest.id} is dated ${manifest.recordedAt} but names a fixture written at ${newest ?? ''}`,
      ).toBe(true);
    }
  });
});
