import fixtures from '../bridge/legacy-cube-bot-probes.json';

export function botProbeVariants(interaction: string): readonly string[] {
  return Object.freeze(
    fixtures.filter((fixture) => fixture.id === interaction).map((fixture) => fixture.variant ?? 'default'),
  );
}

/** Conservative: fixture presence alone is not proof of autonomous use. */
export function botProbeCoverage(interaction: string): readonly string[] {
  const exercised = fixtures
    .filter((fixture) => fixture.id === interaction)
    .flatMap((fixture) => [
      fixture.spell,
      fixture.target,
      ...('sacrifice' in fixture ? [fixture.sacrifice] : []),
      ...('secondary' in fixture ? [fixture.secondary] : []),
    ]);
  return Object.freeze([...new Set(exercised)]);
}
