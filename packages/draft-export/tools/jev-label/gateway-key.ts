/**
 * Where the study gets its gateway key: the process environment, or one named
 * variable out of an env file another project already keeps it in.
 *
 * Nothing is copied. The value is returned to the caller in memory and no
 * message this module builds contains it: a missing key names the variable and
 * the place it looked, never a value.
 */
import { existsSync, readFileSync } from 'node:fs';

export const GATEWAY_KEY_VARIABLE = 'AI_GATEWAY_API_KEY';

/** The value of `variable` in a dotenv-style file, unquoted, or null when the file does not set it. */
export function readEnvFileVariable(path: string, variable: string): string | null {
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match === null || match[1] !== variable) continue;
    const value = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
    return value === '' ? null : value;
  }
  return null;
}

/** One named secret from the process or an explicitly named dotenv file. */
export function readApiKey(env: NodeJS.ProcessEnv, envFile: string | undefined, variable: string): string {
  const fromEnv = env[variable];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  if (envFile !== undefined) {
    const fromFile = readEnvFileVariable(envFile, variable);
    if (fromFile !== null) return fromFile;
    throw new Error(`${variable} is not set in the environment or in ${envFile}`);
  }
  throw new Error(`${variable} is not set in the environment; pass --env-file to read it from a file`);
}

export function readGatewayKey(env: NodeJS.ProcessEnv, envFile: string | undefined): string {
  return readApiKey(env, envFile, GATEWAY_KEY_VARIABLE);
}
