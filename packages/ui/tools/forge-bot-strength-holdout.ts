/** Prepare or execute the sealed general cross-format Forge holdout. */
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGeneralForgeCampaign, type GeneralForgeCampaignDecks } from './forge-bot-strength-pilot';
import {
  loadGeneralForgeHoldoutInputs,
  prepareGeneralForgeHoldoutInputs,
  type GeneralForgeHoldoutSpecification,
} from './general-forge-holdout-input';

type Command =
  | Readonly<{
      kind: 'prepare';
      directory: string;
      specification?: GeneralForgeHoldoutSpecification | undefined;
    }>
  | Readonly<{
      kind: 'run';
      input: string;
      output: string;
      campaign?: Readonly<{ id: string; split: 'tuning'; seedPrefix: string }> | undefined;
    }>;

function preparationSeed(value: string | undefined, name: string): number {
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed <= 0) throw new Error(`${name} must be a positive safe integer`);
  return seed;
}

export function parseGeneralForgeHoldoutCommand(args: readonly string[]): Command {
  if (args.length === 2 && args[0] === '--prepare' && (args[1] ?? '').trim() !== '') {
    return { kind: 'prepare', directory: resolve(args[1]!) };
  }
  if (
    args.length === 8 &&
    args[0] === '--prepare' &&
    (args[1] ?? '').trim() !== '' &&
    args[2] === '--campaign' &&
    /^general-forge-holdout-v[1-9][0-9]*$/u.test(args[3] ?? '') &&
    args[4] === '--draft-seed' &&
    args[6] === '--sealed-seed'
  ) {
    const draftSeed = preparationSeed(args[5], 'draft seed');
    const sealedSeed = preparationSeed(args[7], 'sealed seed');
    if (draftSeed === sealedSeed) throw new Error('draft and sealed seeds must be distinct');
    return {
      kind: 'prepare',
      directory: resolve(args[1]!),
      specification: { campaignId: args[3]!, draftSeed, sealedSeed },
    };
  }
  if (
    args.length === 4 &&
    args[0] === '--input' &&
    (args[1] ?? '').trim() !== '' &&
    args[2] === '--out' &&
    (args[3] ?? '').trim() !== ''
  ) {
    return { kind: 'run', input: resolve(args[1]!), output: resolve(args[3]!) };
  }
  if (
    args.length === 6 &&
    args[0] === '--tuning-input' &&
    (args[1] ?? '').trim() !== '' &&
    args[2] === '--out' &&
    (args[3] ?? '').trim() !== '' &&
    args[4] === '--campaign' &&
    /^general-forge-[a-z0-9]+(?:-[a-z0-9]+)*-tuning-v[1-9][0-9]*$/u.test(args[5] ?? '')
  ) {
    const id = args[5]!;
    return {
      kind: 'run',
      input: resolve(args[1]!),
      output: resolve(args[3]!),
      campaign: { id, split: 'tuning', seedPrefix: id },
    };
  }
  throw new Error(
    'usage: tsx packages/ui/tools/forge-bot-strength-holdout.ts --prepare <new-input-directory> [--campaign <general-forge-holdout-vN> --draft-seed <integer> --sealed-seed <integer>]\n' +
      '   or: tsx packages/ui/tools/forge-bot-strength-holdout.ts --input <sealed-input-directory> --out <new-run-directory>\n' +
      '   or: tsx packages/ui/tools/forge-bot-strength-holdout.ts --tuning-input <sealed-input-directory> --out <new-run-directory> --campaign <general-forge-*-tuning-vN>',
  );
}

export async function executeGeneralForgeHoldoutCommand(repoRoot: string, command: Command): Promise<void> {
  if (command.kind === 'prepare') {
    const manifest = await prepareGeneralForgeHoldoutInputs(
      repoRoot,
      command.directory,
      command.specification,
    );
    process.stdout.write(`${JSON.stringify({ directory: command.directory, manifest })}\n`);
    return;
  }
  const sealed = loadGeneralForgeHoldoutInputs(command.input);
  const byId = Object.fromEntries(sealed.decks) as unknown as GeneralForgeCampaignDecks;
  const manifestSha256 = createHash('sha256').update(JSON.stringify(sealed.manifest)).digest('hex');
  await runGeneralForgeCampaign(repoRoot, command.output, byId, {
    campaign: command.campaign ?? {
      id: sealed.manifest.campaignId,
      split: sealed.manifest.split,
      seedPrefix: sealed.manifest.campaignId,
    },
    baseline: 'legal-v1',
    inputAttestation: {
      version: sealed.manifest.version,
      manifestSha256,
      directory: command.input,
    },
  });
}

const invoked =
  process.argv[1] === undefined ? false : resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  await executeGeneralForgeHoldoutCommand(repoRoot, parseGeneralForgeHoldoutCommand(process.argv.slice(2)));
}
