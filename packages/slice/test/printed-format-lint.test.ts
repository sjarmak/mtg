import { resolve } from 'node:path';
import { ESLint, Linter } from 'eslint';
import { expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const FILE = resolve(ROOT, 'packages/data/test/xln-printed-format.test.ts');

it('restricts printed format tests to the shared coverage harness', async () => {
  const eslint = new ESLint({ cwd: ROOT });
  const config = await eslint.calculateConfigForFile(FILE);
  const rule = config?.rules?.['no-restricted-imports'];
  if (rule === undefined) throw new Error('Printed format import restriction is missing');
  const linter = new Linter({ configType: 'flat' });
  const messagesFor = (source: string) =>
    linter.verify(source, [
      {
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: { 'no-restricted-imports': rule },
      },
    ]);

  expect(
    messagesFor(
      "import { buildPrintedCompleteCoveragePlan } from '../src/printed-card/printed-coverage-plan';",
    ),
  ).toMatchObject([{ ruleId: 'no-restricted-imports', severity: 2 }]);
  expect(messagesFor("import { expectPrintedCoverageClosed } from './printed-format-coverage';")).toEqual([]);
});
