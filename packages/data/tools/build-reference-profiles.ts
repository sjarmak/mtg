#!/usr/bin/env -S npx tsx
/** Rebuild the deterministic static profile artifact from the pinned corpus. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { REFERENCE_PROFILE_PATH, buildReferenceProfileArtifact, loadReferenceCorpus } from '../src/index';

export async function runBuildReferenceProfiles(output: string = REFERENCE_PROFILE_PATH): Promise<void> {
  const artifact = buildReferenceProfileArtifact(loadReferenceCorpus());
  writeFileSync(output, await format(JSON.stringify(artifact), { parser: 'json', printWidth: 110 }), 'utf8');
  console.log(
    `wrote ${artifact.profiles.length} labeled ${artifact.profileVersion} profiles and ${artifact.primaryCore.metrics.length} primary-core targets to ${output}`,
  );
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(invoked).href) {
  runBuildReferenceProfiles(process.argv[2]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
