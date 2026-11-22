/** Installed-Forge outcomes for Mystic Confluence's exact repeatable modal composition. */
import { expect, it } from 'vitest';
import type { ObservedSession, SessionSpec } from '@mtg/engine';
import { installedForgeBackend } from '@mtg/forge-export';

const forgeIt = process.env['MTG_REQUIRE_FORGE_BRIDGE'] === '1' ? it : it.skip;

function table(opposingCards: SessionSpec['seats'][number]['deck']['cards'], seed: string): SessionSpec {
  return {
    content: { kind: 'printed', format: 'legacy-cube-2021-08' },
    seats: [
      {
        name: 'Mystic pilot',
        controller: 'local',
        deck: {
          name: `${seed}-mystic`,
          cards: [
            { name: 'Island', count: 30 },
            { name: 'Mystic Confluence', count: 30 },
          ],
        },
      },
      {
        name: 'Opponent',
        controller: 'local',
        deck: { name: `${seed}-opponent`, cards: opposingCards },
      },
    ],
    seed,
    maximumTurns: 20,
  };
}

function traceDecision(session: ObservedSession): string {
  const decision = session.decision;
  if (decision === null) return 'no decision';
  return `${session.view.turn.number}/${session.view.turn.step} seat=${decision.seat} ${decision.kind}: ${decision.prompt} || ${decision.options.map((option) => `${option.id}=${option.text}`).join(' | ')}`;
}

function openingMove(session: ObservedSession): string | undefined {
  return session.decision?.options.find(
    (option) => option.text === 'Play first' || option.text === 'Keep this hand',
  )?.id;
}

function untapped(session: ObservedSession, seat: number, name: string): number {
  return session.view.seats[seat]!.battlefield.filter((card) => card.name === name && !card.tapped).length;
}

function abilitySourceOid(move: string): string | undefined {
  const source = /^ability-(\d+)-/u.exec(move)?.[1];
  return source === undefined ? undefined : `forge-card-${source}`;
}

