import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Names and bytes, not installation paths or timestamps, define executable provenance. */
export function fingerprintBotFiles(
  configuration: string,
  files: readonly { readonly name: string; readonly path: string }[],
): string {
  const hash = createHash('sha256').update(configuration).update('\0');
  const append = (name: string, path: string) => {
    if (statSync(path).isDirectory()) {
      for (const child of readdirSync(path).sort()) append(`${name}/${child}`, join(path, child));
    } else {
      const bytes = readFileSync(path);
      hash.update(name).update('\0').update(String(bytes.length)).update('\0').update(bytes);
    }
  };
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) append(file.name, file.path);
  return hash.digest('hex');
}
