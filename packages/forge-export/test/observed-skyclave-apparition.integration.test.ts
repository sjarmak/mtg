/** Installed-Forge proof for Skyclave Apparition's exact exile-memory-token route. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  if (decision.kind === 'scry-move') {
    return decision.options.find((option) => option.id === 'scry-move-done')?.id;
  }
  if (decision.kind === 'scry-keep') return decision.options[0]?.id;
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit' ||
      option.id === 'discard-selection-commit',
  )?.id;
}

function table(route: 'none' | 'exact'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Apparition pilot',
        controller: 'local',
        deck: {
          name: `z5q4-skyclave-apparition-${route}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Skyclave Apparition', count: 15 },
            { name: 'Wrath of God', count: 15 },
          ],
        },
      },
      {
        name: 'Apparition target owner',
        controller: 'local',
        deck: {
          name: `z5q4-skyclave-apparition-${route}-target`,
          cards:
            route === 'exact'
              ? [
                  { name: 'Plains', count: 30 },
                  { name: 'Chromatic Lantern', count: 30 },
                ]
              : [{ name: 'Mountain', count: 60 }],
        },
      },
    ],
    seed: `z5q4-skyclave-apparition-${route}-outcome`,
    maximumTurns: 24,
  };
}

async function proveRoute(route: 'none' | 'exact'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = table(route);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let apparitionOid: string | undefined;
  let lanternOid: string | undefined;
  let apparitionCast = false;
  let lanternCast = route === 'none';
  let selected = false;
  let inventedRejected = route === 'none';
  let staleRejected = route === 'none';
  let exiled = false;
  let wrathCast = false;
  let completed = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_400; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Skyclave Apparition decision');
      const pilot = session.view.seats[0];
      const targetOwner = session.view.seats[1];
      apparitionOid ??=
        pilot.battlefield.find((card) => card.name === 'Skyclave Apparition')?.oid ??
        pilot.graveyard.find((card) => card.name === 'Skyclave Apparition')?.oid;
      lanternOid ??=
        targetOwner.battlefield.find((card) => card.name === 'Chromatic Lantern')?.oid ??
        targetOwner.exile.find((card) => card.name === 'Chromatic Lantern')?.oid;
      exiled ||= lanternOid !== undefined && targetOwner.exile.some((card) => card.oid === lanternOid);
      const apparitionGone =
        apparitionOid !== undefined && pilot.graveyard.some((card) => card.oid === apparitionOid);
      const illusions = targetOwner.battlefield.filter(
        (card) => card.name.includes('Illusion') && card.typeLine.includes('Creature'),
      );
      completed =
        wrathCast &&
        apparitionGone &&
        session.view.stack.length === 0 &&
        (route === 'none'
          ? !exiled && illusions.length === 0
          : exiled && illusions.length === 1 && illusions[0]?.power === 3 && illusions[0].toughness === 3);
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'target-selection' && apparitionCast && !selected) {
        const none = decision.options.find((option) => option.id === 'target-none');
        expect(none, trace.at(-1)).toBeDefined();
        if (route === 'none') {
          move = none?.id;
          selected = move !== undefined;
        } else {
          const candidates = decision.options.filter((option) => option.targets[0]?.oid === lanternOid);
          expect(candidates, trace.at(-1)).toHaveLength(1);
          const exact = candidates[0];
          if (exact === undefined) throw new Error('Forge offered no exact Chromatic Lantern target');
          await expect(session.submit('target-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
          const staleSession = session;
          const advanced = await session.submit(exact.id);
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          selected = true;
          const stale = await staleSession.submit(exact.id);
          expect(stale).toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          continue;
        }
      } else if (decision.kind === 'priority') {
        const pilotPlains = pilot.battlefield.filter((card) => card.name === 'Plains').length;
        const targetLands = targetOwner.battlefield.filter(
          (card) => card.name === (route === 'exact' ? 'Plains' : 'Mountain'),
        ).length;
        const targetReady = route === 'none' || lanternOid !== undefined;
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find(
                (option) => option.text === `Play ${route === 'exact' ? 'Plains' : 'Mountain'}`,
              )?.id
            : undefined) ??
          (decision.seat === 1 && route === 'exact' && !lanternCast && targetLands >= 3
            ? decision.options.find((option) => option.text.startsWith('Chromatic Lantern:'))?.id
            : undefined) ??
          (decision.seat === 0 && !apparitionCast && targetReady && pilotPlains >= 3
            ? decision.options.find((option) => option.text.startsWith('Skyclave Apparition:'))?.id
            : undefined) ??
          (decision.seat === 0 && selected && !wrathCast && apparitionOid !== undefined && pilotPlains >= 4
            ? decision.options.find((option) => option.text.startsWith('Wrath of God:'))?.id
            : undefined);
        const chosenText = decision.options.find((option) => option.id === move)?.text;
        lanternCast ||= chosenText?.startsWith('Chromatic Lantern:') === true;
        apparitionCast ||= chosenText?.startsWith('Skyclave Apparition:') === true;
        wrathCast ||= chosenText?.startsWith('Wrath of God:') === true;
      }

      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Skyclave Apparition move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(lanternCast, evidence).toBe(true);
    expect(apparitionCast, evidence).toBe(true);
    expect(selected, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(wrathCast, evidence).toBe(true);
    expect(completed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'chooses no target and creates no Illusion when that Apparition leaves',
  async () => {
    await proveRoute('none');
  },
  300_000,
);

forgeIt(
  'exiles the exact opposing permanent and creates its owner one exact 3/3 Illusion after leaving',
  async () => {
    await proveRoute('exact');
  },
  300_000,
);
