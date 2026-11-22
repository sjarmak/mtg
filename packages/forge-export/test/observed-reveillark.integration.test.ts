/** Installed-Forge proof for Reveillark's exact Evoke and optional leaves-two target route. */
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
      decision.options.find((option) =>
        ['Entomb', 'Lightning Bolt', 'Vendilion Clique', 'Reveillark', 'Scrubland', 'Swamp'].includes(
          option.targets[0]?.name ?? '',
        ),
      )?.id ??
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

function ordinaryTable(): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Reveillark ordinary pilot',
        controller: 'local',
        deck: {
          name: 'z5q4-reveillark-ordinary',
          cards: [
            { name: 'Plains', count: 30 },
            { name: 'Reveillark', count: 30 },
          ],
        },
      },
      {
        name: 'Reveillark ordinary observer',
        controller: 'local',
        deck: { name: 'z5q4-reveillark-ordinary-observer', cards: [{ name: 'Mountain', count: 60 }] },
      },
    ],
    seed: 'z5q4-reveillark-ordinary-outcome',
    maximumTurns: 14,
  };
}

function evokeTable(route: 0 | 1 | 2): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Reveillark Evoke pilot',
        controller: 'local',
        deck: {
          name: `z5q4-reveillark-evoke-${String(route)}`,
          cards: [
            { name: 'Scrubland', count: 24 },
            { name: 'Entomb', count: 12 },
            { name: 'Reveillark', count: 8 },
            { name: 'Wall of Omens', count: 5 },
            { name: 'Mother of Runes', count: 5 },
            { name: 'Vendilion Clique', count: 3 },
            { name: 'Lightning Bolt', count: 3 },
          ],
        },
      },
      {
        name: 'Opposing graveyard owner',
        controller: 'local',
        deck: {
          name: `z5q4-reveillark-evoke-${String(route)}-opponent`,
          cards: [
            { name: 'Swamp', count: 30 },
            { name: 'Entomb', count: 15 },
            { name: 'Mother of Runes', count: 15 },
          ],
        },
      },
    ],
    seed: `z5q4-reveillark-evoke-${String(route)}-outcome`,
    maximumTurns: 30,
  };
}