forgeIt(
  'repeats Mystic Confluence draw three times and rejects invented and stale mode moves',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cast = false;
    let modePicks = 0;
    let libraryBefore = -1;
    let inventedRejected = false;
    let staleRejected = false;
    let outcome = false;
    try {
      const spec = table([{ name: 'Mountain', count: 60 }], 'z5q4-mystic-confluence-draw');
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_000; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Mystic draw decision');
        const pilot = session.view.seats[0]!;
        outcome =
          cast &&
          modePicks === 3 &&
          session.view.stack.length === 0 &&
          pilot.graveyard.some((card) => card.name === 'Mystic Confluence') &&
          pilot.librarySize === libraryBefore - 3;
        trace.push(traceDecision(session));

        let move = openingMove(session);
        let staleSnapshot: ObservedSession | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'mode-selection' && cast && modePicks < 3) {
          expect(decision.options, trace.at(-1)).toHaveLength(1);
          expect(
            decision.options.map((option) => option.text),
            trace.at(-1),
          ).toEqual([expect.stringContaining('Draw a card')]);
          move = decision.options.find((option) => option.text.includes('Draw a card'))?.id;
          if (!inventedRejected) {
            await expect(session.submit('mode-selection-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
            staleSnapshot = session;
          }
          modePicks += 1;
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castSource =
            decision.seat === 0 && !cast && untapped(session, 0, 'Island') >= 5
              ? decision.options.find((option) => option.text.startsWith('Mystic Confluence:'))
              : undefined;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
            castSource?.id ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          if (castSource !== undefined && move === castSource.id) {
            cast = true;
            libraryBefore = pilot.librarySize;
          }
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Mystic draw move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        if (staleSnapshot !== undefined) {
          await expect(staleSnapshot.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
        session = advanced.session;
      }
      const evidence = `${trace.slice(-260).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(modePicks, evidence).toBe(3);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(outcome, evidence).toBe(true);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  360_000,
);

forgeIt(
  'repeats Mystic Confluence return and moves three exact selected creatures to hand',
  async () => {
    const backend = installedForgeBackend({ timeoutMs: 180_000 });
    if (backend === null) throw new Error('Required installed Forge is absent');
    let session: ObservedSession | undefined;
    const trace: string[] = [];
    let cast = false;
    let modePicks = 0;
    const selected: string[] = [];
    let inventedRejected = false;
    let staleRejected = false;
    let outcome = false;
    try {
      const spec = table(
        [
          { name: 'Forest', count: 30 },
          { name: 'Llanowar Elves', count: 30 },
        ],
        'z5q4-mystic-confluence-return',
      );
      expect(await backend.supports(spec)).toEqual([]);
      const opened = await backend.open(spec);
      if (!opened.ok) throw new Error(opened.error.message);
      session = opened.session;
      for (let submitted = 0; session.status === 'awaiting' && submitted < 1_400; submitted += 1) {
        const decision = session.decision;
        if (decision === null) throw new Error('Forge offered no Mystic return decision');
        const pilot = session.view.seats[0]!;
        const opponent = session.view.seats[1]!;
        outcome =
          selected.length === 3 &&
          session.view.stack.length === 0 &&
          pilot.graveyard.some((card) => card.name === 'Mystic Confluence') &&
          selected.every(
            (oid) =>
              (opponent.hand ?? []).some((card) => card.oid === oid) &&
              !opponent.battlefield.some((card) => card.oid === oid),
          );
        trace.push(traceDecision(session));

        let move = openingMove(session);
        let staleSnapshot: ObservedSession | undefined;
        if (decision.kind === 'mana-payment') {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        } else if (decision.kind === 'mode-selection' && cast && modePicks < 3) {
          expect(decision.options, trace.at(-1)).toHaveLength(2);
          expect(
            decision.options.map((option) => option.text),
            trace.at(-1),
          ).toEqual([
            expect.stringContaining('Return target creature'),
            expect.stringContaining('Draw a card'),
          ]);
          move = decision.options.find((option) => option.text.includes('Return target creature'))?.id;
          modePicks += 1;
        } else if (
          (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') &&
          cast &&
          selected.length < 3
        ) {
          const liveCreatures = new Set(
            opponent.battlefield
              .filter((card) => card.name === 'Llanowar Elves' && !selected.includes(card.oid))
              .map((card) => card.oid),
          );
          const target = decision.options.find(
            (option) => option.targets.length === 1 && liveCreatures.has(option.targets[0]!.oid),
          );
          expect(target, trace.at(-1)).toBeDefined();
          expect(
            decision.options
              .flatMap((option) => option.targets)
              .every((targetOption) =>
                opponent.battlefield.some(
                  (card) => card.name === 'Llanowar Elves' && card.oid === targetOption.oid,
                ),
              ),
            trace.at(-1),
          ).toBe(true);
          if (!inventedRejected) {
            await expect(session.submit('target-card-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedRejected = true;
            staleSnapshot = session;
          }
          move = target?.id;
          if (target?.targets[0]?.oid !== undefined) selected.push(target.targets[0].oid);
        } else if (decision.kind === 'combat-attackers') {
          move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
        } else if (decision.kind === 'combat-blockers') {
          move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
        } else if (decision.kind === 'priority') {
          const castSource: (typeof decision.options)[number] | undefined =
            decision.seat === 0 &&
            !cast &&
            untapped(session, 0, 'Island') >= 5 &&
            opponent.battlefield.filter((card) => card.name === 'Llanowar Elves').length >= 3
              ? decision.options.find((option) => option.text.startsWith('Mystic Confluence:'))
              : undefined;
          const castElf =
            decision.seat === 1 && untapped(session, 1, 'Forest') >= 1
              ? decision.options.find((option) => option.text.startsWith('Llanowar Elves:'))
              : undefined;
          move =
            (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
            (decision.seat === 0
              ? decision.options.find((option) => option.text === 'Play Island')?.id
              : decision.options.find((option) => option.text === 'Play Forest')?.id) ??
            castSource?.id ??
            castElf?.id ??
            decision.options.find((option) => option.text === 'Pass priority')?.id;
          cast ||= castSource !== undefined && move === castSource.id;
        }
        move ??= decision.options[0]?.id;
        if (move === undefined) throw new Error('Forge offered no Mystic return move');
        const advanced = await session.submit(move);
        if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-12).join('\n')}`);
        if (staleSnapshot !== undefined) {
          await expect(staleSnapshot.submit(move)).resolves.toMatchObject({
            ok: false,
            error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
          });
          staleRejected = true;
        }
        session = advanced.session;
      }
      const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
      expect(cast, evidence).toBe(true);
      expect(modePicks, evidence).toBe(3);
      expect(selected, evidence).toHaveLength(3);
      expect(inventedRejected, evidence).toBe(true);
      expect(staleRejected, evidence).toBe(true);
      expect(outcome, evidence).toBe(true);
    } finally {
      try {
        await session?.close();
      } finally {
        await backend.shutdown?.();
      }
    }
  },
  480_000,
);

