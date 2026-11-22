/** Local anti-reuse ledger. Interrupted reservations stay consumed; never auto-clear a stale lock. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { sourceKey } from './human-evidence';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z
  .object({
    proposal: sha,
    holdout: sha,
    sources: z
      .array(
        z
          .object({
            url: z
              .string()
              .url()
              .max(2000)
              .refine((value) => {
                const url = new URL(value);
                return url.protocol === 'https:' && !url.username && !url.password;
              })
              .transform(sourceKey),
            session: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(10000),
  })
  .strict();
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');

async function assertUnused(root: string, request: z.infer<typeof requestSchema>): Promise<void> {
  const names = (await readdir(root)).filter(
    (name) => name.startsWith('reservation-') && name.endsWith('.json'),
  );
  for (const name of names) {
    // A partial/corrupt journal blocks further review; no incomplete claim set can silently be reused.
    const previous = requestSchema.parse(JSON.parse(await readFile(join(root, name), 'utf8')) as unknown);
    if (name !== `reservation-${digest(previous)}.json`) throw new Error('Reservation digest mismatch');
    if (request.sources.some((s) => previous.sources.some((p) => s.url === p.url || s.session === p.session)))
      throw new Error('Holdout source/session already used by a recorded reservation');
  }
}

/** The directory is an explicit caller-owned local path, not a remote or user-supplied web location. */
export async function reserveHoldoutReview(directory: string, input: unknown) {
  const request = requestSchema.parse(input);
  const root = resolve(directory);
  const lock = join(root, '.reservation-lock');
  await mkdir(root, { recursive: true });
  await mkdir(lock); // EEXIST refuses concurrency or an interrupted lock; no polling or stale-lock deletion.
  try {
    await assertUnused(root, request);
    const id = digest(request);
    const path = join(root, `reservation-${id}.json`);
    await writeFile(path, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx' });
    return { id, path };
  } finally {
    await rmdir(lock);
  }
}