async function proveOrdinaryCast(): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = ordinaryTable();
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  let cast = false;
  let stayed = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 800; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no ordinary Reveillark decision');
      const pilot = session.view.seats[0];
      stayed ||= cast && pilot.battlefield.some((card) => card.name === 'Reveillark');
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );
      let move: string | undefined;
      if (decision.kind === 'priority') {
        const lands = pilot.battlefield.filter((card) => card.name === 'Plains').length;
        const ordinary = decision.options.find(
          (option) => option.text.startsWith('Reveillark:') && !option.text.includes('Evoke'),
        );
        move =
          (stayed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Plains')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Mountain')?.id
            : undefined) ??
          (decision.seat === 0 && !cast && lands >= 5 ? ordinary?.id : undefined);
        cast ||= move !== undefined && move === ordinary?.id;
      }
      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no ordinary Reveillark move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-140).join('\n')}`);
      session = advanced.session;
    }
    const evidence = `${trace.slice(-180).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(cast, evidence).toBe(true);
    expect(stayed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

async function proveEvokeRoute(route: 0 | 1 | 2): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  const spec = evokeTable(route);
  expect(await backend.supports(spec)).toEqual([]);
  const opened = await backend.open(spec);
  if (!opened.ok) throw new Error(opened.error.message);
  let session = opened.session;
  const wanted = ['Wall of Omens', 'Mother of Runes', 'Vendilion Clique'] as const;
  const ownEntombed = new Map<string, string>();
  let opposingEntombed: string | undefined;
  let evokeCast = false;
  let reveillarkOid: string | undefined;
  let targetChoices = 0;
  const selected: string[] = [];
  let inventedRejected = false;
  let staleRejected = false;
  let completed = false;
  const trace: string[] = [];
  try {
    for (let moves = 0; session.status === 'awaiting' && moves < 1_800; moves += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Reveillark Evoke decision');
      const pilot = session.view.seats[0];
      const opponent = session.view.seats[1];
      reveillarkOid ??=
        pilot.battlefield.find((card) => card.name === 'Reveillark')?.oid ??
        pilot.graveyard.find((card) => card.name === 'Reveillark')?.oid;
      const legalOids = ['Wall of Omens', 'Mother of Runes']
        .map((name) => ownEntombed.get(name))
        .filter((oid): oid is string => oid !== undefined);
      const returned = legalOids.filter((oid) => pilot.battlefield.some((card) => card.oid === oid));
      completed =
        evokeCast &&
        reveillarkOid !== undefined &&
        pilot.graveyard.some((card) => card.oid === reveillarkOid) &&
        returned.length === route &&
        selected.every((oid) => returned.includes(oid)) &&
        [...ownEntombed.entries()]
          .filter(([name]) => name === 'Vendilion Clique')
          .every(([, oid]) => pilot.graveyard.some((card) => card.oid === oid)) &&
        pilot.graveyard.some((card) => card.name === 'Entomb') &&
        (opposingEntombed === undefined || opponent.graveyard.some((card) => card.oid === opposingEntombed));
      trace.push(
        `${session.view.turn.number}/${session.view.turn.step} seat=${String(decision.seat)} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`,
      );

      let move: string | undefined;
      if (decision.kind === 'zone-card-selection') {
        const name =
          decision.seat === 1 ? 'Mother of Runes' : wanted.find((candidate) => !ownEntombed.has(candidate));
        const choice = decision.options.find((option) => option.targets[0]?.name === name);
        const oid = choice?.targets[0]?.oid;
        if (choice === undefined || oid === undefined)
          throw new Error(`Entomb did not offer ${String(name)}`);
        if (decision.seat === 1) opposingEntombed = oid;
        else ownEntombed.set(name!, oid);
        move = choice.id;
      } else if (decision.kind === 'target-selection' && evokeCast) {
        targetChoices += 1;
        const legal = new Set(
          ['Wall of Omens', 'Mother of Runes']
            .map((name) => ownEntombed.get(name))
            .filter((oid): oid is string => oid !== undefined && !selected.includes(oid)),
        );
        const candidateOptions = decision.options.filter((option) => option.targets.length === 1);
        expect(new Set(candidateOptions.map((option) => option.targets[0]!.oid)), trace.at(-1)).toEqual(
          legal,
        );
        expect(
          candidateOptions.every((option) => option.targets[0]?.name !== 'Vendilion Clique'),
          trace.at(-1),
        ).toBe(true);
        expect(
          candidateOptions.every((option) => option.targets[0]?.name !== 'Entomb'),
          trace.at(-1),
        ).toBe(true);
        expect(
          candidateOptions.every((option) => option.targets[0]?.oid !== opposingEntombed),
          trace.at(-1),
        ).toBe(true);
        if (!inventedRejected) {
          await expect(session.submit('target-invented')).resolves.toMatchObject({
            ok: false,
            error: { kind: 'unknown-move' },
          });
          inventedRejected = true;
        }
        const choice =
          selected.length >= route
            ? decision.options.find((option) => option.id === 'reveillark-targets-done')
            : candidateOptions.find((option) => legal.has(option.targets[0]!.oid));
        if (choice === undefined)
          throw new Error(`Forge offered no Reveillark route-${String(route)} choice`);
        const staleSession = session;
        const oid = choice.targets[0]?.oid;
        const advanced = await session.submit(choice.id);
        if (!advanced.ok) throw new Error(advanced.error.message);
        session = advanced.session;
        if (oid !== undefined) selected.push(oid);
        const stale = await staleSession.submit(choice.id);
        expect(stale).toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleRejected = true;
        continue;
      } else if (decision.kind === 'priority') {
        const ownLands = pilot.battlefield.filter((card) => card.name === 'Scrubland').length;
        const ownUntappedLands = pilot.battlefield.filter(
          (card) => card.name === 'Scrubland' && !card.tapped,
        ).length;
        const opposingLands = opponent.battlefield.filter((card) => card.name === 'Swamp').length;
        const opposingUntappedLands = opponent.battlefield.filter(
          (card) => card.name === 'Swamp' && !card.tapped,
        ).length;
        const nextOwnEntomb = wanted.find((name) => !ownEntombed.has(name));
        const evoke = decision.options.find(
          (option) => option.text.startsWith('Reveillark:') && option.text.includes('Evoke'),
        );
        move =
          (completed ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Scrubland')?.id
            : undefined) ??
          (decision.seat === 1
            ? decision.options.find((option) => option.text === 'Play Swamp')?.id
            : undefined) ??
          (decision.seat === 1 &&
          opposingEntombed === undefined &&
          opposingLands >= 1 &&
          opposingUntappedLands >= 1 &&
          session.view.stack.length === 0
            ? decision.options.find((option) => option.text.startsWith('Entomb:'))?.id
            : undefined) ??
          (decision.seat === 0 &&
          nextOwnEntomb !== undefined &&
          ownLands >= 1 &&
          ownUntappedLands >= 1 &&
          session.view.stack.length === 0
            ? decision.options.find((option) => option.text.startsWith('Entomb:'))?.id
            : undefined) ??
          (decision.seat === 0 &&
          !evokeCast &&
          nextOwnEntomb === undefined &&
          opposingEntombed !== undefined &&
          ownLands >= 6 &&
          session.view.stack.length === 0
            ? evoke?.id
            : undefined);
        evokeCast ||= move !== undefined && move === evoke?.id;
      }

      move ??= routineMove(decision) ?? decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Reveillark Evoke move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-220).join('\n')}`);
      session = advanced.session;
    }

    const evidence = `${trace.slice(-280).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect([...ownEntombed.keys()], evidence).toEqual(wanted);
    expect(opposingEntombed, evidence).toMatch(/^forge-card-/u);
    expect(evokeCast, evidence).toBe(true);
    expect(reveillarkOid, evidence).toMatch(/^forge-card-/u);
    expect(targetChoices, evidence).toBe(route < 2 ? route + 1 : 2);
    expect(selected, evidence).toHaveLength(route);
    expect(inventedRejected, evidence).toBe(true);
    expect(staleRejected, evidence).toBe(true);
    expect(completed, evidence).toBe(true);
  } finally {
    await session.close();
    await backend.shutdown?.();
  }
}

forgeIt(
  'keeps an ordinary-cast Reveillark on the battlefield and executes zero, one, and two Evoke targets',
  async () => {
    await proveOrdinaryCast();
    await proveEvokeRoute(0);
    await proveEvokeRoute(1);
    await proveEvokeRoute(2);
  },
  600_000,
);
