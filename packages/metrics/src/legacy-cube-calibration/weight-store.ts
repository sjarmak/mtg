/** Append-only installation mechanism. A decision digest is provenance, NOT adoption authorization.
 * Only the adoption orchestrator may install reviewed weights; no CLI exposes this primitive.
 * The local journal detects damage, not an operator rewriting or deleting the entire history.
 */
import { createHash } from 'node:crypto';
import { link, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { DEFAULT_ADVISOR_WEIGHTS, parseAdvisorWeights } from '@mtg/draft-export';
import { readCalibrationJson } from './artifact-io';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const identitySchema = z.object({ catalogSha256: sha, modelSha256: sha }).strict();
const actionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('install'),
      weights: z.unknown().transform(parseAdvisorWeights),
      decisionSha256: sha,
    })
    .strict(),
  z.object({ kind: z.literal('rollback'), toSequence: z.number().int().min(0).max(99999999) }).strict(),
]);
const recordSchema = z
  .object({
    version: z.literal('legacy-cube-weight-transition/v1'),
    sequence: z.number().int().min(1).max(99999999),
    parent: sha.nullable(),
    identity: identitySchema,
    action: actionSchema,
    weights: z.unknown().transform(parseAdvisorWeights),
    sha256: sha,
  })
  .strict();
type Record = z.infer<typeof recordSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nameOf = (sequence: number) => `${String(sequence).padStart(8, '0')}.json`;

function weightsFor(action: z.infer<typeof actionSchema>, history: readonly Record[]) {
  if (action.kind === 'install') return action.weights;
  if (action.toSequence > history.length) throw new Error('Rollback sequence does not exist');
  return action.toSequence === 0 ? DEFAULT_ADVISOR_WEIGHTS : history[action.toSequence - 1]!.weights;
}

async function historyNames(root: string) {
  try {
    const entries = await readdir(root);
    const names = entries.filter((name) => name !== '.weight-lock');
    if (names.some((name) => !/^\d{8}\.json$/.test(name))) throw new Error('Unexpected weight history file');
    return { names: names.sort(), transitionPending: entries.includes('.weight-lock') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { names: [], transitionPending: false };
    throw error;
  }
}

/** Readers see a complete old or new journal prefix; a pending file lives only inside the lock. */
export async function readWeightStore(directory: string, identityInput: unknown) {
  const identity = identitySchema.parse(identityInput);
  const root = resolve(directory);
  const { names, transitionPending } = await historyNames(root);
  let history: readonly Record[] = [];
  for (const [index, name] of names.entries()) {
    if (name !== nameOf(index + 1)) throw new Error('Weight history sequence is incomplete');
    const input = await readCalibrationJson(join(root, name));
    const record = recordSchema.parse(input);
    const { sha256, ...body } = record;
    if (
      record.sequence !== index + 1 ||
      record.parent !== (history.at(-1)?.sha256 ?? null) ||
      !isDeepStrictEqual(record.identity, identity) ||
      digest(body) !== sha256 ||
      !isDeepStrictEqual(input, record) ||
      !isDeepStrictEqual(record.weights, weightsFor(record.action, history))
    )
      throw new Error('Modified or stale weight history');
    history = [...history, record];
  }
  return {
    head: history.at(-1)?.sha256 ?? null,
    weights: history.at(-1)?.weights ?? DEFAULT_ADVISOR_WEIGHTS,
    history,
    transitionPending,
  };
}

async function publish(root: string, lock: string, record: Record) {
  const pending = join(lock, 'pending.json');
  const file = await open(pending, 'wx');
  try {
    await file.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  // Same-filesystem hard-link publication is exclusive and never exposes partial JSON.
  await link(pending, join(root, nameOf(record.sequence)));
  await unlink(pending);
}

/** Compare-and-swap with a crash-visible lock. Rollback appends; it never deletes prior decisions.
 * On IO failure retain the lock for operator inspection, including ambiguous post-publication failure.
 */
export async function transitionWeights(
  directory: string,
  identityInput: unknown,
  expectedHeadInput: unknown,
  actionInput: unknown,
) {
  const identity = identitySchema.parse(identityInput);
  const expectedHead = sha.nullable().parse(expectedHeadInput);
  const action = actionSchema.parse(actionInput);
  const root = resolve(directory);
  const lock = join(root, '.weight-lock');
  await mkdir(root, { recursive: true });
  await mkdir(lock);
  let publicationStarted = false;
  try {
    const previous = await readWeightStore(root, identity);
    if (previous.head !== expectedHead) throw new Error('Stale weight transition baseline');
    const body = {
      version: 'legacy-cube-weight-transition/v1' as const,
      sequence: previous.history.length + 1,
      parent: previous.head,
      identity,
      action,
      weights: weightsFor(action, previous.history),
    };
    const record = recordSchema.parse({ ...body, sha256: digest(body) });
    publicationStarted = true;
    await publish(root, lock, record);
    await rmdir(lock);
    return {
      head: record.sha256,
      weights: record.weights,
      history: [...previous.history, record],
      transitionPending: false,
    };
  } catch (error) {
    if (!publicationStarted) await rmdir(lock);
    throw error;
  }
}
