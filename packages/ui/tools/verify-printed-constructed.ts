import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { strongestForgeObservedPolicy } from '@mtg/forge-export';
import { parsePrintedConstructedFormat } from '@mtg/printed-card';
import { httpObservedBackend } from '../src/net/backend-gateway';
import { startBackendService } from './backend-service';
import { installedPrintedAdmissions } from './printed-format-registry';
import { runPrintedConstructedForgeProof } from './printed-constructed-forge';

const { values } = parseArgs({
  options: {
    format: { type: 'string' },
    candidate: { type: 'string' },
    out: { type: 'string' },
    'maximum-decisions': { type: 'string', default: '5000' },
  },
  strict: true,
  allowPositionals: false,
});
if (!values.format || !values.candidate || !values.out) {
  throw new Error('usage: verify-printed-constructed --format <id> --candidate <file> --out <receipt.json>');
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(values.format)) throw new Error('invalid format id');
const maximumDecisions = Number(values['maximum-decisions']);
if (!Number.isSafeInteger(maximumDecisions) || maximumDecisions < 1) {
  throw new Error('--maximum-decisions must be a positive safe integer');
}

const repoRoot = resolve('.');
const format = parsePrintedConstructedFormat(JSON.parse(readFileSync(resolve(values.candidate), 'utf8')));
if (format.id !== values.format) throw new Error(`candidate is for ${format.id}, not ${values.format}`);
const installed = installedPrintedAdmissions(repoRoot);
const admission = installed.admissions.find((entry) => {
  const parsed = entry.format as { readonly id?: unknown };
  return parsed.id === values.format;
});
if (admission === undefined) throw new Error(`${values.format} has no installed Forge admission`);

const service = await startBackendService({ repoRoot, port: 0, printedAdmissions: [admission] });
try {
  if (!service.message.includes(`Printed format ${values.format}: verified runtime admission loaded.`)) {
    throw new Error(service.message);
  }
  const receipt = await runPrintedConstructedForgeProof({
    format,
    backend: httpObservedBackend({
      id: 'forge-2.0.14',
      baseUrl: `http://127.0.0.1:${String(service.gateway.port)}/engine-api`,
    }),
    policy: strongestForgeObservedPolicy,
    maximumDecisions,
  });
  writeFileSync(resolve(values.out), `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.results.some((result) => result.status !== 'completed')) process.exitCode = 1;
} finally {
  await service.close();
}
