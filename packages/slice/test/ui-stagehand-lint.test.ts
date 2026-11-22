import { resolve } from 'node:path';
import { ESLint, Linter } from 'eslint';
import { expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const GENERAL_FILE = resolve(ROOT, 'packages/ui/tools/stage-evidence.ts');
const LIVE_FILE = resolve(ROOT, 'packages/ui/tools/live-journey.ts');

it('keeps the Stagehand SDK behind the live journey runner boundary', async () => {
  const eslint = new ESLint({ cwd: ROOT });
  const linter = new Linter({ configType: 'flat' });
  const messagesFor = async (file: string, source: string) => {
    const syntax = (await eslint.calculateConfigForFile(file))?.rules?.['no-restricted-syntax'];
    if (syntax === undefined) throw new Error(`Stagehand restrictions are missing for ${file}`);
    return linter.verify(source, [
      {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { 'no-restricted-syntax': syntax },
      },
    ]);
  };

  expect(
    await messagesFor(GENERAL_FILE, "import { Stagehand } from '@browserbasehq/stagehand';"),
  ).toMatchObject([{ ruleId: 'no-restricted-syntax', severity: 2 }]);
  expect(await messagesFor(LIVE_FILE, "const sdk = import('@browserbasehq/stagehand');")).toMatchObject([
    { ruleId: 'no-restricted-syntax', severity: 2 },
  ]);
  expect(
    await messagesFor(LIVE_FILE, "import { runStagehandJourney } from './stagehand-runner';"),
  ).toMatchObject([{ ruleId: 'no-restricted-syntax', severity: 2 }]);
  expect(
    await messagesFor(LIVE_FILE, "import { resolveStagehandProvider } from './stagehand-provider';"),
  ).toMatchObject([{ ruleId: 'no-restricted-syntax', severity: 2 }]);
  expect(await messagesFor(LIVE_FILE, "const runner = import('./stagehand-runner');")).toEqual([]);
});
