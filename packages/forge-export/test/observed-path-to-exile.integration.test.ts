/** Installed-Forge proof for Path to Exile's target-controller optional search. */
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

function table(route: 'accept' | 'decline'): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Path pilot',
        controller: 'local',
        deck: {
          name: `z5q4-path-to-exile-${route}`,
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Path to Exile', count: 30 },
          ],
        },
      },
      {
        name: 'Path target owner',
        controller: 'local',
        deck: {
          name: `z5q4-path-to-exile-${route}-target`,
          cards: [
            { name: 'Mountain', count: 30 },
            { name: 'Monastery Swiftspear', count: 30 },
          ],
        },
      },
    ],
    seed: `z5q4-path-to-exile-${route}-outcome`,
    maximumTurns: 18,
  };
}

async function proveRoute(route: 'accept' | 'decline'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = table(route);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let swiftspearCast = false;
  let swiftspearOid: string | undefined;
  let pathCast = false;
  let targetSelected = false;
  let searchHandled = false;
  let selectedLandOid: string | undefined;
  let targetLibrarySizeBeforeSearch: number | undefined;
  let targetBattlefieldBeforeSearch: ReadonlySet<string> | undefined;
  let inventedRejected = false;
  let staleRejected = false;
  let completed = false;
  const trace: string[] = [];

  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 900; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Path to Exile decision');
      const pilot = session.view.seats[0];
      const targetOwner = session.view.seats[1];
      swiftspearOid ??=
        targetOwner.battlefield.find((card) => card.name === 'Monastery Swiftspear')?.oid ??
        targetOwner.exile.find((card) => card.name === 'Monastery Swiftspear')?.oid;

      const creatureExiled =
        swiftspearOid !== undefined && targetOwner.exile.some((card) => card.oid === swiftspearOid);
      const searchOutcome =
        searchHandled &&
        targetLibrarySizeBeforeSearch !== undefined &&
        targetBattlefieldBeforeSearch !== undefined &&
        (route === 'accept'
          ? selectedLandOid !== undefined &&
            targetOwner.librarySize === targetLibrarySizeBeforeSearch - 1 &&
            targetOwner.battlefield.some(
              (card) => card.oid === selectedLandOid && card.name === 'Mountain' && card.tapped,
            )
          : targetOwner.librarySize === targetLibrarySizeBeforeSearch &&
            targetOwner.battlefield.length === targetBattlefieldBeforeSearch.size &&
            targetOwner.battlefield.every((card) => targetBattlefieldBeforeSearch?.has(card.oid)));
      completed = creatureExiled && searchOutcome && session.view.stack.length === 0;
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'target-selection' && pathCast && !targetSelected) {
        const candidates = decision.options.filter(
          (option) => option.targets.length === 1 && option.targets[0]?.oid === swiftspearOid,
        );
        expect(candidates, trace.at(-1)).toHaveLength(1);
        move = candidates[0]?.id;
        targetSelected = move !== undefined;
      } else if (decision.kind === 'zone-card-selection' && targetSelected && !searchHandled) {
        expect(decision.seat, trace.at(-1)).toBe(1);
        const cardChoices = decision.options.filter((option) => option.targets.length === 1);
        expect(cardChoices.length, trace.at(-1)).toBeGreaterThan(0);
        expect(
          cardChoices.every((option) => option.targets[0]?.name === 'Mountain'),
          trace.at(-1),
        ).toBe(true);
        const decline = decision.options.filter((option) => option.id === 'zone-decline');
        expect(decline, trace.at(-1)).toHaveLength(1);
        expect(decline[0]?.targets, trace.at(-1)).toEqual([]);
        targetLibrarySizeBeforeSearch = targetOwner.librarySize;
        targetBattlefieldBeforeSearch = new Set(targetOwner.battlefield.map((card) => card.oid));

        const exact = route === 'accept' ? cardChoices[0] : decline[0];
        if (exact === undefined) throw new Error(`Forge offered no ${route} search route`);
        selectedLandOid = route === 'accept' ? exact.targets[0]?.oid : undefined;
        await expect(session.submit('zone-invented')).resolves.toMatchObject({
          ok: false,
          error: { kind: 'unknown-move' },
        });
        inventedRejected = true;
        const staleSession = session;
        const advanced = await session.submit(exact.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        searchHandled = true;
        const stale = await staleSession.submit(exact.id);
        expect(stale).toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      } else if (decision.kind === 'priority') {
        const pilotHasMana = pilot.battlefield.some((card) => card.name === 'Plains' && !card.tapped);
        const targetHasMana = targetOwner.battlefield.some(
          (card) => card.name === 'Mountain' && !card.tapped,
        );
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : undefined) ??
          (decision.seat === 1 && !swiftspearCast && targetHasMana
            ? decision.options.find((option) => option.text.startsWith('Monastery Swiftspear:'))?.id
            : undefined) ??
          (decision.seat === 0 && !pathCast && swiftspearOid !== undefined && pilotHasMana
            ? decision.options.find((option) => option.text.startsWith('Path to Exile:'))?.id
            : undefined);
        const chosenText = decision.options.find((option) => option.id === move)?.text;
        swiftspearCast ||= chosenText?.startsWith('Monastery Swiftspear:') === true;
        pathCast ||= chosenText?.startsWith('Path to Exile:') === true;
      }

      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Path to Exile move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-120).join('\n')}`);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(swiftspearCast, evidence).toBe(true);
    expect(pathCast, evidence).toBe(true);
    expect(targetSelected, evidence).toBe(true);
    expect(searchHandled, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(completed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'exiles the exact opposing creature and puts its controller-selected basic onto that battlefield tapped',
  async () => {
    await proveRoute('accept');
  },
  300_000,
);

forgeIt(
  'exiles the exact opposing creature while its controller declines the basic-land search',
  async () => {
    await proveRoute('decline');
  },
  300_000,
);