async function runMysticCounter(route: 'decline' | 'pay'): Promise<void> {
  const backend = installedForgeBackend({ timeoutMs: 180_000 });
  if (backend === null) throw new Error('Required installed Forge is absent');
  let session: ObservedSession | undefined;
  const trace: string[] = [];
  let boltOid: string | undefined;
  let mysticOid: string | undefined;
  let castAttempts = 0;
  let modesInAttempt = 0;
  let castPaymentSteps = 0;
  let canceled = false;
  let rollbackObserved = false;
  let inventedTargetRejected = false;
  let staleTargetRejected = false;
  let taxAnswered = false;
  let taxPaymentSources = 0;
  let lifeBefore = -1;
  let libraryBefore = -1;
  let tappedMountainsAtOutcome = -1;
  let outcome = false;
  try {
    const spec = table(
      [
        { name: 'Mountain', count: 30 },
        { name: 'Lightning Bolt', count: 30 },
      ],
      `z5q4-mystic-confluence-counter-${route}`,
    );
    expect(await backend.supports(spec)).toEqual([]);
    const opened = await backend.open(spec);
    if (!opened.ok) throw new Error(opened.error.message);
    session = opened.session;
    for (let submitted = 0; session.status === 'awaiting' && submitted < 1_400; submitted += 1) {
      const decision = session.decision;
      if (decision === null) throw new Error('Forge offered no Mystic counter decision');
      const pilot = session.view.seats[0]!;
      const payer = session.view.seats[1]!;
      boltOid ??= session.view.stack.find((card) => card.name === 'Lightning Bolt')?.oid;
      if (canceled && !rollbackObserved && decision.kind === 'priority' && decision.seat === 0) {
        rollbackObserved =
          mysticOid !== undefined &&
          pilot.hand?.some((card) => card.oid === mysticOid) === true &&
          session.view.stack.every((card) => card.oid !== mysticOid) &&
          boltOid !== undefined &&
          session.view.stack.some((card) => card.oid === boltOid) &&
          untapped(session, 0, 'Island') >= 5;
        if (rollbackObserved) {
          modesInAttempt = 0;
          castPaymentSteps = 0;
        }
      }
      const boltSettled = boltOid !== undefined && payer.graveyard.some((card) => card.oid === boltOid);
      const mysticSettled = mysticOid !== undefined && pilot.graveyard.some((card) => card.oid === mysticOid);
      if (taxAnswered && boltSettled && mysticSettled && session.view.stack.length === 0) {
        tappedMountainsAtOutcome = payer.battlefield.filter(
          (card) => card.name === 'Mountain' && card.tapped,
        ).length;
        outcome =
          pilot.librarySize === libraryBefore - 2 && pilot.life === lifeBefore - (route === 'pay' ? 3 : 0);
      }
      trace.push(traceDecision(session));

      let move = openingMove(session);
      let staleSnapshot: ObservedSession | undefined;
      if (decision.kind === 'mana-payment') {
        if (decision.seat === 0 && castAttempts > 0) {
          if (castAttempts === 1) {
            move =
              castPaymentSteps === 0
                ? decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id
                : decision.options.find((option) => option.id === 'mana-payment-cancel')?.id;
            castPaymentSteps += move === 'mana-payment-cancel' ? 0 : 1;
            canceled ||= move === 'mana-payment-cancel';
          } else {
            move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
          }
        } else if (decision.seat === 1 && decision.prompt.startsWith('Mystic Confluence')) {
          move = decision.options.find((option) =>
            route === 'decline' ? option.id === 'mana-payment-cancel' : option.id !== 'mana-payment-cancel',
          )?.id;
          if (route === 'decline') {
            taxAnswered = move === 'mana-payment-cancel';
          } else if (move !== undefined) {
            taxPaymentSources += 1;
            taxAnswered = taxPaymentSources === 3;
          }
        } else {
          move = decision.options.find((option) => option.id !== 'mana-payment-cancel')?.id;
        }
      } else if (decision.kind === 'mode-selection' && castAttempts > 0 && modesInAttempt < 3) {
        expect(decision.options, trace.at(-1)).toHaveLength(2);
        expect(
          decision.options.map((option) => option.text),
          trace.at(-1),
        ).toEqual([expect.stringContaining('Counter target spell'), expect.stringContaining('Draw a card')]);
        move = decision.options.find((option) =>
          modesInAttempt === 0
            ? option.text.includes('Counter target spell')
            : option.text.includes('Draw a card'),
        )?.id;
        modesInAttempt += 1;
      } else if (decision.kind === 'target-selection' || decision.kind === 'repeatable-target-selection') {
        if (decision.seat === 1) {
          move = decision.options.find((option) => option.id === 'target-player-0')?.id;
        } else {
          const target = decision.options.find(
            (option) => option.targets.length === 1 && option.targets[0]?.oid === boltOid,
          );
          expect(target, trace.at(-1)).toBeDefined();
          expect(
            decision.options
              .filter((option) => option.targets.length > 0)
              .every((option) => option.targets[0]?.oid === boltOid),
            trace.at(-1),
          ).toBe(true);
          if (!inventedTargetRejected) {
            await expect(session.submit('target-stack-invented')).resolves.toMatchObject({
              ok: false,
              error: { kind: 'unknown-move' },
            });
            inventedTargetRejected = true;
            staleSnapshot = session;
          }
          move = target?.id;
        }
      } else if (decision.kind === 'combat-attackers') {
        move = decision.options.find((option) => option.id === 'combat-attackers-commit')?.id;
      } else if (decision.kind === 'combat-blockers') {
        move = decision.options.find((option) => option.id === 'combat-blockers-commit')?.id;
      } else if (decision.kind === 'priority') {
        const castBolt =
          decision.seat === 1 &&
          boltOid === undefined &&
          untapped(session, 1, 'Mountain') >= 4 &&
          untapped(session, 0, 'Island') >= 5
            ? decision.options.find((option) => option.text.startsWith('Lightning Bolt:'))
            : undefined;
        const castMystic =
          decision.seat === 0 &&
          boltOid !== undefined &&
          session.view.stack.some((card) => card.oid === boltOid) &&
          castAttempts < 2 &&
          (castAttempts === 0 || rollbackObserved)
            ? decision.options.find(
                (option) =>
                  option.text.startsWith('Mystic Confluence:') &&
                  (mysticOid === undefined || abilitySourceOid(option.id) === mysticOid),
              )
            : undefined;
        move =
          (outcome ? decision.options.find((option) => option.text === 'Concede')?.id : undefined) ??
          (decision.seat === 0
            ? decision.options.find((option) => option.text === 'Play Island')?.id
            : decision.options.find((option) => option.text === 'Play Mountain')?.id) ??
          castMystic?.id ??
          castBolt?.id ??
          decision.options.find((option) => option.text === 'Pass priority')?.id;
        if (castBolt !== undefined && move === castBolt.id) lifeBefore = pilot.life;
        if (castMystic !== undefined && move === castMystic.id) {
          mysticOid ??= abilitySourceOid(castMystic.id);
          castAttempts += 1;
          if (castAttempts === 2) libraryBefore = pilot.librarySize;
        }
      }
      move ??= decision.options[0]?.id;
      if (move === undefined) throw new Error('Forge offered no Mystic counter move');
      const advanced = await session.submit(move);
      if (!advanced.ok) throw new Error(`${advanced.error.message}\n${trace.slice(-16).join('\n')}`);
      if (staleSnapshot !== undefined) {
        await expect(staleSnapshot.submit(move)).resolves.toMatchObject({
          ok: false,
          error: { kind: 'backend-failure', message: expect.stringContaining('stale') },
        });
        staleTargetRejected = true;
      }
      session = advanced.session;
    }
    const evidence = `${trace.slice(-320).join('\n')}\nview=${JSON.stringify(session.view)}`;
    expect(boltOid, evidence).toMatch(/^forge-card-/u);
    expect(mysticOid, evidence).toMatch(/^forge-card-/u);
    expect(castAttempts, evidence).toBe(2);
    expect(canceled, evidence).toBe(true);
    expect(rollbackObserved, evidence).toBe(true);
    expect(inventedTargetRejected, evidence).toBe(true);
    expect(staleTargetRejected, evidence).toBe(true);
    expect(taxAnswered, evidence).toBe(true);
    expect(taxPaymentSources, evidence).toBe(route === 'pay' ? 3 : 0);
    expect(tappedMountainsAtOutcome, evidence).toBe(route === 'pay' ? 4 : 1);
    expect(outcome, evidence).toBe(true);
  } finally {
    try {
      await session?.close();
    } finally {
      await backend.shutdown?.();
    }
  }
}

forgeIt(
  'cancels and rolls Mystic Confluence back, then counters when the target controller declines three',
  () => runMysticCounter('decline'),
  480_000,
);

forgeIt(
  'cancels and rolls Mystic Confluence back, then lets the exact target resolve after paying three',
  () => runMysticCounter('pay'),
  480_000,
);
