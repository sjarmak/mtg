/** Measure executable inputs independently of compatibility claims. No evidence is admitted here. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findForgeInstall } from '../install';
import { FORGE_BRIDGE_PROTOCOL_VERSION } from './protocol';

export interface ForgeRuntimeIdentityOptions {
  readonly forgeHome: string;
  /** The source entrypoint or class directory actually selected by the launcher. */
  readonly bridge: { readonly kind: 'source' | 'compiled'; readonly path: string };
  /** A self-contained deployed adapter bundle; do not pass a source entrypoint with unhashed imports. */
  readonly adapterBundlePath: string;
}
export interface ForgeRuntimeIdentity {
  readonly forgeVersion: string;
  readonly forgeJarSha256: string;
  readonly scriptArchiveSha256: string;
  /** Complete resource tree, including token scripts, effects, and AI profiles. */
  readonly resourcesSha256: string;
  readonly bridgeSha256: string;
  readonly adapterSha256: string;
  readonly protocolVersion: number;
}

function digest(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Include resources as well as classes: the selected classpath may load both. */
function artifactFiles(root: string, prefix = ''): readonly (readonly [string, string])[] {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name === b.name ? 0 : 1))
    .flatMap((entry): readonly (readonly [string, string])[] => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Runtime artifact contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) return artifactFiles(root, relative);
      if (!entry.isFile()) throw new Error(`Runtime artifact contains a non-file: ${relative}`);
      return [[relative, digest(readFileSync(join(root, relative)))]];
    });
}

function bridgeDigest(bridge: ForgeRuntimeIdentityOptions['bridge']): string {
  if (bridge.kind === 'source') {
    return digest(JSON.stringify(['java-source-v1', digest(readFileSync(bridge.path))]));
  }
  const files = artifactFiles(bridge.path);
  if (!files.some(([name]) => name === 'ForgeBridge.class')) {
    throw new Error('Bridge classpath does not contain ForgeBridge.class');
  }
  return digest(JSON.stringify(['java-classpath-v1', files]));
}

/**
 * The launcher must select these same inputs for the measured session. This is a
 * filesystem snapshot, not an attestation of another already-running process.
 * No cache: editing bytes at the same path must invalidate the next measurement.
 */
export function measureForgeRuntime(options: ForgeRuntimeIdentityOptions): ForgeRuntimeIdentity {
  const install = findForgeInstall({ forgeHome: options.forgeHome });
  if (install === null) throw new Error('Forge is not installed at the selected home.');
  return {
    forgeVersion: install.version,
    forgeJarSha256: digest(readFileSync(install.jar)),
    scriptArchiveSha256: digest(readFileSync(join(install.home, 'res/cardsfolder/cardsfolder.zip'))),
    resourcesSha256: digest(JSON.stringify(['forge-resources-v1', artifactFiles(join(install.home, 'res'))])),
    bridgeSha256: bridgeDigest(options.bridge),
    adapterSha256: digest(readFileSync(options.adapterBundlePath)),
    protocolVersion: FORGE_BRIDGE_PROTOCOL_VERSION,
  };
}
