import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const stagehandSdkImports = {
  selector: "ImportDeclaration[source.value='@browserbasehq/stagehand']",
  message: 'Import the SDK only through stagehand-runner.',
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: ['packages/data/test/*-printed-format.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../src/printed-card/printed-decision-inventory',
                '../src/printed-card/printed-coverage-plan',
              ],
              message: 'Use expectPrintedCoverageClosed from ./printed-format-coverage.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui/tools/**/*.ts'],
    ignores: [
      'packages/ui/tools/stagehand-runner.ts',
      'packages/ui/tools/stagehand-model-bridge.ts',
      'packages/ui/tools/stagehand-runtime.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', stagehandSdkImports],
    },
  },
  {
    files: ['packages/ui/tools/live-journey.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        stagehandSdkImports,
        { ...stagehandSdkImports, selector: "ImportExpression[source.value='@browserbasehq/stagehand']" },
        {
          selector: "ImportDeclaration[source.value='./stagehand-runner']",
          message: 'Load the runner only from the armed branch.',
        },
        {
          selector: "ImportDeclaration[source.value='./stagehand-provider']:not([importKind='type'])",
          message: 'Load the provider only from the armed branch.',
        },
      ],
    },
  },
  {
    /**
     * Switch exhaustiveness, which needs types and so needs its own block.
     *
     * The files are exactly `tsconfig.json`'s `include`, and the two lists have
     * to be kept identical by hand. Measured 2026-08-28 by putting a
     * two-case-union switch missing one case into `packages/kernel/bench` and
     * running eslint on it both ways. Listed in both: `Switch is not
     * exhaustive. Cases not matched: "b"`. Listed here but absent from
     * `include`: `Parsing error: ... was not found by the project service`,
     * which is loud and names the fix. The dangerous direction is the other
     * one — in `include` but not in this block — where the rule simply never
     * runs, nothing is printed, and the file reads as clean. `mtg-lr6r` added
     * the bench glob below to both lists at once for exactly that reason, and
     * `packages/slice/test/typed-lint-scope.test.ts` now fails when they drift.
     *
     * `considerDefaultExhaustiveForUnions` is the disposition split, drawn in
     * the config instead of by hand at 33 call sites. Measured 2026-08-28 with
     * the rule at its default settings: 33 switches flagged across 8 packages,
     * and every one of the 33 has a `default`. Not one dropped case among
     * them. The population is almost entirely partial handlers over the
     * kernel's event union — a narrator, a motion planner, a metrics collector
     * — where handling six of sixty kinds and falling through is the design,
     * and `packages/ui/src/motion/plan.ts` argues for it in its docblock. The
     * strict setting would have turned each of those into a sixty-case switch
     * or an eslint-disable, and would have landed 14 of the 33 in the DSL and
     * kernel lanes, to find nothing.
     *
     * So what this catches is the case the compiler does not: a switch over a
     * union with no `default` that stops covering the union, in a statement
     * position where nothing consumes the missing `undefined`. What it does
     * not catch is a `default` hiding a case somebody meant to handle. Those
     * two are indistinguishable from the config, which is why the rule cannot
     * be the whole answer and `assertNever` stays the way a switch says it
     * means to be total.
     */
    files: [
      'packages/*/src/**/*.ts',
      'packages/*/test/**/*.ts',
      'packages/*/tools/**/*.ts',
      'packages/*/bench/**/*.ts',
      'packages/*/*.config.ts',
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
);
