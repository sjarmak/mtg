/**
 * `tsx packages/setgen/tools/adjudicate.ts` — the playtester's independent
 * faithfulness pass over the same seeded sample the critic judges.
 *
 * This file is the one place in this bead's tooling that must never see a
 * critic verdict before recording a human judgment, and that is not a
 * discipline this file has to maintain — it is a fact about its imports.
 * Nothing here imports `../src/critic/critic.ts`, `../src/critic/records.ts`'s
 * verdict schema, or `run-critic.ts`. It reads and writes only an
 * `AdjudicationFile` (`../src/critic/records.ts`), built from the same pool
 * and the same seed `run-critic.ts` draws its sample from
 * (`../src/critic/pool.ts`, `../src/critic/sample.ts`), and never opens the
 * verdicts file `run-critic.ts` writes. `test/critic/no-contamination.test.ts`
 * checks this file's own source text for exactly that.
 *
 * Resumable: an interrupted session's answers are already on disk, and
 * restarting with the same `--seed`/`--size` skips every slot already
 * answered and picks up at the next one.
 *
 *   tsx packages/setgen/tools/adjudicate.ts --seed critic-sample-1 --size 60 --rater the playtester
 */
import { createInterface } from 'node:readline/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOracleText } from '@mtg/dsl';
import {
  answeredSlotIds,
  parseAdjudicateArgs,
  pendingEntries,
  recordAnswer,
} from '../src/critic/adjudication';
import { describeIntent } from '../src/critic/intent';
import { loadTideglassEntryPool } from '../src/critic/pool';
import { loadAdjudicationFile, saveAdjudicationFile } from '../src/critic/records';
import type { AdjudicationAnswer, AdjudicationCriterionAnswer } from '../src/critic/records';
import { criteriaFor, FAITHFULNESS_LABELS } from '../src/critic/rubric';
import type { FaithfulnessLabel } from '../src/critic/rubric';
import { selectSample } from '../src/critic/sample';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SEED = 'critic-sample-1';
export const DEFAULT_SIZE = 60;

const LABEL_KEYS: Readonly<Record<string, FaithfulnessLabel>> = {
  f: 'faithful',
  p: 'partial',
  u: 'unfaithful',
};

interface Prompter {
  ask(question: string): Promise<string>;
  close(): void;
}

function terminalPrompter(): Prompter {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return { ask: (question: string) => rl.question(question), close: () => rl.close() };
}

async function askLabel(prompter: Prompter, question: string): Promise<FaithfulnessLabel> {
  for (;;) {
    const raw = (await prompter.ask(`${question} [f]aithful/[p]artial/[u]nfaithful: `)).trim().toLowerCase();
    if (LABEL_KEYS[raw] !== undefined) return LABEL_KEYS[raw];
    if ((FAITHFULNESS_LABELS as readonly string[]).includes(raw)) return raw as FaithfulnessLabel;
    console.log(`  not understood: "${raw}". Type f, p, u, or the full word.`);
  }
}

async function askNote(prompter: Prompter, question: string): Promise<string | undefined> {
  const note = (await prompter.ask(`${question} (Enter to skip): `)).trim();
  return note.length === 0 ? undefined : note;
}

export async function main(argv: readonly string[]): Promise<number> {
  const options = parseAdjudicateArgs(argv, DEFAULT_SEED, DEFAULT_SIZE, (seed) =>
    join(PACKAGE_ROOT, 'out', 'critic', `adjudication-${seed}.json`),
  );
  const pool = await loadTideglassEntryPool();
  const sample = selectSample(pool.entries, { seed: options.seed, size: options.size });
  let file = loadAdjudicationFile(options.outPath, options.seed, options.size);
  const alreadyDone = answeredSlotIds(file).size;
  const pending = pendingEntries(sample, file);

  console.log(`sample: ${sample.length} cards, seed "${options.seed}"`);
  console.log(`resuming: ${alreadyDone} already answered, ${pending.length} remaining\n`);
  if (pending.length === 0) {
    console.log('nothing left to answer.');
    return 0;
  }

  const prompter = terminalPrompter();
  try {
    for (const sampled of pending) {
      const entry = sampled.entry;
      const revisedSlotIds = new Set(
        pool.revisions
          .filter((revision) => revision.outcome === 'applied')
          .map((revision) => revision.slotId),
      );
      const criteria = criteriaFor(entry, revisedSlotIds);

      console.log(`\n[${sampled.position}/${sample.length}] slot ${entry.slot.id} — "${entry.card.name}"`);
      console.log('\ndesign intent:');
      console.log(describeIntent(entry, pool.brief, pool.revisions));
      console.log('\nprinted card:');
      console.log(renderOracleText(entry.card));
      console.log('');

      const criteriaAnswers: AdjudicationCriterionAnswer[] = [];
      for (const criterion of criteria) {
        const label = await askLabel(prompter, criterion);
        const note = await askNote(prompter, `  note on ${criterion}`);
        criteriaAnswers.push({ criterion, label, ...(note === undefined ? {} : { note }) });
      }
      const overallLabel = await askLabel(prompter, 'overall');
      const overallNote = await askNote(prompter, '  note on overall');

      const answer: AdjudicationAnswer = {
        slotId: entry.slot.id,
        cardName: entry.card.name,
        position: sampled.position,
        criteria: criteriaAnswers,
        overall: { label: overallLabel, ...(overallNote === undefined ? {} : { note: overallNote }) },
        answeredAt: new Date().toISOString(),
      };
      file = recordAnswer(file, answer);
      saveAdjudicationFile(options.outPath, file);
      console.log(`  saved (${file.answers.length}/${sample.length}) -> ${options.outPath}`);
    }
  } finally {
    prompter.close();
  }

  console.log(`\ndone: ${file.answers.length}/${sample.length} answered, written to ${options.outPath}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 2;
    });
}
