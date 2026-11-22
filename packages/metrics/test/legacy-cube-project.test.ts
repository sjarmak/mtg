import { expect, it } from 'vitest';
import config from '../../../vitest.config';

interface Project {
  readonly test: {
    readonly name: string;
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly sequence?: { readonly groupOrder?: number };
    readonly testTimeout?: number;
  };
  readonly resolve: unknown;
}

it('keeps the complete calibration pipeline in the default run before competing projects', () => {
  const projects = (config as { readonly test: { readonly projects: readonly Project[] } }).test.projects;
  const pipeline = projects.find((project) => project.test.name === 'calibration');
  expect(pipeline, 'the default run must include the full pipeline').toBeDefined();
  expect(pipeline?.test.include).toEqual(['packages/metrics/test/legacy-cube-quality-pipeline.test.ts']);
  expect(pipeline?.test.testTimeout).toBeUndefined();
  expect(pipeline?.resolve).toEqual(projects.find((project) => project.test.name === 'unit')?.resolve);
  expect(projects.find((project) => project.test.name === 'unit')?.test.exclude).toContain(
    'packages/metrics/test/legacy-cube-quality-pipeline.test.ts',
  );
  for (const project of projects.filter((project) => project.test.name !== 'calibration')) {
    expect(pipeline?.test.sequence?.groupOrder).toBeLessThan(project.test.sequence?.groupOrder ?? 0);
  }
});
