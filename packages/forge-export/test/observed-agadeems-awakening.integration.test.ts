/** Installed-Forge proof for Agadeem's Awakening's exact spell and modal land routes. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;
type ObservedDecision = NonNullable<ObservedSession['decision']>;

function routineMove(decision: ObservedDecision): string | undefined {
  if (decision.kind === 'mana-payment') {
    return decision.options.find((option) => option.id.startsWith('mana-source-'))?.id;
  }
  if (decision.kind === 'discard-selection') {
    return (
      decision.options.find((option) => option.id === 'discard-selection-commit')?.id ??
      decision.options.find((option) => option.targets.length === 1)?.id
    );
  }
  return decision.options.find(
    (option) =>
      option.text === 'Play first' ||
      option.text === 'Keep this hand' ||
      option.text === 'Pass priority' ||
      option.id === 'combat-attackers-commit' ||
      option.id === 'combat-blockers-commit',
  )?.id;
}

function spellTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: "Agadeem's Awakening spell pilot",
        controller: 'local',
        deck: {
          name: 'z5q4-agadeem-spell',
          cards: [
            { name: 'Scrubland', count: 90 },
            { name: 'Entomb', count: 45 },
            { name: "Agadeem's Awakening", count: 45 },
            { name: 'Arbor Elf', count: 8 },
            { name: 'Mother of Runes', count: 8 },
            { name: 'Wall of Omens', count: 8 },
            { name: 'Dark Confidant', count: 8 },
            { name: 'Baneslayer Angel', count: 8 },
          ],
        },
      },
      {
        name: 'Opposing graveyard owner',
        controller: 'local',
        deck: {
          name: 'z5q4-agadeem-opponent',
          cards: [
            { name: 'Swamp', count: 30 },
            { name: 'Entomb', count: 15 },
            { name: 'Mother of Runes', count: 15 },
          ],
        },
      },
    ],
    seed: 'z5q4-agadeems-awakening-spell-outcome',
    maximumTurns: 50,
  };
}

async function proveSpellRoutes(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = spellTable();
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const graveyardNames = [
    'Arbor Elf',
    'Mother of Runes',
    'Wall of Omens',
    'Dark Confidant',
    'Baneslayer Angel',
  ] as const;
  const ownEntombed = new Map<string, string>();
  let opposingEntombed: string | undefined;
  let castAttempts = 0;
  let completedSelections = 0;
  let currentRoute: 0 | 1 | 2 | undefined;
  let canceled = false;
  let cancellationRestored = false;
  let cancellationBefore:
    { awakeningHand: string[]; lands: Array<{ oid: string; tapped: boolean }> } | undefined;
  let inventedRejected = false;
  let staleRejected = false;
  const selectedByRoute: string[][] = [[], [], []];
  let sawDuplicateCmcFiltered = false;
  let allResolved = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 4_000; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error("Forge offered no Agadeem's Awakening decision");
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      const awakeningInGraveyard = pilot.graveyard.filter(
        (card) => card.name === "Agadeem's Awakening",
      ).length;
      allResolved =
        completedSelections === 3 &&
        awakeningInGraveyard >= 3 &&
        selectedByRoute.every(
          (selected, route) =>
            selected.length === route &&
            selected.every((oid) => pilot.battlefield.some((card) => card.oid === oid)),
        ) &&
        ownEntombed.get('Baneslayer Angel') !== undefined &&
        pilot.graveyard.some((card) => card.oid === ownEntombed.get('Baneslayer Angel')) &&
        ownEntombed.get('Dark Confidant') !== undefined &&
        pilot.graveyard.some((card) => card.oid === ownEntombed.get('Dark Confidant')) &&
        (opposingEntombed === undefined || opponent.graveyard.some((card) => card.oid === opposingEntombed));
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'zone-card-selection') {
        const wanted =
          decision.seat === 1 ? 'Mother of Runes' : graveyardNames.find((name) => !ownEntombed.has(name));
        const choice = decision.options.find((option) => option.targets[0]?.name === wanted);
        const oid = choice?.targets[0]?.oid;
        if (choice === undefined || oid === undefined) {
          throw new Error(`Entomb did not offer ${String(wanted)}`);
        }
        if (decision.seat === 1) opposingEntombed = oid;
        else ownEntombed.set(wanted!, oid);
        move = choice.id;
      } else if (decision.kind === 'number' && decision.seat === 0) {
        expect(
          decision.options.some((option) => option.id === 'number-2'),
          trace.at(-1),
        ).toBe(true);
        move = 'number-2';
      } else if (decision.kind === 'target-selection' && decision.seat === 0) {
        const candidates = decision.options.filter((option) => option.targets.length === 1);
        const offered = new Set(candidates.map((option) => option.targets[0]!.oid));
        const arborElf = ownEntombed.get('Arbor Elf');
        const mother = ownEntombed.get('Mother of Runes');
        const wall = ownEntombed.get('Wall of Omens');
        const darkConfidant = ownEntombed.get('Dark Confidant');
        const baneslayer = ownEntombed.get('Baneslayer Angel');
        expect(offered.has(baneslayer!), trace.at(-1)).toBe(false);
        expect(offered.has(opposingEntombed!), trace.at(-1)).toBe(false);
        expect(decision.options.some((option) => option.id === 'agadeem-targets-done')).toBe(true);
        if (!inventedRejected) {
          await expect(session.submit('target-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        if (!canceled) {
          expect(decision.options.some((option) => option.id === 'target-cancel')).toBe(true);
          const staleSession = session;
          const advanced = await session.submit('target-cancel');
          if (!advanced.ok) throw new Error(advanced.error.message);
          session = advanced.session;
          const stale = await staleSession.submit('target-cancel');
          expect(stale).toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
          canceled = true;
          const restored = session.view.seats[0];
          cancellationRestored =
            cancellationBefore !== undefined &&
            JSON.stringify(
              (restored.hand ?? [])
                .filter((card) => card.name === "Agadeem's Awakening")
                .map((card) => card.oid)
                .sort(),
            ) === JSON.stringify(cancellationBefore.awakeningHand) &&
            JSON.stringify(
              restored.battlefield
                .filter((card) => card.name === 'Scrubland')
                .map((card) => ({ oid: card.oid, tapped: card.tapped }))
                .sort((left, right) => left.oid.localeCompare(right.oid)),
            ) === JSON.stringify(cancellationBefore.lands);
          currentRoute = undefined;
          continue;
        }
        currentRoute ??= completedSelections as 0 | 1 | 2;
        const selected = selectedByRoute[currentRoute]!;
        if (currentRoute === 2 && selected.length === 1) {
          expect(selected[0]).toBe(wall);
          expect(offered.has(darkConfidant!), trace.at(-1)).toBe(false);
          expect(offered.has(arborElf!), trace.at(-1)).toBe(true);
          sawDuplicateCmcFiltered = true;
        }
        const wanted =
          selected.length >= currentRoute
            ? decision.options.find((option) => option.id === 'agadeem-targets-done')
            : candidates.find(
                (option) =>
                  option.targets[0]?.oid ===
                  (currentRoute === 1 ? mother : selected.length === 0 ? wall : arborElf),
              );
        if (wanted === undefined) throw new Error(`Forge omitted Agadeem route ${String(currentRoute)}`);
        const oid = wanted.targets[0]?.oid;
        const advanced = await session.submit(wanted.id);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
        session = advanced.session;
        if (oid !== undefined) selected.push(oid);
        else {
          completedSelections += 1;
          currentRoute = undefined;
        }
        continue;
      } else if (decision.kind === 'priority') {
        const ownLands = pilot.battlefield.filter((card) => card.name === 'Scrubland').length;
        const ownUntappedLands = pilot.battlefield.filter(
          (card) => card.name === 'Scrubland' && !card.tapped,
        ).length;
        const opposingUntappedLands = opponent.battlefield.filter(
          (card) => card.name === 'Swamp' && !card.tapped,
        ).length;
        const missingOwn = graveyardNames.find((name) => !ownEntombed.has(name));
        const cast = decision.options.find((option) => option.text.startsWith("Agadeem's Awakening:"));
        const entomb = decision.options.find((option) => option.text.startsWith('Entomb:'));
        const resolvedEnough = awakeningInGraveyard >= completedSelections;
        move =
          (allResolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Scrubland')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Swamp')?.id
            : undefined) ??
          (decision.seat === 0 && missingOwn !== undefined && ownUntappedLands >= 1
            ? entomb?.id
            : undefined) ??
          (decision.seat === 1 && opposingEntombed === undefined && opposingUntappedLands >= 1
            ? entomb?.id
            : undefined) ??
          (decision.seat === 0 &&
          missingOwn === undefined &&
          opposingEntombed !== undefined &&
          ownLands >= 5 &&
          ownUntappedLands >= 5 &&
          completedSelections < 3 &&
          resolvedEnough
            ? cast?.id
            : undefined);
        if (move !== undefined && move === cast?.id) {
          if (!canceled && castAttempts === 0) {
            cancellationBefore = {
              awakeningHand: (pilot.hand ?? [])
                .filter((card) => card.name === "Agadeem's Awakening")
                .map((card) => card.oid)
                .sort(),
              lands: pilot.battlefield
                .filter((card) => card.name === 'Scrubland')
                .map((card) => ({ oid: card.oid, tapped: card.tapped }))
                .sort((left, right) => left.oid.localeCompare(right.oid)),
            };
          }
          castAttempts += 1;
        }
      }

      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error("Forge offered no Agadeem's Awakening move");
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-240).join('\n')}`);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(castAttempts, evidence).toBe(4);
    expect(canceled, evidence).toBe(true);
    expect(cancellationRestored, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(completedSelections, evidence).toBe(3);
    expect(
      selectedByRoute.map((selected) => selected.length),
      evidence,
    ).toEqual([0, 1, 2]);
    expect(sawDuplicateCmcFiltered, evidence).toBe(true);
    expect(allResolved, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

function landTable(payLife: boolean): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: `Agadeem land ${payLife ? 'pay' : 'decline'} pilot`,
        controller: 'local',
        deck: {
          name: `z5q4-agadeem-land-${payLife ? 'pay' : 'decline'}`,
          cards: [
            { name: "Agadeem's Awakening", count: 30 },
            { name: 'Duress', count: 30 },
          ],
        },
      },
      {
        name: 'Agadeem land observer',
        controller: 'local',
        deck: { name: 'z5q4-agadeem-land-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: `z5q4-agadeem-land-${payLife ? 'pay' : 'decline'}-outcome`,
    maximumTurns: 8,
  };
}

async function proveLandRoute(payLife: boolean): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = landTable(payLife);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let landPlayed = false;
  let entryObserved = false;
  let duressCast = false;
  let inventedRejected = false;
  let staleRejected = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 800; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Agadeem land decision');
      const pilot = session.view.seats[0];
      const land = pilot.battlefield.find((card) => card.name === 'Agadeem, the Undercrypt');
      if (land !== undefined) {
        entryObserved ||= pilot.life === (payLife ? 17 : 20) && land.tapped === !payLife;
      }
      const resolved = pilot.graveyard.some((card) => card.name === 'Duress');
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'optional-cost' && decision.seat === 0) {
        expect(
          decision.options.map((option) => option.id),
          trace.at(-1),
        ).toEqual(['optional-cost-pay-life-3', 'optional-cost-decline']);
        if (!inventedRejected) {
          await expect(session.submit('optional-cost-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        const chosen = payLife ? 'optional-cost-pay-life-3' : 'optional-cost-decline';
        const staleSession = session;
        const advanced = await session.submit(chosen);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        const stale = await staleSession.submit(chosen);
        expect(stale).toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      } else if (decision.kind === 'target-selection' && decision.seat === 0) {
        move = decision.options.find((option) => option.id === 'target-player-1')?.id;
      } else if (decision.kind === 'zone-card-selection' && decision.seat === 0) {
        move = decision.options.find((option) => option.targets.length === 1)?.id;
      } else if (decision.kind === 'priority') {
        const landAction: ObservedDecision['options'][number] | undefined =
          decision.seat === 0 && !landPlayed
            ? decision.options.find((option) => option.text === "Play Agadeem's Awakening")
            : undefined;
        move =
          (resolved ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          landAction?.id ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : undefined) ??
          (decision.seat === 0 && entryObserved && land?.tapped === false && !duressCast
            ? decision.options.find((option) => option.text.startsWith('Duress:'))?.id
            : undefined);
        landPlayed ||= move !== undefined && move === landAction?.id;
        duressCast ||=
          move !== undefined &&
          decision.options.find((option) => option.id === move)?.text.startsWith('Duress:') === true;
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Agadeem land move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-180).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-240).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(landPlayed, evidence).toBe(true);
    expect(entryObserved, evidence).toBe(true);
    expect(duressCast, evidence).toBe(true);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(
      session.view.seats[0].graveyard.some((card) => card.name === 'Duress'),
      evidence,
    ).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  "proves Agadeem's Awakening X targets, rollback, ownership, distinct mana values, and outcomes",
  proveSpellRoutes,
  360_000,
);

forgeIt(
  'proves both Agadeem land entry branches and black mana activation',
  async () => {
    await proveLandRoute(true);
    await proveLandRoute(false);
  },
  300_000,
);
