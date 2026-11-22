/**
 * Writes the two probe configs and the inventory arguments for re-binding one printed
 * format's installed play admission to the current bridge and adapter, from the receipts
 * the installed admission already carries (probe definitions, coverage plan). Run from the
 * repo root before the installed directory is replaced:
 *   node packages/data/tools/printed-admission-rebind-configs.mjs <format id> <out directory>
 * writes <out>/scenario.json and <out>/match.json. The controller contract bundle is the
 * one every admission's `contracts/` directory was copied from.
 */
import fs from 'node:fs';
import process from 'node:process';

const data = 'packages/data/data/';
const [id, out] = process.argv.slice(2);
if (id === undefined || out === undefined) throw new Error('usage: <format id> <out directory>');
const entry = JSON.parse(fs.readFileSync(`${data}printed-formats-v1.json`, 'utf8')).formats.find(
  (format) => format.id === id,
);
if (entry === undefined) throw new Error(`No registered printed format ${id}`);
const dir = `${data}${id}/${entry.admissionDirectory}`;
const prefix = id === 'akh-hou' ? 'akh' : id;
const matchTests = {
  'match-engine-starting-player-v1': 'start-engine',
  'match-engine-mulligan-v1': 'mulligan-engine',
  'match-local-pregame-v1': 'match-local',
  'match-engine-priority-v1': 'match-engine',
  // Rise of the Eldrazi named its match receipts after the format, not the family.
  'roe-match-starting-player-engine': 'start-engine',
  'roe-match-mulligan-engine': 'mulligan-engine',
  'roe-match-pregame-local': 'match-local',
  'roe-match-priority-engine': 'match-engine',
  // Magic 2012 and Dark Ascension's own onboarding lane named its match receipts
  // the same way Rise of the Eldrazi did.
  'm12-match-starting-player-engine': 'start-engine',
  'm12-match-mulligan-engine': 'mulligan-engine',
  'm12-match-pregame-local': 'match-local',
  'm12-match-priority-engine': 'match-engine',
  'dka-match-starting-player-engine': 'start-engine',
  'dka-match-mulligan-engine': 'mulligan-engine',
  'dka-match-pregame-local': 'match-local',
  'dka-match-priority-engine': 'match-engine',
  // Magic 2014's lane used the same format-named receipts.
  'm14-match-starting-player-engine': 'start-engine',
  'm14-match-mulligan-engine': 'mulligan-engine',
  'm14-match-pregame-local': 'match-local',
  'm14-match-priority-engine': 'match-engine',
  // Ixalan named its four the same way again, in its own word order. Its four
  // observed tests are the usual four; only the receipt ids differ.
  'xln-engine-starting-player': 'start-engine',
  'xln-native-mulligan': 'mulligan-engine',
  'xln-local-pregame': 'match-local',
  'xln-native-priority': 'match-engine',
  'zen-match-starting-player-engine': 'start-engine',
  'zen-match-mulligan-engine': 'mulligan-engine',
  'zen-match-pregame-local': 'match-local',
  'zen-match-priority-engine': 'match-engine',
  'wwk-match-starting-player-engine': 'start-engine',
  'wwk-match-mulligan-engine': 'mulligan-engine',
  'wwk-match-pregame-local': 'match-local',
  'wwk-match-priority-engine': 'match-engine',
};
const directMatchTests = {
  'momir-match-engine-v1': 'packages/forge-export/test/bridge-momir.integration.test.ts',
  'momir-match-local-v1': 'packages/forge-export/test/bridge-momir.integration.test.ts',
};
const definitions = (sub) =>
  fs
    .readdirSync(`${dir}/${sub}`)
    .sort()
    .map((file) => {
      const receipt = JSON.parse(fs.readFileSync(`${dir}/${sub}/${file}`, 'utf8'));
      const { status: _status, ...result } = receipt.result;
      const match = matchTests[result.id];
      // Newer onboarding lanes stopped writing the `cases` field on scenario
      // receipts; every scenario receipt's first `sources` entry is still the
      // observed contract-witness test that produced it.
      const testFile =
        directMatchTests[result.id] ??
        (match === undefined
          ? (receipt.cases?.[0].testFile ?? receipt.sources[0].path)
          : `packages/forge-export/test/observed-${prefix}-${match}.integration.test.ts`);
      return { ...result, testFile };
    });
const base = {
  schemaVersion: 1,
  workspace: process.cwd(),
  format: `${data}${id}/${entry.formatFile}`,
  catalogs: entry.catalogs.map((catalog) => `${data}${id}/${catalog.file}`),
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  `${out}/scenario.json`,
  JSON.stringify(
    {
      ...base,
      probes: definitions('probes'),
      coveragePlan: `${dir}/coverage-plan.json`,
      controllerContractBundle: 'out/validation-pilot/printed-controller-contracts-protocol2-v9',
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  `${out}/match.json`,
  JSON.stringify({ ...base, probes: definitions('match-probes') }, null, 2),
);
