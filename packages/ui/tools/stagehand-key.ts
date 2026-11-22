/**
 * The credential the Stagehand prototype path (`--max-usd` on
 * `live-journey.ts`) needs before it may start: the direct Jev key,
 * `TYPESAFE_API_KEY` (`mtg-onjme.2`).
 *
 * Only Jev's call needs a key. The `observe()` model call goes through
 * `@mtg/llm`, whose provider is resolved separately (`stagehand-provider.ts`).
 *
 * The key comes from the process environment or from one named variable in the
 * file `--env-file` names, read with `readEnvFileVariable` from the Jev
 * labeler's own key module, so there is one dotenv reader in the workspace,
 * not two. There is no default file and no search: without `--env-file` the
 * environment is the only place looked. The value is returned in memory and no
 * message built here contains it or anything else the file holds; a refusal
 * names the variable and the file it was given, and nothing more.
 */
import { existsSync } from 'node:fs';
import { readEnvFileVariable } from '../../draft-export/tools/jev-label/gateway-key';
import { JEV_DIRECT_KEY_VARIABLE } from '../../draft-export/tools/jev-label/jev-client';

export const STAGEHAND_KEY_VARIABLE = JEV_DIRECT_KEY_VARIABLE;

/** Named so a caller can tell "armed but keyless" apart from any other startup failure. */
export class StagehandKeyMissingError extends Error {
  constructor(variable: string, envFile: string | null, fileExists: boolean) {
    const where =
      envFile === null
        ? 'is not set in the environment, and no --env-file was given to read it from'
        : fileExists
          ? `is not set in the environment or in ${envFile}`
          : `is not set in the environment, and --env-file ${envFile} does not exist`;
    super(`${variable} ${where}; the Stagehand path (--max-usd) needs it and refuses to start without it.`);
    this.name = 'StagehandKeyMissingError';
  }
}

/**
 * Throws, naming the variable and the file it was given, rather than letting an
 * armed run fail part-way through a journey once a paid step is underway.
 */
export function requireStagehandKey(env: NodeJS.ProcessEnv, envFile: string | null): string {
  const fromEnv = env[STAGEHAND_KEY_VARIABLE];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  if (envFile !== null) {
    const fromFile = readEnvFileVariable(envFile, STAGEHAND_KEY_VARIABLE);
    if (fromFile !== null && fromFile.trim() !== '') return fromFile.trim();
  }
  throw new StagehandKeyMissingError(
    STAGEHAND_KEY_VARIABLE,
    envFile,
    envFile !== null && existsSync(envFile),
  );
}
